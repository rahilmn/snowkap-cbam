# Domain Model

The product domain model — as implemented today in `src/domain/`
(types plus pure invariant/lifecycle functions, no persistence yet) —
plus the tenancy design and the DDL template Phase 3 will follow when
it introduces the first product migration. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the layering rules this code
obeys, and [`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) for
how each aggregate fits into the phase roadmap.

## Regulatory role model

Snowkap distinguishes several regulatory roles that a flat
"importer/exporter" split would conflate:

- **Importer** — brings goods into the customs territory.
- **Authorised CBAM declarant** — the accountable filer for CBAM
  purposes. Often the importer, but may be an **indirect customs
  representative** filing on behalf of one or more importers (a future
  capability — see `Organization.acts_as_indirect_representative`
  below, reserved but not yet built).
- **Third-country operator** — runs one or more production
  **installations**.
- **Installation** — the physical production site; the unit
  `EmissionData` is reported against.
- **Supplier** — a commercial counterparty. Deliberately **not** the
  same concept as Operator: a commercial relationship (who you buy
  from) may exist independently of who actually operates the
  production installation, and the two are modeled as separate
  aggregates (`Supplier` vs `Operator`/`Installation` in
  `src/domain/installations/types.ts`) with an optional link between
  them.

An `Organization` is not one of these roles — it is a tenant that may
hold one or both of two **capabilities**:

```ts
type OrganizationCapability = "IMPORTER_DECLARANT" | "PRODUCER_OPERATOR";
```

One platform serves both experiences; an org can be an importer, a
producer, or both (see the master plan's "Importer/Declarant
Experience" and "Producer/Operator Experience" sections for how the UI
differs by capability while sharing this same domain model).

## Shared kernel (`src/domain/shared/`)

| Module | Provides |
|---|---|
| `ids.ts` | `Brand<T, B>` and every branded ID type (`OrganizationId`, `ShipmentId`, `EmissionDataId`, `SharingGrantId`, ...) |
| `decimal.ts` | `DecimalString`, `parseDecimalString`/`toDecimal`/`toDecimalString`, `MoneyEUR`. The only file under `src/domain` (besides the future calculation engine) allowed to import `decimal.js` |
| `country.ts` | `CountryCode` (ISO 3166-1 alpha-2), `parseCountryCode` |
| `reporting-period.ts` | `IsoDate`/`IsoTimestamp`, `parseIsoDate`, `ReportingPeriod` (`ANNUAL` for the definitive regime, 2026 onward; `QUARTERLY` for the transitional regime before it), `reportingPeriodForReleaseDate`, `formatReportingPeriod` |

## Aggregates

### Organization / Membership (`src/domain/organizations/`)

```ts
interface Organization {
  id: OrganizationId;
  name: string;
  slug: string;                                  // unique — DB constraint, not a pure invariant
  capabilities: OrganizationCapability[];
  eori_number: string | null;
  cbam_declarant_status: "NOT_REGISTERED" | "APPLICATION_PENDING" | "AUTHORISED";
  acts_as_indirect_representative: boolean;       // reserved, not yet built
  country_of_establishment: CountryCode | null;
  created_at: IsoTimestamp;
}

interface Membership {
  id: MembershipId;
  org_id: OrganizationId;
  user_id: UserId;                                // Supabase Auth identity; opaque here
  role: "OWNER" | "ADMIN" | "MEMBER";
  created_at: IsoTimestamp;
}
```

**Invariant** (`invariants.ts`, TDD'd): an organization must always
have at least one `OWNER`. `changeMembershipRole` and
`removeMembership` both refuse an action that would leave zero owners,
counted **per organization** — a sole owner of a *different* org never
satisfies this org's minimum.

### Shipment / ShipmentLine (`src/domain/shipments/`)

A `Shipment` is one release-for-free-circulation event of CBAM goods —
deliberately named "Shipment", not "ImportDeclaration": the *customs*
document is carried as `customs_mrn`, and the periodic *CBAM*
declaration is a separate future aggregate (`CBAMDeclaration`, modeled
fully in Phase 9).

```ts
interface Shipment {
  id: ShipmentId;
  org_id: OrganizationId;
  reference: string;                              // unique per org — DB constraint
  release_date: IsoDate;                          // fixes reporting_period and the applicable dataset
  reporting_period: ReportingPeriod;
  customs_mrn: string | null;
  customs_procedure: "RELEASE_FOR_FREE_CIRCULATION" | "INWARD_PROCESSING" | null;
  status: "DRAFT" | "READY" | "LOCKED" | "VOID";
  lines: ShipmentLine[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

interface ShipmentLine {
  id: ShipmentLineId;
  shipment_id: ShipmentId;
  org_id: OrganizationId;                         // denormalized onto the child for RLS
  line_number: number;                            // dense-unique within the shipment
  cn_code: string;                                // 8 or 10 digits, as declared at import time
  cn_code_level: "CN8" | "TARIC10";
  goods_description: string | null;
  origin_country: CountryCode;
  net_mass_tonnes: DecimalString | null;          // exactly one of these two set, and > 0
  quantity_mwh: DecimalString | null;
  production_route: { name: string; source_route_indicator: string } | null;
  emission_determination: EmissionDetermination | null;   // immutable once set (see below)
}
```

**Lifecycle** (`lifecycle.ts`, TDD'd — `transitionShipment`):

```
DRAFT --MARK_READY--> READY --LOCK--> LOCKED
  ^                     |
  +------REOPEN---------+

DRAFT|READY --VOID--> VOID
```

`MARK_READY` requires at least one line and every line "complete"
(non-empty code, non-empty origin, a valid quantity, and a determination
— `isLineComplete` in `invariants.ts`). `LOCK` only leaves `READY` (in
the target design, only via inclusion in a `CBAMDeclaration` — that
coupling is an application-layer concern, not encoded in this pure
function). `LOCKED` and `VOID` are terminal. Every rejection carries an
enumerated reason (`NO_LINES`, `LINE_INCOMPLETE`,
`SHIPMENT_NOT_DRAFT`/`_NOT_READY`, `SHIPMENT_ALREADY_LOCKED`/`_VOID`) —
never a bare boolean.

**Line invariants** (`invariants.ts`): `isLineQuantityValid` — exactly
one of `net_mass_tonnes`/`quantity_mwh` set to a finite number `> 0`.
`hasDenseUniqueLineNumbers` — a shipment's line numbers are exactly
`{1, ..., n}` with no gaps or repeats, independent of array order.

### Emissions (`src/domain/emissions/`)

The provenance heart of the whole system — see "Provenance snapshots"
below for the full rationale.

```ts
type EmissionDetermination =
  | { method: "DEFAULT"; resolution: RegulatoryResolutionSnapshot }
  | { method: "ACTUAL"; snapshot: ActualEmissionSnapshot };

interface EmissionData {                          // an operator's actual emissions declaration
  id: EmissionDataId;
  installation_id: InstallationId;
  entered_by_org_id: OrganizationId;               // producer org, or an importer entering on their behalf
  cn_scope: string[];
  period: ReportingPeriod;
  direct_specific: DecimalString;
  indirect_specific: DecimalString;
  emission_unit: string;
  methodology: "EU_METHOD" | "EQUIVALENT_METHOD" | "OTHER";
  verification_status: "UNVERIFIED" | "VERIFICATION_PENDING" | "VERIFIED" | "REJECTED";
  verifier_user_id: UserId | null;
  rejection_reason: string | null;
  evidence_file_ids: string[];
  version: number;                                 // supersession lineage
  predecessor_id: EmissionDataId | null;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "DISCARDED";
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}
```

Only `ACTIVE` + `VERIFIED` `EmissionData` is ever eligible to back an
`ACTUAL` determination (enforced at the application layer, Phase 7).
Supersession always creates a **new** row referencing its predecessor
via `predecessor_id`/`version` — a predecessor is never mutated or
deleted, so any `ActualEmissionSnapshot` already taken from it stays
valid forever.

### Installations (`src/domain/installations/`)

```ts
interface Operator {
  id: OperatorId;
  org_id: OrganizationId;
  provenance: "OPERATOR_PROVIDED" | "IMPORTER_ENTERED";
  name: string;
  country: CountryCode;
  contact_email: string | null;
  created_at: IsoTimestamp;
}

interface Installation {
  id: InstallationId;
  operator_id: OperatorId;
  org_id: OrganizationId;
  provenance: "OPERATOR_PROVIDED" | "IMPORTER_ENTERED";
  name: string;
  country: CountryCode;
  un_locode: string | null;
  address: string | null;
  cbam_installation_id: string | null;             // reserved for a future CBAM registry id
  created_at: IsoTimestamp;
}

interface Supplier {                                // importer-side commercial counterparty
  id: SupplierId;
  org_id: OrganizationId;
  name: string;
  country: CountryCode | null;
  contact_name: string | null;
  contact_email: string | null;
  linked_operator_id: OperatorId | null;
  linked_installation_ids: InstallationId[];
  created_at: IsoTimestamp;
}
```

`provenance` distinguishes a record the producer entered themselves
from one an importer entered on behalf of an off-platform producer with
no Snowkap account — both are legitimate, and the UI (Phase 7) labels
them differently.

### Calculations (`src/domain/calculations/`)

```ts
interface CalculationResult {                       // append-only — never updated; recalculation appends
  id: CalculationResultId;
  org_id: OrganizationId;
  line_id: ShipmentLineId;
  shipment_id: ShipmentId;
  engine_version: string;
  parameter_datasets: { dataset_id: string; dataset_type: string; dataset_version: string }[];
  inputs: { quantity: DecimalString; quantity_unit: "TONNES" | "MWH"; determination: EmissionDetermination };
  steps: { step: string; rule_ref: string; formula: string; inputs: Record<string, string>; value: DecimalString }[];
  outputs: {
    embedded_emissions_tco2e: DecimalString;
    certificates_due: DecimalString | null;         // null until parameter datasets are ACTIVE
    liability: MoneyEUR | null;
  };
  calculated_at: IsoTimestamp;
  correlation_id: string | null;
}
```

Every step's `rule_ref` points at an entry in the future
`docs/regulatory/CALCULATION_RULE_REGISTER.md` (authored before the
calculation-engine phase, per the master plan) — the engine never
applies a formula that isn't registered there. `certificates_due` and
`liability` stay `null` (not a guessed zero) until the parameter
datasets a liability estimate depends on actually exist and are
`ACTIVE`.

### Audit (`src/domain/audit/`)

```ts
interface AuditEvent {                               // append-only, immutable
  id: AuditEventId;
  org_id: OrganizationId | null;                     // null only for SYSTEM-scope events
  occurred_at: IsoTimestamp;
  actor: { type: "USER"; user_id: UserId } | { type: "SYSTEM" };
  event_type: string;                                // namespaced, e.g. "shipment.created"
  aggregate: { type: AuditAggregateType; id: string };
  payload: Record<string, unknown>;
  correlation_id: string | null;
}
```

### Sharing (`src/domain/sharing/`)

See "Cross-organization sharing" below for the full design.

```ts
interface SharingGrant {
  id: SharingGrantId;
  grantor_org_id: OrganizationId;                    // the producer org
  grantee_org_id: OrganizationId | null;              // null until an email invite is accepted
  invited_email: string | null;
  installation_id: InstallationId;                    // scope: exactly one installation
  status: "INVITED" | "ACTIVE" | "REVOKED" | "EXPIRED";
  created_by_user_id: UserId;
  expires_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}
```

## Provenance snapshots

`RegulatoryResolutionSnapshot` and `ActualEmissionSnapshot`
(`src/domain/emissions/types.ts`) are the mechanism that makes every
historical result reproducible even after the regulatory dataset
changes or a sharing grant is revoked. Both are **frozen copies taken
at determination time**, never references:

```ts
interface RegulatoryResolutionSnapshot {
  dataset_id: string;
  dataset_version: string;
  resolved_at: IsoTimestamp;
  reason: ResolutionReason;                          // from src/domain/regulatory/types.ts, type-only import
  record_identity: {
    source_sheet: string; source_row: number; source_trade_code: string;
    origin_country_name: string; source_production_route_code: string | null;
  };
  values: { direct: RegulatoryValue; indirect: RegulatoryValue; total: RegulatoryValue };
  emission_unit: string;
  trace: ResolutionTraceStep[];                       // the full R12 trace, copied verbatim
}

interface ActualEmissionSnapshot {
  emission_data_id: EmissionDataId;
  emission_data_version: number;
  installation_id: InstallationId;
  resolved_at: IsoTimestamp;
  values: { direct_specific: DecimalString; indirect_specific: DecimalString };
  emission_unit: string;
  methodology: EmissionDataMethodology;
  verification: { status: "VERIFIED"; verifier_user_id: UserId };
  evidence_file_ids: string[];
  sharing_grant_id: SharingGrantId | null;             // set only when read across orgs through a grant
}
```

`checkRegulatoryResolutionSnapshotCompleteness` and
`checkActualEmissionSnapshotCompleteness`
(`src/domain/emissions/snapshot-completeness.ts`) verify every
provenance field is actually populated (not just present in the type) —
an empty `dataset_version` or an empty `trace` fails the check, since a
snapshot missing either cannot satisfy
[`SOURCE_REGISTER.md`](../regulatory/SOURCE_REGISTER.md) rule 6 ("a
calculation must record the regulatory dataset version used") or the
auditability chain in `ARCHITECTURE.md`, even though a looser type
would accept it. Both functions report **every** missing field in one
pass, not just the first.

## Cross-organization sharing

A producer's verified installation data must be usable by multiple
authorized importer organizations without ever weakening tenant
isolation. The chosen mechanism is an **installation-scoped
`SharingGrant`**, not a blanket organization-to-organization
relationship and not a bare share link:

- **Scope**: exactly one installation's `ACTIVE` + `VERIFIED`
  `EmissionData` (plus the installation's own profile). A grant never
  exposes `DRAFT`/`REJECTED`/`DISCARDED` data, and never any other
  installation the producer owns.
- **Bootstrap**: if the importer org isn't yet known, the grant starts
  `INVITED` against an email address; accepting the invitation resolves
  `grantee_org_id` and moves the grant to `ACTIVE`.
- **Access is read-only**, enforced at both walls described below —
  application-layer scope checks, and (Phase 3+) an RLS `SELECT` policy
  keyed off the grants table. No write policy ever crosses
  organizations.
- **Revocation/expiry** ends *future* reads only. Nothing historical is
  clawed back, because every determination made from shared data holds
  a frozen `ActualEmissionSnapshot` — revoking the grant cannot alter a
  result that already copied the values out.
- **Updates**: when the producer supersedes an `EmissionData` record,
  the grantee sees the new `ACTIVE` version going forward; any
  importer line already determined from the old version shows a stale
  indicator (Phase 7 UI), and re-determination is an explicit, audited
  importer action — never automatic.

## Tenancy

Two enforcement walls, always both:

1. **Application** — every service that touches product data takes an
   explicit `OrgContext { org_id, user_id, role, capabilities }`
   parameter (see `ARCHITECTURE.md`). Role/capability checks happen
   here against a small, explicit matrix (OWNER/ADMIN/MEMBER × the
   actions each may take).
2. **Database** — every product table carries `org_id` (denormalized
   onto child rows so RLS policies never need a join through a parent)
   and has Row Level Security **enabled at creation**, with policies
   defined in the same migration — not deferred, the way the
   regulatory tables' policies currently are (see
   [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)).

Sharing (above) is the one sanctioned way data crosses an organization
boundary, and it is itself dual-wall-enforced and read-only.

## Phase 3 DDL template

This is the shape Phase 3's first product migration follows. It is a
template, not yet-applied SQL — no product migration exists as of
Phase 1. `organizations` and `memberships` come first because every
other product table's `org_id` foreign key needs them to exist.

```sql
-- Per-org RLS helper: every product-table policy is written in terms
-- of this, so a user's accessible orgs are computed once per statement
-- rather than once per row.
create function app.user_org_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select org_id from public.memberships where user_id = auth.uid();
$$;

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    capabilities text[] not null default '{}',
    eori_number text,
    cbam_declarant_status text not null default 'NOT_REGISTERED'
        check (cbam_declarant_status in ('NOT_REGISTERED', 'APPLICATION_PENDING', 'AUTHORISED')),
    acts_as_indirect_representative boolean not null default false,
    country_of_establishment text,                    -- ISO 3166-1 alpha-2, format-checked
    created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

create policy organizations_select on public.organizations
    for select using (id in (select app.user_org_ids()));
-- insert/update/delete policies follow the same org_id-scoped shape,
-- refined per role once the capability matrix (ARCHITECTURE.md) lands.

create table public.memberships (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('OWNER', 'ADMIN', 'MEMBER')),
    created_at timestamptz not null default now(),
    unique (org_id, user_id)
);

alter table public.memberships enable row level security;

create policy memberships_select on public.memberships
    for select using (org_id in (select app.user_org_ids()));
```

Every subsequent product table (`shipments`, `shipment_lines`,
`installations`, `emission_data`, `sharing_grants`, `audit_events`,
`calculation_results`, ...) follows the same pattern: `org_id uuid not
null references public.organizations(id)`, RLS enabled and policies
defined in the same migration, and — for `audit_events` and
`calculation_results` specifically — `insert`+`select` policies only,
with `update`/`delete` grants revoked entirely (append-only at the
database level, not just by convention). `sharing_grants`-driven reads
add a second helper, `app.user_shared_installation_ids()`, following
the same `security definer` shape, so a grantee's `select` policy on
`installations`/`emission_data` can check grant-based access alongside
ordinary org ownership.

See [`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §12/§38 (Phase
3 contract) for the full migration ordering and RLS policy
responsibilities, and `docs/adr/ADR-0011-product-schema-timing.md` for
why this template is documented now but not yet applied.
