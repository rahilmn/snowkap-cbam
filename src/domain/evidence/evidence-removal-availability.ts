import type {
  VerificationStatus,
} from "../emissions/types";

/**
 * 2026-09-07 (S5 review round 13 remediation, finding S5R13-EVID-B1,
 * live-reproduced against real Postgres). Mirrors evidence_files_delete_own_org's
 * own RLS predicate (`ed.verification_status <> 'VERIFIED'`, most
 * recently redefined by supabase/migrations/20260907320000_s5r7_evidence_removal_atomic_array_and_metadata.sql)
 * and removeEvidenceFile's own application-layer EMISSION_DATA_VERIFIED
 * rejection (src/application/evidence/upload-evidence.ts) -- both
 * deliberately unchanged by this fix. This function exists so the UI's
 * own promise (the Remove confirm dialog) can be made to match those two
 * authoritative gates exactly, instead of independently guessing at the
 * condition. Also true for ACTIVE and SUPERSEDED records, since both
 * require verification first (tests/integration/emission-data-write-hardening.test.ts's
 * own comment: "or ACTIVE/SUPERSEDED, both necessarily VERIFIED too").
 */
export function evidenceRemovalLocked(
  verificationStatus: VerificationStatus,
): boolean {
  return verificationStatus === "VERIFIED";
}
