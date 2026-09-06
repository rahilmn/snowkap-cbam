import type {
  GuidanceItem,
} from "./types";

import type {
  EmissionDataId,
  InstallationId,
} from "../shared/ids";

import type {
  InstallationRecordProvenance,
} from "../installations/types";

export interface RejectedEmissionDataForGuidance {
  id: EmissionDataId;
  installation_id: InstallationId;
  installation_name: string;
  installation_provenance: InstallationRecordProvenance;
  rejection_reason: string | null;
}

/**
 * S5 cross-phase hardening (2026-09-06). NOT a v2.1.1-numbered catalog
 * rule -- this repository's own I19 (i19.ts) cites an exact external
 * spec ("v2.1.1, exact spec") for its own definition, and no such
 * exact definition for a producer-side rule is available here to match
 * against. This is instead a minimal, narrowly-scoped item closing a
 * confirmed S5 finding: derive-guidance-items.ts's own candidateItems
 * array had ZERO rule coverage for any S4 (producer-side) domain gate
 * -- I19 is purely a function of Shipment/Declaration state -- so a
 * producer-only org's dashboard and /attention could read "Nothing
 * needs your attention right now" while a REJECTED emission_data
 * record sat permanently blocked (rejectEmissionData requires a
 * non-empty reason, and a REJECTED record cannot become usable again
 * without SUBMIT_FOR_VERIFICATION -> re-review -- src/domain/emissions/
 * emission-data-lifecycle.ts). REJECTED is chosen as the one case that
 * is unambiguously REQUIRED-caliber, actionable BY the producer, and
 * has a real, reachable authoritative gate behind it -- narrower states
 * (VERIFICATION_PENDING awaiting someone ELSE's review, EVIDENCE_
 * INCOMPLETE which the producer's own emission-data list already
 * surfaces reactively) are deliberately left uncovered rather than
 * inventing guidance semantics this phase has no spec authority for.
 *
 * Grouped by installation -- v2.1.1's own stated aggregation rule for
 * "producer record-level rules" (GuidanceParent's own doc comment,
 * types.ts), applied here for the first time since this is the first
 * producer-domain guidance rule this codebase has.
 */
export function deriveProducerRejectedEmissionDataItems(
  records: RejectedEmissionDataForGuidance[],
): GuidanceItem[] {
  return records.map(
    (record) => {
      const id =
        `PRODUCER_REJECTED:${record.id}`;

      return {
        id,
        rule: "PRODUCER_REJECTED",
        parent: {
          type: "installation",
          id: record.installation_id,
          label: record.installation_name,
        },
        family: id,
        priority: "REQUIRED" as const,
        impact: "DATA_ENTRY" as const,
        actionability: "NAVIGATE" as const,
        title: `Resubmit rejected emission data for ${record.installation_name}`,
        // 2026-09-06 (S5 review remediation, finding D1/S5R-B3). Must
        // never say "verification" for INTERNAL REVIEW -- this
        // codebase's own owner-sentences.ts records that exact wording
        // being deliberately revised away for this reason, and
        // tests/architecture/verification-prose-scan.test.ts's own
        // header calls the conflation "the plan's #1 release-blocking
        // risk". The product's own control for this action reads
        // "Submit for internal review" (emission-data-list.tsx).
        reason:
          record.rejection_reason
            ? `An admin rejected this record: ${record.rejection_reason}. Fix it and resubmit for internal review.`
            : "An admin rejected this record. Fix it and resubmit for internal review.",
        // 2026-09-06 (S5 review remediation, finding D2/EF-B1). The
        // record's own installation provenance decides which route it
        // actually lives on -- an org holding both PRODUCER_OPERATOR and
        // IMPORTER_DECLARANT can have rejected records of both kinds at
        // once, so this must follow the RECORD, not the org's capability
        // set.
        href:
          record.installation_provenance === "OPERATOR_PROVIDED"
            ? "/emission-data"
            : "/external-emissions",
        sortKey: record.installation_name,
      };
    },
  );
}
