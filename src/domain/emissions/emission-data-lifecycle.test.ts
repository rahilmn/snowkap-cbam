import {
  describe,
  expect,
  it,
} from "vitest";

import {
  transitionEmissionData,
} from "./emission-data-lifecycle";

import type {
  EmissionData,
} from "./types";

function record(
  overrides: Partial<EmissionData> = {},
): EmissionData {
  return {
    id: "ed-1" as never,
    installation_id: "inst-1" as never,
    entered_by_org_id: "org-1" as never,
    cn_scope: ["25232100"],
    period: { kind: "ANNUAL", year: 2026 },
    direct_specific: "1.0" as never,
    indirect_specific: "0.1" as never,
    emission_unit: "TCO2E_PER_TONNE",
    methodology: "EU_METHOD",
    verification_status: "UNVERIFIED",
    verifier_user_id: null,
    rejection_reason: null,
    evidence_file_ids: [],
    version: 1,
    predecessor_id: null,
    status: "DRAFT",
    created_at: "2026-08-28T00:00:00.000Z" as never,
    updated_at: "2026-08-28T00:00:00.000Z" as never,
    ...overrides,
  };
}

describe(
  "transitionEmissionData",
  () => {
    describe(
      "SUBMIT_FOR_VERIFICATION",
      () => {
        it(
          "moves UNVERIFIED -> VERIFICATION_PENDING for a DRAFT record",
          () => {
            const result =
              transitionEmissionData(
                record(),
                { action: "SUBMIT_FOR_VERIFICATION" },
              );

            expect(result).toEqual(
              {
                status: "OK",
                record: record({ verification_status: "VERIFICATION_PENDING" }),
              },
            );
          },
        );

        it(
          "allows resubmission after a REJECTED verification",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "REJECTED", rejection_reason: "bad data" }),
                { action: "SUBMIT_FOR_VERIFICATION" },
              );

            expect(result).toEqual(
              {
                status: "OK",
                record: record({
                  verification_status: "VERIFICATION_PENDING",
                  rejection_reason: null,
                }),
              },
            );
          },
        );

        it(
          "rejects submitting a record that is already VERIFIED",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFIED", verifier_user_id: "u-1" as never }),
                { action: "SUBMIT_FOR_VERIFICATION" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "VERIFICATION_NOT_PENDING" },
            );
          },
        );

        it(
          "rejects submitting a non-DRAFT record",
          () => {
            const result =
              transitionEmissionData(
                record({ status: "ACTIVE" }),
                { action: "SUBMIT_FOR_VERIFICATION" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
            );
          },
        );
      },
    );

    describe(
      "VERIFY",
      () => {
        it(
          "moves VERIFICATION_PENDING -> VERIFIED with a verifier",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFICATION_PENDING" }),
                { action: "VERIFY", verifierUserId: "verifier-1" as never },
              );

            expect(result).toEqual(
              {
                status: "OK",
                record: record({
                  verification_status: "VERIFIED",
                  verifier_user_id: "verifier-1" as never,
                }),
              },
            );
          },
        );

        it(
          "rejects verifying a record that isn't VERIFICATION_PENDING",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "UNVERIFIED" }),
                { action: "VERIFY", verifierUserId: "verifier-1" as never },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "VERIFICATION_NOT_PENDING" },
            );
          },
        );
      },
    );

    describe(
      "REJECT",
      () => {
        it(
          "moves VERIFICATION_PENDING -> REJECTED with a reason",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFICATION_PENDING" }),
                { action: "REJECT", rejectionReason: "Evidence insufficient" },
              );

            expect(result).toEqual(
              {
                status: "OK",
                record: record({
                  verification_status: "REJECTED",
                  rejection_reason: "Evidence insufficient",
                }),
              },
            );
          },
        );

        it(
          "requires a non-empty rejection reason",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFICATION_PENDING" }),
                { action: "REJECT", rejectionReason: "  " },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "REJECTION_REASON_REQUIRED" },
            );
          },
        );
      },
    );

    describe(
      "ACTIVATE",
      () => {
        it(
          "moves a DRAFT + VERIFIED record to ACTIVE",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFIED", verifier_user_id: "u-1" as never }),
                { action: "ACTIVATE" },
              );

            expect(result).toEqual(
              {
                status: "OK",
                record: record({
                  verification_status: "VERIFIED",
                  verifier_user_id: "u-1" as never,
                  status: "ACTIVE",
                }),
              },
            );
          },
        );

        it(
          "rejects activating a record that isn't VERIFIED",
          () => {
            const result =
              transitionEmissionData(
                record({ verification_status: "VERIFICATION_PENDING" }),
                { action: "ACTIVATE" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "NOT_VERIFIED" },
            );
          },
        );

        it(
          "rejects activating a non-DRAFT record",
          () => {
            const result =
              transitionEmissionData(
                record({ status: "SUPERSEDED", verification_status: "VERIFIED", verifier_user_id: "u-1" as never }),
                { action: "ACTIVATE" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
            );
          },
        );
      },
    );

    describe(
      "DISCARD",
      () => {
        it(
          "moves a DRAFT record to DISCARDED",
          () => {
            const result =
              transitionEmissionData(
                record(),
                { action: "DISCARD" },
              );

            expect(result).toEqual(
              { status: "OK", record: record({ status: "DISCARDED" }) },
            );
          },
        );

        it(
          "rejects discarding a non-DRAFT record",
          () => {
            const result =
              transitionEmissionData(
                record({ status: "ACTIVE" }),
                { action: "DISCARD" },
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
            );
          },
        );
      },
    );
  },
);
