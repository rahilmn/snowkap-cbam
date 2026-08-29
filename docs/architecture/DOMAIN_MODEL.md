# Domain Model

This is a **living document tracking current reality**, last brought
into alignment with the code on **2026-08-29** (through Phase 11). It
documents the product domain model exactly as implemented in
`src/domain/` — real TypeScript interfaces, real invariant/lifecycle
functions, and the real migrations that back each aggregate today. It
is not a forward-looking template: 39 migrations are applied, and every
aggregate below has real persisted backing in Postgres, enforced by
Row Level Security. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the
layering rules this code obeys, [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)
for full column-by-column DDL detail (a separate document — this one's
job is the domain shape and its behavioral rules, not the SQL), and
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) for how each
aggregate fits into the phase roadmap.

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
| `ids.ts` | `Brand<T, B>` and every branded ID type (`OrganizationId`, `InvitationId`, `ShipmentId`, `EmissionDataId`, `SharingGrantId`, `DeclarationId`, `EvidenceFileId`, ...) |
| `decimal.ts` | `DecimalString`, `parseDecimalString`/`toDecimal`/`toDecimalString`, `MoneyEUR`. The only file under `src/domain` (besides `src/domain/calculations/**`) allowed to import `decimal.js`. `parseDecimalString` validates a strict canonical grammar (`^-?[0-9]+(\.[0-9]+)?$`) — no scientific notation, no hex/octal/binary/underscore literals — and returns the trimmed (not raw) string, matching the CHECK constraints on `emission_data`/`shipment_lines`' own numeric columns byte-for-byte (hardened 2026-08-29, P11 review finding #9) |
| `country.ts` | `CountryCode` (ISO 3166-1 alpha-2), `parseCountryCode` |
| `reporting-period.ts` | `IsoDate`/`IsoTimestamp`, `parseIsoDate`, `ReportingPeriod` (`ANNUAL` for the definitive regime, 2026 onward; `QUARTERLY` for the transitional regime before it), `reportingPeriodForReleaseDate`, `formatReportingPeriod` |

## Aggregates

### Organization / Membership / Invitation (`src/domain/organizations/`)

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

  // Null = active. Non-null = offboarded (P10, master plan §14): the
  // person holds no access anywhere, but the row survives so their
  // historical audit_events still resolve to a person, not a bare uuid.
  deactivated_at: IsoTimestamp | null;
}

// OWNER is deliberately excluded from what an invite can grant.
type InvitableRole = "ADMIN" | "MEMBER";

