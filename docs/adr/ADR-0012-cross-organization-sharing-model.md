# ADR-0012: Cross-organization sharing model — installation-scoped grants

## Status

Accepted

## Context

Snowkap serves two organization types that need to interact: a
third-country producer's verified installation/emissions data must be
usable by multiple authorized importer organizations, without ever
weakening the tenant isolation ADR-0004 establishes. Three shapes were
evaluated (see the master plan's "Shared Data / Relationship Model"
section for the full comparison): (a) an ad-hoc share token/link, (b) a
blanket organization-to-organization relationship, (c) an
installation-scoped grant.

## Decision

**Installation-scoped `SharingGrant`** (`src/domain/sharing/types.ts`):
a producer org grants a specific importer org read-only access to
exactly one installation's `ACTIVE` + `VERIFIED` `EmissionData` (plus
that installation's profile) — never a blanket relationship exposing
everything the producer owns, and never write access. Bootstrap: if the
importer org isn't yet known, the grant starts `INVITED` against an
email address and resolves to a `grantee_org_id` on acceptance. Status
lifecycle: `INVITED → ACTIVE → REVOKED | EXPIRED`. Enforced at both
tenancy walls (ADR-0004): application-layer scope checks, and (from
Phase 7) an RLS `SELECT` policy on `installations`/`emission_data`
driven by a `security definer` helper keyed off the grants table — no
write policy ever crosses organizations.

Revocation/expiry ends *future* reads only. This is safe specifically
*because* of ADR-0010's frozen snapshots: any `ActualEmissionSnapshot`
already taken through the grant is a copy, not a live reference, so
revoking access cannot retroactively invalidate a historical
calculation. When the producer supersedes an `EmissionData` record, the
grantee's future reads see the new version; an importer line already
determined from the old version is marked stale, and re-determination
is an explicit, audited action — never automatic.

## Alternatives considered

- **Ad-hoc share token/link** — lowest friction to build, but weak
  identity (no real authorization principal until accepted) and weak
  audit trail. Kept only as the bootstrap invitation *transport* (an
  email carrying a signed, expiring token), not as the standing access
  mechanism.

  **Correction (2026-08-30, found stale during the P13 final
  non-blocked-work audit)**: the paragraph above describes the
  *intended* transport, not what was actually built. The implemented
  bootstrap mechanism is a bare `invited_email` text column, matched
  case-insensitively against the accepting user's confirmed auth email
  at acceptance time (`src/application/sharing/manage-sharing-grants.ts`)
  — there is no signed token of any kind, no expiry token, and no email
  is ever actually sent (confirmed by grep: no mail-dispatch call
  anywhere in that file). `README.md`'s own "Current state" section
  already discloses this plainly ("the bootstrap-by-email sharing
  invite does not actually send an email yet") and cites this ADR; this
  ADR itself just never carried the same disclosure, so a reader
  relying on the ADR alone would wrongly believe the signed-token email
  transport was implemented. It is not, as of this correction.
- **Blanket organization relationship** ("partner org sees everything")
  — rejected as too coarse: it would over-share any *future*
  installation the producer adds, with no way to scope a relationship
  down to what was actually intended to be shared.

## Consequences

Every new installation a producer adds is private by default — sharing
requires an explicit new grant, never inherited from an existing
organization-level relationship. Standing three-party isolation tests
(stranger org sees nothing; revoked grantee loses future reads; grantee
never writes; history survives revocation) are required from Phase 7
onward, per ADR-0004's testing commitment.
