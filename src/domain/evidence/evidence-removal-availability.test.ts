import {
  describe,
  expect,
  it,
} from "vitest";

import {
  evidenceRemovalLocked,
} from "./evidence-removal-availability";

describe(
  "evidenceRemovalLocked",
  () => {
    it(
      "is locked once VERIFIED -- matches evidence_files_delete_own_org's own RLS predicate",
      () => {
        expect(evidenceRemovalLocked("VERIFIED")).toBe(
          true,
        );
      },
    );

    it(
      "is NOT locked for UNVERIFIED -- the permitted removal path must keep working",
      () => {
        expect(evidenceRemovalLocked("UNVERIFIED")).toBe(
          false,
        );
      },
    );

    it(
      "is NOT locked for VERIFICATION_PENDING",
      () => {
        expect(evidenceRemovalLocked("VERIFICATION_PENDING")).toBe(
          false,
        );
      },
    );

    it(
      // Matches tests/integration/emission-data-write-hardening.test.ts's
      // own "allows deleting an evidence file whose owning emission_data
      // record is DRAFT + REJECTED" contrast case -- a producer fixing
      // evidence before resubmitting must not be blocked.
      "is NOT locked for REJECTED -- a producer fixing evidence before resubmitting must not be blocked",
      () => {
        expect(evidenceRemovalLocked("REJECTED")).toBe(
          false,
        );
      },
    );
  },
);
