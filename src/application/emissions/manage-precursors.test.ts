import {
  describe,
  expect,
  it,
} from "vitest";

import {
  addPrecursor,
  listPrecursors,
  removePrecursor,
} from "./manage-precursors";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const userId =
  "user-1" as never;

const emissionDataId =
  "ed-1" as never;

const precursorId =
  "pre-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["PRODUCER_OPERATOR"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: userId,
    role: "MEMBER",
    capabilities,
  };
}

const DEFAULT_PRECURSOR_ROW =
  {
    id: "pre-1",
    emission_data_id: "ed-1",
    material_description: "Clinker, purchased",
    cn_code: "25231000",
    source_description: "Acme Cement, DE",
    direct_specific: "0.850",
    indirect_specific: "0.120",
    emission_unit: "TCO2E_PER_TONNE",
    provenance: "ACTUAL_WITH_DECLARED_REPORT",
    verifier_report_description: "TÜV Rheinland, 2026-02",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
  };

function mockSupabase(
  {
    emissionDataFetchResult = {
      data: { org_id: "org-1", status: "DRAFT" },
      error: null,
    },
    insertResult = {
      data: DEFAULT_PRECURSOR_ROW,
      error: null,
    },
    listResult = {
      data: [],
      error: null,
    },
    precursorFetchResult = {
      data: { id: "pre-1", org_id: "org-1", emission_data_id: "ed-1" },
      error: null,
    },
    deleteResult = {
      error: null,
    },
  }: {
    emissionDataFetchResult?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    listResult?: { data: unknown; error: unknown };
    precursorFetchResult?: { data: unknown; error: unknown };
    deleteResult?: { error: unknown };
  } = {},
) {
  return {
    from: (
      table: string,
    ) => {
      if (table === "audit_events") {
        return {
          insert: () =>
            Promise.resolve(
              { error: null },
            ),
        };
      }

      if (table === "emission_data") {
        return {
          select: () => (
            {
              eq: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      emissionDataFetchResult,
                    ),
                }
              ),
            }
          ),
        };
      }

      // emission_data_precursors. The three real call shapes from
      // manage-precursors.ts are told apart by their own distinct
      // chain, not by a shared generic path:
      //   listPrecursors:    .select(FULL_COLUMNS).eq(org).eq(edId).order(...)   -- two .eq() calls, ends in .order()
      //   removePrecursor's fetch: .select("id, org_id, emission_data_id").eq("id", ...).maybeSingle() -- ONE .eq() call, narrow column list
      //   addPrecursor's insert:   .insert({...}).select(FULL_COLUMNS).single()  -- via the separate `insert` handler below, never this `select`
      // The narrow-column-list check below (`columns.includes("org_id")`)
      // is what distinguishes removePrecursor's single-.eq() fetch from
      // a hypothetical single-.eq() list call -- this mock has none of
      // the latter today, but the check documents why it's safe to key
      // off column shape rather than call-count alone.
      return {
        select: (columns: string) => (
          {
            eq: (col: string) => (
              {
                eq: () => (
                  {
                    order: () =>
                      Promise.resolve(
                        listResult,
                      ),

                    maybeSingle: () =>
                      Promise.resolve(
                        precursorFetchResult,
                      ),
                  }
                ),

                maybeSingle: () =>
                  Promise.resolve(
                    columns.includes("org_id") && col === "id"
                      ? precursorFetchResult
                      : listResult,
                  ),

                single: () =>
                  Promise.resolve(
                    insertResult,
                  ),
              }
            ),
          }
        ),

        insert: () => (
          {
            select: () => (
              {
                single: () =>
                  Promise.resolve(
                    insertResult,
                  ),
              }
            ),
          }
        ),

        delete: () => (
          {
            eq: () => (
              {
                eq: () =>
                  Promise.resolve(
                    deleteResult,
                  ),
              }
            ),
          }
        ),
      };
    },
  } as never;
}