interface Invitation {
  id: InvitationId;
  org_id: OrganizationId;
  email: string;
  role: InvitableRole;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  invited_by: UserId;
  created_at: IsoTimestamp;
  expires_at: IsoTimestamp;
}
```

**Invariants** (`invariants.ts`, TDD'd, all operate on the org's full
membership list and return either `{status: "OK", memberships}` or a
named `{status: "REJECTED", reason}`):

- `changeMembershipRole` / `removeMembership` — an organization must
  always have at least one **active** `OWNER`; both refuse an action
  that would leave zero, counted **per organization** (a sole owner of
  a *different* org never satisfies this org's minimum).
- `deactivateMembership` — same last-active-owner check (reason
  `LAST_OWNER`), plus refuses a second deactivation of an already-
  deactivated row (`ALREADY_DEACTIVATED`) rather than silently
  overwriting the original offboarding timestamp.
- `reactivateMembership` — restores access at the role already held
  (no owner-count check in this direction — reactivation only adds an
  active owner); refuses a non-deactivated target (`NOT_DEACTIVATED`).
- The private helper `isLastActiveOwner` is the single source of truth
  all four functions call: "active" is load-bearing on both sides — a
  deactivated `OWNER` confers no authority (skipped by
  `app.user_is_admin_or_owner_of()`) and so counts as neither a
  protector nor a target of the minimum.

**Backing migrations**: `20260828070000` (organizations + memberships
+ RLS, `app.user_org_ids()`), `20260828130000` (`organization_invitations`
table + `accept_organization_invitation()` RPC), `20260829360000` (P10:
`deactivated_at` column + deactivate/reactivate RPCs), `20260829370000`
(P10 review: `user_id` pinned immutable on `memberships`) and
`20260829420000` (P11 review: `org_id` likewise pinned immutable — a
bare `UPDATE` can no longer relocate a membership across orgs or
reassign it to a different user), `20260829380000` (P11 review finding
#1: invitation acceptance now requires a *confirmed* email, not just a
matching claim).

### Shipment / ShipmentLine (`src/domain/shipments/`)

A `Shipment` is one release-for-free-circulation event of CBAM goods —
deliberately named "Shipment", not "ImportDeclaration": the *customs*
document is carried as `customs_mrn`, and the periodic *CBAM*
declaration is the separate `Declaration` aggregate below.

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
  emission_determination: EmissionDetermination | null;   // immutable once set (see Emissions below)
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
practice, only via inclusion in a filed `Declaration` — see
`record_declaration_filed()` below; that coupling is a
database/application-layer concern, not encoded in this pure function).
`LOCKED` and `VOID` are terminal. Every rejection carries an enumerated
reason (`NO_LINES`, `LINE_INCOMPLETE`,
`SHIPMENT_NOT_DRAFT`/`_NOT_READY`, `SHIPMENT_ALREADY_LOCKED`/`_VOID`) —
never a bare boolean.

**Line invariants** (`invariants.ts`): `isLineQuantityValid` — exactly
one of `net_mass_tonnes`/`quantity_mwh` set to a finite number `> 0`,
validated through `parseDecimalString` (tightened 2026-08-29, P13 audit
finding — previously widened through a native JS `Number()`, which
ADR-0006 forbids for any regulated numeric). `hasDenseUniqueLineNumbers`
— a shipment's line numbers are exactly `{1, ..., n}` with no gaps or
repeats, independent of array order.

**Backing migrations**: `20260828150000` (P4: `suppliers`, `shipments`,
`shipment_lines`, `import_batches`), `20260829090000` (P4 review:
`org_id` pinned immutable), `20260829150000` (P5: the `emission_determination`
jsonb column plus its generated "hot key" columns), `20260829440000`
(P11 review finding #9: canonical-decimal CHECK on
`net_mass_tonnes`/`quantity_mwh`, matching `parseDecimalString`'s
grammar).

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

**Lifecycle** (`emission-data-lifecycle.ts`, TDD'd —
`transitionEmissionData`): two coupled state machines on one row.

```
verification_status: UNVERIFIED --SUBMIT_FOR_VERIFICATION-->
  VERIFICATION_PENDING --VERIFY--> VERIFIED
                        --REJECT--> REJECTED --SUBMIT_FOR_VERIFICATION-->
  VERIFICATION_PENDING (resubmission clears the prior rejection_reason)

status: DRAFT --ACTIVATE--> ACTIVE   (only once verification_status = VERIFIED)
        DRAFT --DISCARD--> DISCARDED
