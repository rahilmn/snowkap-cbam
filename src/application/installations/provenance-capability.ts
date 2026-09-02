import {
  hasCapability,
  type OrgContext,
} from "../organizations/org-context";

import type {
  InstallationRecordProvenance,
} from "../../domain/installations/types";

/**
 * 2026-09-03 (owner decision D2). Which organizations may claim which
 * provenance.
 *
 * Until D2 the operator and installation services simply required
 * PRODUCER_OPERATOR, which made IMPORTER_ENTERED unreachable even
 * though the column, the domain type and the RLS policies had all
 * supported it since 20260829220000. An importer whose supplier was not
 * on Snowkap could not record that supplier at all, which made the
 * whole actual-emissions path conditional on someone else deciding to
 * sign up.
 *
 * The rule is not "importers may now write operator records". It is
 * that WHICH PROVENANCE you may claim follows from WHAT YOU ARE:
 *
 *   OPERATOR_PROVIDED -- the operator that runs the installation
 *   entered this themselves. Requires PRODUCER_OPERATOR.
 *
 *   IMPORTER_ENTERED -- an importer transcribed emissions information
 *   supplied by an external operator who does not use Snowkap.
 *   Requires IMPORTER_DECLARANT.
 *
 * An organization holding both capabilities may claim either, which is
 * correct rather than a loophole: such an org genuinely does both
 * things, and it is the record's provenance -- not the org's -- that
 * describes where a number came from.
 *
 * IMPORTER_ENTERED does NOT mean invented or self-certified. It means
 * transcribed from an external operator. Nothing about the verification
 * lifecycle, the evidence requirement, or the conditions for using a
 * record as an ACTUAL determination changes with it: captured data,
 * verified data and calculation-eligible data stay three different
 * things.
 *
 * The database enforces the same rule
 * (app.enforce_record_provenance_capability, migration 20260903120000).
 * This exists so the refusal carries a message that says which
 * provenance the caller could legitimately have used, not so the check
 * happens only here.
 */
export function capabilityAllowsProvenance(
  context: OrgContext,
  provenance: InstallationRecordProvenance,
): boolean {
  return provenance === "OPERATOR_PROVIDED"
    ? hasCapability(context, "PRODUCER_OPERATOR")
    : hasCapability(context, "IMPORTER_DECLARANT");
}

/**
 * May this organization act on records at all -- read them, list them,
 * remove one?
 *
 * Deliberately NOT the same question as which provenance it may write.
 * Removing an installation, listing operators, attaching evidence: all
 * of these are things either kind of organization does to its OWN
 * records, and RLS already scopes them to that org. Gating them on
 * PRODUCER_OPERATOR alone would lock an importer out of the records it
 * just created.
 */
export function mayManageOwnInstallationRecords(
  context: OrgContext,
): boolean {
  return (
    hasCapability(context, "PRODUCER_OPERATOR") ||
    hasCapability(context, "IMPORTER_DECLARANT")
  );
}
