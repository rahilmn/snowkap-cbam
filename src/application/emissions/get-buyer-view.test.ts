import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getBuyerView,
} from "./get-buyer-view";

const orgId =
  "org-1" as never;

const emissionDataId =
  "emission-data-1" as never;

const sharedRow =
  {
    id: "emission-data-1",
    installation_id: "installation-2",
    entered_by_org_id: "org-2",
    cn_scope: ["72081000"],
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    direct_specific: "1.5",
    indirect_specific: "0.2",
    emission_unit: "tCO2e/t",
    methodology: "EU_METHOD",
    verification_status: "VERIFIED",
    verifier_user_id: "admin-1",
    rejection_reason: null,
    evidence_file_ids: ["evidence-1", "evidence-2"],
    version: 1,
    predecessor_id: null,
    status: "ACTIVE",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

/**
 * `emission_data` is read TWICE by getBuyerView -- once as a LIST
 * (inside listAvailableActualEmissionData) and once as a SINGLE row
 * (countEvidenceFiles, keyed by id alone) -- so this mock needs an
 * ordered response queue per table, matching
 * determine-from-actual-data.test.ts's own established array-cursor
 * mock shape, rather than list-available-actual-data.test.ts's simpler
 * one-response-per-table mock (which cannot express two different
 * shapes for the same table name).
 */
function makeMockSupabase(
  tables: Record<string, ({ data: unknown; error: unknown })[]>,
  rpcResult: { data: unknown; error: unknown } = { data: null, error: null },
) {
  const cursors: Record<string, number> =
    {};

  function nextResult(
    table: string,
  ): { data: unknown; error: unknown } {
    const entries =
      tables[table];

    if (!entries || entries.length === 0) {
      return { data: null, error: null };
    }

    const index =
      cursors[table] ?? 0;

    cursors[table] =
      Math.min(index + 1, entries.length - 1);

    return entries[Math.min(index, entries.length - 1)]!;
  }

  function builder(
    table: string,
  ) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          nextResult(table),
        ),
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          nextResult(table),
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),

    rpc: () =>
      Promise.resolve(
        rpcResult,
      ),
  } as never;
}

describe(
  "getBuyerView",
  () => {
    it(
      "returns null when the caller's org cannot see the record at all -- not found, not forbidden",
      async () => {
        const result =
          await getBuyerView(
            makeMockSupabase(
              {
                emission_data: [{ data: [], error: null }],
                installations: [{ data: [], error: null }],
              },
            ),
            orgId,
            emissionDataId,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "assembles the full buyer view for a visible (shared) record: facts, evidence count, declaration context, and precursors",
      async () => {
        const result =
          await getBuyerView(
            makeMockSupabase(
              {
                emission_data: [
                  // 1st call: listAvailableActualEmissionData's own
                  // bulk list query.
                  { data: [sharedRow], error: null },
                  // 2nd call: countEvidenceFiles' single-row query.
                  { data: { evidence_file_ids: sharedRow.evidence_file_ids }, error: null },
                ],
                installations: [
                  { data: [{ id: "installation-2", name: "Steel Works B", country: "IN" }], error: null },
                ],
                sharing_grants: [
                  { data: [{ id: "grant-1", installation_id: "installation-2", expires_at: null }], error: null },
                ],
                emission_data_declaration_context: [
                  {
                    data: {
                      id: "ctx-1",
                      emission_data_id: "emission-data-1",
                      production_process_description: "Kiln-fired at 900C",
                      uses_purchased_precursors: true,
                      verifier_report_declared: true,
                      verifier_report_description: "TUV Rheinland, 2026-02",
                      created_at: "2026-01-01T00:00:00Z",
                      updated_at: "2026-01-01T00:00:00Z",
                    },
                    error: null,
                  },
                ],
                emission_data_precursors: [
                  {
                    data: [
                      {
                        id: "pre-1",
                        emission_data_id: "emission-data-1",
                        material_description: "Clinker, purchased",
                        cn_code: "25231000",
                        source_description: "Acme Cement, DE",
                        direct_specific: "0.850",
                        indirect_specific: "0.120",
                        emission_unit: "tCO2e/t",
                        provenance: "ACTUAL_WITH_DECLARED_REPORT",
                        verifier_report_description: "TUV Rheinland, 2026-02",
                        created_at: "2026-01-01T00:00:00Z",
                        updated_at: "2026-01-01T00:00:00Z",
                      },
                    ],
                    error: null,
                  },
                ],
              },
              { data: [{ id: "org-2", name: "Acme Steel Producer" }], error: null },
            ),
            orgId,
            emissionDataId,
          );

        expect(result?.option.installation_name).toBe(
          "Steel Works B",
        );

        expect(result?.option.provenance).toBe(
          "SHARED",
        );

        // Never the file list, only the count -- see get-buyer-view.ts's
        // own BuyerViewData doc comment on why.
        expect(result?.evidenceFileCount).toBe(
          2,
        );

        expect(result?.declarationContext?.production_process_description).toBe(
          "Kiln-fired at 900C",
        );

        expect(result?.precursors).toHaveLength(
          1,
        );

        expect(result?.precursors[0]?.material_description).toBe(
          "Clinker, purchased",
        );
      },
    );

    it(
      "returns evidenceFileCount 0, declarationContext null, and an empty precursor list when none of that has been captured -- never an error",
      async () => {
        const result =
          await getBuyerView(
            makeMockSupabase(
              {
                emission_data: [
                  { data: [{ ...sharedRow, evidence_file_ids: [] }], error: null },
                  { data: { evidence_file_ids: [] }, error: null },
                ],
                installations: [
                  { data: [{ id: "installation-2", name: "Steel Works B", country: "IN" }], error: null },
                ],
                sharing_grants: [
                  { data: [{ id: "grant-1", installation_id: "installation-2", expires_at: null }], error: null },
                ],
              },
              { data: [{ id: "org-2", name: "Acme Steel Producer" }], error: null },
            ),
            orgId,
            emissionDataId,
          );

        expect(result?.evidenceFileCount).toBe(
          0,
        );

        expect(result?.declarationContext).toBeNull();
        expect(result?.precursors).toEqual(
          [],
        );
      },
    );
  },
);