describe(
  "addPrecursor",
  () => {
    it(
      "rejects when the caller holds neither capability",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(),
            memberContext(
              [],
            ),
            {
              emissionDataId,
              materialDescription: "Clinker",
              cnCode: null,
              sourceDescription: null,
              directSpecific: null,
              indirectSpecific: null,
              emissionUnit: null,
              provenance: "UNKNOWN",
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );
      },
    );

    it(
      "rejects an empty material description",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "   ",
              cnCode: null,
              sourceDescription: null,
              directSpecific: null,
              indirectSpecific: null,
              emissionUnit: null,
              provenance: "UNKNOWN",
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMPTY_MATERIAL_DESCRIPTION" },
        );
      },
    );

    it(
      "rejects a non-numeric direct_specific",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "Clinker",
              cnCode: null,
              sourceDescription: null,
              directSpecific: "not-a-number",
              indirectSpecific: null,
              emissionUnit: null,
              provenance: "ACTUAL_NO_DECLARED_REPORT",
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "INVALID_DIRECT_SPECIFIC" },
        );
      },
    );

    it(
      "rejects a verifier report description without ACTUAL_WITH_DECLARED_REPORT provenance -- never lets a report be claimed for an unknown or undeclared figure",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "Clinker",
              cnCode: null,
              sourceDescription: null,
              directSpecific: "0.850",
              indirectSpecific: null,
              emissionUnit: "TCO2E_PER_TONNE",
              provenance: "ACTUAL_NO_DECLARED_REPORT",
              verifierReportDescription: "TÜV Rheinland, 2026-02",
            },
          );

        expect(result).toEqual(
          {
            status: "REJECTED",
            reason: "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARED_REPORT",
          },
        );
      },
    );

    it(
      "never invents a SEE value -- UNKNOWN provenance with no figures is accepted as a complete, honest row",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(
              {
                insertResult: {
                  data: {
                    ...DEFAULT_PRECURSOR_ROW,
                    direct_specific: null,
                    indirect_specific: null,
                    provenance: "UNKNOWN",
                    verifier_report_description: null,
                  },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "Unknown precursor material",
              cnCode: null,
              sourceDescription: null,
              directSpecific: null,
              indirectSpecific: null,
              emissionUnit: null,
              provenance: "UNKNOWN",
              verifierReportDescription: null,
            },
          );

        expect(result.status).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(result.precursor.direct_specific).toBeNull();
          expect(result.precursor.provenance).toBe(
            "UNKNOWN",
          );
        }
      },
    );

    it(
      "rejects once the parent emission_data record has left DRAFT",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-1", status: "ACTIVE" },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "Clinker",
              cnCode: null,
              sourceDescription: null,
              directSpecific: null,
              indirectSpecific: null,
              emissionUnit: null,
              provenance: "UNKNOWN",
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
        );
      },
    );

    it(
      "creates a full ACTUAL_WITH_DECLARED_REPORT precursor row",
      async () => {
        const result =
          await addPrecursor(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              materialDescription: "Clinker, purchased",
              cnCode: "25231000",
              sourceDescription: "Acme Cement, DE",
              directSpecific: "0.850",
              indirectSpecific: "0.120",
              emissionUnit: "TCO2E_PER_TONNE",
              provenance: "ACTUAL_WITH_DECLARED_REPORT",
              verifierReportDescription: "TÜV Rheinland, 2026-02",
            },
          );

        expect(result).toEqual(
          {
            status: "OK",
            precursor: {
              id: "pre-1",
              emission_data_id: "ed-1",
              material_description: "Clinker, purchased",
              cn_code: "25231000",
              source_description: "Acme Cement, DE",
              direct_specific: "0.850",
              indirect_specific: "0.120",
              emission_unit: "TCO2E_PER_TONNE",
              provenance: "ACTUAL_WITH_DECLARED_REPORT",
              verifier_report_description: "TÜV Rheinland, 2026-02",
              created_at: "2026-09-06T00:00:00.000Z",
              updated_at: "2026-09-06T00:00:00.000Z",
            },
          },
        );
      },
    );
  },
);

describe(
  "listPrecursors",
  () => {
    it(
      "returns an empty list, not an error, when nothing has been added yet",
      async () => {
        const result =
          await listPrecursors(
            mockSupabase(),
            orgId,
            emissionDataId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "removePrecursor",
  () => {
    it(
      "rejects when the caller holds neither capability",
      async () => {
        const result =
          await removePrecursor(
            mockSupabase(),
            memberContext(
              [],
            ),
            precursorId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );
      },
    );

    it(
      "reports PRECURSOR_NOT_FOUND for a different org's row -- not-found, not forbidden",
      async () => {
        const result =
          await removePrecursor(
            mockSupabase(
              {
                precursorFetchResult: {
                  data: { id: "pre-1", org_id: "org-2", emission_data_id: "ed-1" },
                  error: null,
                },
              },
            ),
            memberContext(),
            precursorId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PRECURSOR_NOT_FOUND" },
        );
      },
    );

    it(
      "removes an own-org precursor while the parent record is still DRAFT",
      async () => {
        const result =
          await removePrecursor(
            mockSupabase(),
            memberContext(),
            precursorId,
          );

        expect(result).toEqual(
          { status: "OK" },
        );
      },
    );

    it(
      "rejects once the parent emission_data record has left DRAFT",
      async () => {
        const result =
          await removePrecursor(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-1", status: "ACTIVE" },
                  error: null,
                },
              },
            ),
            memberContext(),
            precursorId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_NOT_DRAFT" },
        );
      },
    );
  },
);