```

`ACTIVATE` is the producer's explicit "publish" step, separate from
verification succeeding — a record can sit `DRAFT` + `VERIFIED`
indefinitely before the producer makes it the installation's current
record for its `(installation, cn_scope, period)`. Rejections are named
(`RECORD_NOT_DRAFT`, `VERIFICATION_NOT_PENDING`, `NOT_VERIFIED`,
`REJECTION_REASON_REQUIRED`). Only `ACTIVE` + `VERIFIED` `EmissionData`
is ever eligible to back an `ACTUAL` determination (enforced at the
application layer). Supersession always creates a **new** row
referencing its predecessor via `predecessor_id`/`version` — a
predecessor is never mutated or deleted, so any `ActualEmissionSnapshot`
already taken from it stays valid forever.

Two further pure functions round out the module:
`checkEmissionDataEvidenceCompleteness` (`snapshot-completeness.ts`) —
a *live*, re-derived-every-time check (never a cached flag) that
`evidence_file_ids` is non-empty, gating verify/activate/consume so a
record can never become usable with evidence later stripped away — and
`checkActualSnapshotStaleness` (`check-actual-snapshot-staleness.ts`) —
compares a frozen `ActualEmissionSnapshot`'s `emission_data_version`
against the installation's current `ACTIVE` row's version to report
`STALE`/`CURRENT`, purely for UI display (re-determination itself is
always an explicit, audited importer action).

**Backing migrations**: `20260829230000` (P7-B: `emission_data`
schema), `20260829240000` (P7-C: evidence-file wiring fix — made
`evidence_file_ids` mutable after insert, since evidence must attach
during/after verification, not only at creation), `20260829270000`
(FK hardening), `20260829280000` (`updated_at` trigger),
`20260829290000` (version-lineage hardening).

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
no Snowkap account — both are legitimate, and the UI labels them
differently. No dedicated `invariants.ts`/`lifecycle.ts` exists for
this module — these three are plain, no-transition records at the
domain layer today.

**Backing migrations**: `20260828150000` (P4: `suppliers`, alongside
`shipments`), `20260829220000` (P7-A: `operators` + `installations`).

### Calculations (`src/domain/calculations/`)

```ts
interface CalculationResult {                       // append-only — never updated; recalculation appends
  id: CalculationResultId;
  org_id: OrganizationId;
  line_id: ShipmentLineId;
  shipment_id: ShipmentId;
  engine_version: string;                            // ENGINE_VERSION const, currently "1.1.0"
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

Every step's `rule_ref` points at an entry in
`docs/regulatory/CALCULATION_RULE_REGISTER.md` — the engine
(`calculate-line-emissions.ts`) never applies a formula that isn't
registered there. `certificates_due` and `liability` stay `null` (not a
guessed zero) until the parameter datasets a liability estimate depends
on actually exist and are `ACTIVE`.

The pure engine's own return shape, `LineEmissionsCalculation`, is
distinct from the persisted `CalculationResult` above — only a
`COMPUTED` result is ever turned into a row; every other status is an
explicit non-computable outcome surfaced for one request/response only,
never written:

```ts
type CalculationStatus =
  | "COMPUTED"
  | "INPUT_UNRESOLVED"              // line has no emission_determination at all
  | "VALUE_UNAVAILABLE"             // defense-in-depth: resolved/verified value not actually usable
  | "UNIT_UNSUPPORTED"              // determination's emission_unit inconsistent with the line's quantity basis
  | "PARAMETER_DATASET_UNAVAILABLE"; // added 2026-08-29: an ACTUAL determination on an Annex-II direct-emissions-only
                                      // sector good with non-zero indirect_specific — no Annex II CN-code dataset
                                      // exists yet to gate the exception precisely, so the engine refuses rather
                                      // than overstate (RULE-EE-009's own Exceptions bullet, owner-directed gate)
```

**Backing migrations**: `20260829180000` (P6: `calculation_results`
schema, insert+select only — no update/delete grants, append-only at
the database level), `20260829200000` (P6 review hardening).

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

`AuditAggregateType` now covers every aggregate in this document:
`ORGANIZATION | MEMBERSHIP | SHIPMENT | SHIPMENT_LINE | EMISSION_DATA |
INSTALLATION | OPERATOR | SUPPLIER | SHARING_GRANT | CALCULATION_RESULT
| DECLARATION | EVIDENCE_FILE`. `src/domain/emissions/summarize-determination-for-audit.ts`
is a small helper the emissions application layer uses to compress an
`EmissionDetermination` into a compact `previous_determination` audit
payload field, rather than duplicating a full snapshot into every
change event.

**Backing migrations**: `20260828070000` (created alongside
`organizations`/`memberships`), `20260828090000` (audit organization
creation), `20260829430000` (P11 review finding #10: an insert trigger
now pins `event_type`/`aggregate_type`/`payload` to a real catalog, so
a plain `MEMBER` can no longer forge an arbitrary audit entry as
themselves — `audit_events` carries no `UPDATE`/`DELETE` policy at all,
so a forged row could never have been retracted).

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

**Lifecycle** (`grant-lifecycle.ts`, TDD'd — `transitionSharingGrant`):

```
INVITED --ACCEPT--> ACTIVE --REVOKE--> REVOKED
  |                    |
  +------REVOKE--------+

INVITED --EXPIRE--> EXPIRED / ACTIVE --EXPIRE--> EXPIRED
  (only once now >= expires_at; a grant with no expires_at never auto-expires)
```

`ACCEPT` also refuses an already-lapsed invitation (`GRANT_EXPIRED`) —
widened 2026-08-29 (P11 review finding #5): this pure function's
`EXPIRE` action used to require `status === 'ACTIVE'`, so a grant that
was invited and simply lapsed without ever being accepted could never
reach `EXPIRED` through it at all; only the accept RPC's own lazy-expire
check covered that path. `REVOKED`/`EXPIRED` are terminal. Rejection
reasons: `GRANT_NOT_INVITED`, `GRANT_NOT_ACTIVE`, `ALREADY_TERMINAL`,
`GRANT_EXPIRED`, `NOT_YET_EXPIRED`.

**Backing migrations**: `20260829260000` (P7-D: `sharing_grants`
schema + the two SELECT-RLS extensions it needs on
`installations`/`emission_data`), `20260829300000` (P7-D2: email
invite bootstrap RPC), `20260829310000` (P7-D3: shared-data
consumption audit), `20260829320000` (P7-D4: grantee-visible status),
`20260829390000` (P11 review: sharing-grant email-confirmation and
expiry hardening, mirroring the invitation fix above).

### Declaration (`src/domain/declarations/`)

The TypeScript-side view of one `declarations` row — master plan §6's
`CBAMDeclaration`: "annual reporting_period, member shipments,
completeness report, DRAFT -> READY -> FILED_RECORDED, filed snapshot,
amendments as versions."

```ts
type DeclarationStatus = "DRAFT" | "READY" | "FILED_RECORDED" | "VOID";

interface Declaration {
  id: DeclarationId;
  org_id: OrganizationId;
  reporting_period: ReportingPeriod;
  status: DeclarationStatus;

  // Frozen once the row leaves DRAFT (app.prevent_declaration_fact_change())
  // — never a live-recomputed set.
  member_shipment_ids: ShipmentId[];
  completeness_report: CompletenessReport | null;

  // Built entirely inside public.record_declaration_filed() from a
  // fresh aggregation at filing time — never constructed, recomputed,
  // or validated by TypeScript. Deliberately a loose record, not a
  // typed FiledSnapshot interface: re-typing SQL-authored jsonb here
  // would invite this module to trust a shape it never produces.
  filed_snapshot: Record<string, unknown> | null;

  // Verbatim declarant-typed filing reference — never generated,
  // parsed, or defaulted (Snowkap records a filing it did not perform).
  filed_reference: string | null;
  filed_at: IsoTimestamp | null;

  supersedes_declaration_id: DeclarationId | null;   // null for an original; the prior version for an amendment

  created_by_user_id: UserId;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

interface CompletenessReport {
  generated_at: IsoTimestamp;
  shipment_count: number;
  line_count: number;
  complete: boolean;                                 // derived (blockers.length === 0), never stored independently
  blockers: CompletenessBlocker[];
}
```

**Architecturally distinct from every aggregate above**: there is no
`lifecycle.ts` for `Declaration`. The `DRAFT -> READY` transition is
application-layer (`mark-declaration-ready.ts`, gated by re-running the
completeness check — never trusting the row's own cached
`completeness_report`, which can go stale while a member shipment's
lines are still editable). `READY -> FILED_RECORDED` is a single
atomic `record_declaration_filed()` SQL RPC (`20260829330000`, section
4) — chosen because that transition has to LOCK N member shipments and
build `filed_snapshot` together, atomically, which is a
database-shaped requirement, not a pure-function-shaped one. Amendment
creation (`create-declaration-amendment.ts`) makes a new `DRAFT` row
chained via `supersedes_declaration_id`, only from a `FILED_RECORDED`
original.

What domain-layer pure functions *do* own: `completeness.ts`'s
`buildCompletenessReport` — given every shipment currently in a period,
names every reason it isn't ready to file (or reports none), reusing
the same blocker vocabulary `record_declaration_filed()`'s own
`result_status` values do (`NO_MEMBER_SHIPMENTS`/`SHIPMENTS_NOT_LOCKABLE`/`INCOMPLETE`
at the RPC; `NO_SHIPMENTS_IN_PERIOD`/`SHIPMENT_NOT_LOCKABLE`/`SHIPMENT_HAS_NO_LINES`/`LINE_NOT_DETERMINED`/`LINE_NOT_CALCULATED`
at this finer per-line grain) so a reader who has seen one recognizes
the other. A shipment counts as "lockable" at `READY` or `LOCKED`
status — `LOCKED` is accepted because an amendment's member set
legitimately includes shipments the superseded declaration already
locked.

**Backing migrations**: `20260829330000` (P9: `declarations` schema +
`record_declaration_filed()`), `20260829340000` (insert-policy
recursion fix), `20260829350000` (filed-membership + completeness
fix), `20260829400000` (P11 review: `record_declaration_filed()`
membership-oracle fix).

### EvidenceFile (`src/domain/evidence/`)

A supporting document (test report, certificate, invoice, ...)
attached to one `EmissionData` row. Immutable once uploaded — a mistake
is removed and re-uploaded, never edited in place, so there is no
"update" shape for this type.

```ts
interface EvidenceFile {
  id: EvidenceFileId;
  org_id: OrganizationId;
  emission_data_id: EmissionDataId;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;                                // always computed server-side from actual bytes, never client input
  sha256: string;                                     // always computed server-side, never client input
  uploaded_by_user_id: UserId;
  created_at: IsoTimestamp;
}
```

**Invariant** (`validate-evidence-upload.ts`, TDD'd —
`validateEvidenceUpload`, pure and runs before any storage/DB I/O): the
executable-extension check runs first and unconditionally
(`.exe .sh .bat .cmd .ps1 .dll .app .scr .js .msi` rejected outright,
regardless of claimed MIME type); then a `20 MiB` size cap; then MIME
type and file extension are each checked against their own allowlist
(PDF, PNG, JPEG, DOCX, XLSX) *independently* and required to *agree*
with each other — a spoofed `Content-Type` claiming `application/pdf`
for a file named `payload.exe` cannot pass on the MIME check alone.
Named rejection reasons: `EMPTY_FILE`, `FILE_TOO_LARGE`,
`EXECUTABLE_EXTENSION`, `DISALLOWED_MIME_TYPE`, `DISALLOWED_EXTENSION`,
`MIME_EXTENSION_MISMATCH`.

**Backing migrations**: `20260829240000` (P7-C: storage bucket +
`evidence_files` table), `20260829410000` (P11 review finding #6: a
CHECK constraint now pins `storage_path` to the row's own `org_id`
prefix, so a forged cross-org `storage_path` can never be inserted in
the first place — closing a gap where only the Storage-layer RLS
policy, not row-level integrity, stood between a caller and another
org's evidence files).

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
  country_mapping: CountryMappingOutcome;             // whether the origin ISO code had its own dataset row, or fell to the fallback geography
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

`country_mapping` (`CountryMappingOutcome`, `{status: "MAPPED";
regulatory_country_name}` or `{status: "UNLISTED"}`) records whether
the shipment line's ISO origin code had its own row in the regulatory
`countries` table or fell through to the "Other Countries and
Territories" fallback geography (R7) — so the explanation UI can
honestly say *why* the fallback was used, distinct from a listed
country that simply had no country-specific record. `buildResolutionSnapshot`
(`build-resolution-snapshot.ts`) is the pure function that freezes a
`RESOLVED` resolver result into this shape — every other resolver
status (`REFERENCE_REQUIRED`, `UNAVAILABLE`, `NOT_APPLICABLE`,
`AMBIGUOUS`, `NO_MATCH`) means nothing is frozen and
`emission_determination` stays `null`, never a synthetic "unresolved"
variant.

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
pass, not just the first. A third function in the same module,
`checkEmissionDataEvidenceCompleteness`, is a distinct, live check on a
current `EmissionData` row's `evidence_file_ids` (not an
already-constructed snapshot) — see "Emissions" above.

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
  `grantee_org_id` and moves the grant to `ACTIVE`. Acceptance requires
  a *confirmed* email on the accepting account (P11 hardening — see
  Sharing above), and an already-lapsed invitation cannot be accepted
  even if its status still reads `INVITED`.
- **Access is read-only**, enforced at both walls described below —
  application-layer scope checks, and an RLS `SELECT` policy keyed off
  the grants table (`app.user_shared_installation_ids()`). No write
  policy ever crosses organizations.
- **Revocation/expiry** ends *future* reads only. Nothing historical is
  clawed back, because every determination made from shared data holds
  a frozen `ActualEmissionSnapshot` — revoking the grant cannot alter a
  result that already copied the values out.
- **Updates**: when the producer supersedes an `EmissionData` record,
  the grantee sees the new `ACTIVE` version going forward; any
  importer line already determined from the old version can be flagged
  `STALE` via `checkActualSnapshotStaleness`, and re-determination is
  an explicit, audited importer action — never automatic.

## Tenancy

Two enforcement walls, always both, live today across every product
table:

1. **Application** — every service that touches product data takes an
   explicit `OrgContext { org_id, user_id, role, capabilities }`
   parameter (see `ARCHITECTURE.md`). Role/capability checks happen
   here against a small, explicit matrix (OWNER/ADMIN/MEMBER × the
   actions each may take).
2. **Database** — every product table carries `org_id` (denormalized
   onto child rows so RLS policies never need a join through a parent)
   and has Row Level Security **enabled at creation**, with policies
   defined in the same migration — unlike the regulatory tables, whose
   policies were deferred to a later migration (see
   [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)). `app.user_org_ids()`
   is the shared per-org RLS helper every later product-table policy
   builds on; `app.user_shared_installation_ids()` is its sharing-grant
   analog.

Sharing (above) is the one sanctioned way data crosses an organization
boundary, and it is itself dual-wall-enforced and read-only. The P11
mandatory security review (11 findings across the migrations cited
throughout this document) specifically re-tested this dual-wall
posture end to end and closed every gap it found live — see each
aggregate's "Backing migrations" note above for the specific fix, and
the individual `p11_review_*.sql` migration headers for full
reproduction detail on each.

## Persistence: migrations by aggregate

Every aggregate in this document now has real, applied backing —
fulfilling the commitment ADR-0011 made when this document instead
carried a DDL template. `organizations` + `memberships` landed first
(P3, `20260828070000`), because every other product table's `org_id`
foreign key needs them to exist. Startup order, by phase:

| Phase | Aggregate(s) | First migration |
|---|---|---|
| P3 | Organization, Membership, Invitation, AuditEvent | `20260828070000` |
| P4 | Shipment, ShipmentLine, Supplier | `20260828150000` |
| P5 | Emissions determination columns on ShipmentLine | `20260829150000` |
| P6 | CalculationResult | `20260829180000` |
| P7 | Operator, Installation, EmissionData, EvidenceFile, SharingGrant | `20260829220000` |
| P9 | Declaration | `20260829330000` |
| P10 | Membership deactivation | `20260829360000` |
| P11 | Mandatory security review hardening (cross-cutting, 8 migrations: `20260829370000` P10-review + 7 `p11_review_*` migrations) | `20260829370000`–`20260829440000` |

Every product table follows the same shape: `org_id uuid not null
references public.organizations(id)`, RLS enabled and policies defined
in the same migration, and — for `audit_events` and
`calculation_results` specifically — `insert`+`select` policies only,
with `update`/`delete` grants revoked entirely (append-only at the
database level, not just by convention). See
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §12/§38 for the
full phase-by-phase contract, and
[`docs/adr/ADR-0011-product-schema-timing.md`](../adr/ADR-0011-product-schema-timing.md)
for why the schema was deliberately documented as a template before P3
rather than created alongside the P1 domain types.
