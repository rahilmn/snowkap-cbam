import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getDeclarationContext,
  upsertDeclarationContext,
} from "./manage-declaration-context";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const userId =
  "user-1" as never;

const emissionDataId =
  "ed-1" as never;

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

function mockSupabase(
  {
    emissionDataFetchResult = {
      data: { org_id: "org-1", status: "DRAFT", verification_status: "UNVERIFIED" },
      error: null,
    },
    upsertResult = {
      data: {
        id: "ctx-1",
        emission_data_id: "ed-1",
        production_process_description: "Kiln-fired at 900C",
        uses_purchased_precursors: false,
        verifier_report_declared: false,
        verifier_report_description: null,
        created_at: "2026-09-06T00:00:00.000Z",
        updated_at: "2026-09-06T00:00:00.000Z",
      },
      error: null,
    },
    selectResult = {
      data: null,
      error: null,
    },
  }: {
    emissionDataFetchResult?: { data: unknown; error: unknown };
    upsertResult?: { data: unknown; error: unknown };
    selectResult?: { data: unknown; error: unknown };
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

      // emission_data_declaration_context
      return {
        select: () => (
          {
            eq: () => (
              {
                eq: () => (
                  {
                    maybeSingle: () =>
                      Promise.resolve(
                        selectResult,
                      ),
                  }
                ),
              }
            ),
          }
        ),

        upsert: () => (
          {
            select: () => (
              {
                single: () =>
                  Promise.resolve(
                    upsertResult,
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
  "upsertDeclarationContext",
  () => {
    it(
      "rejects when the caller holds neither PRODUCER_OPERATOR nor IMPORTER_DECLARANT",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(),
            memberContext(
              [],
            ),
            {
              emissionDataId,
              productionProcessDescription: null,
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
        );
      },
    );

    it(
      "rejects a verifier report description supplied without declaring a report exists",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: null,
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: "Some verifier, 2026",
            },
          );

        expect(result).toEqual(
          {
            status: "REJECTED",
            reason: "VERIFIER_REPORT_DESCRIPTION_WITHOUT_DECLARATION",
          },
        );
      },
    );

    it(
      "rejects when the referenced emission_data row belongs to a different org (not-found, not forbidden)",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-2", status: "DRAFT" },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: null,
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_NOT_FOUND" },
        );
      },
    );

    it(
      "rejects once the parent emission_data record has left DRAFT -- context is locked, per v2.1.1's post-verification locking",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-1", status: "ACTIVE", verification_status: "VERIFIED" },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: "Updated after publish",
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_LOCKED" },
        );
      },
    );

    it(
      "rejects a DRAFT + VERIFIED record too -- a producer can leave a record DRAFT indefinitely after verification succeeds before choosing to ACTIVATE it, and v2.1.1 says 'post-VERIFICATION locking', not 'post-activation locking'",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-1", status: "DRAFT", verification_status: "VERIFIED" },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: "Updated after verification succeeded",
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "RECORD_LOCKED" },
        );
      },
    );

    it(
      "still allows editing a DRAFT record whose verification is only PENDING (not yet VERIFIED)",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(
              {
                emissionDataFetchResult: {
                  data: { org_id: "org-1", status: "DRAFT", verification_status: "VERIFICATION_PENDING" },
                  error: null,
                },
              },
            ),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: "Still editable while pending",
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result.status).toBe(
          "OK",
        );
      },
    );

    it(
      "creates/updates the context and returns it when everything checks out",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(),
            memberContext(),
            {
              emissionDataId,
              productionProcessDescription: "Kiln-fired at 900C",
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result.status).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(result.context.production_process_description).toBe(
            "Kiln-fired at 900C",
          );

          expect(result.context.emission_data_id).toBe(
            "ed-1",
          );
        }
      },
    );

    it(
      "an IMPORTER_DECLARANT-only org may also upsert (mirrors mayManageOwnInstallationRecords' own D2 posture)",
      async () => {
        const result =
          await upsertDeclarationContext(
            mockSupabase(),
            memberContext(
              ["IMPORTER_DECLARANT"],
            ),
            {
              emissionDataId,
              productionProcessDescription: null,
              usesPurchasedPrecursors: false,
              verifierReportDeclared: false,
              verifierReportDescription: null,
            },
          );

        expect(result.status).toBe(
          "OK",
        );
      },
    );
  },
);

describe(
  "getDeclarationContext",
  () => {
    it(
      "returns null when no context has been captured yet -- not an error",
      async () => {
        const result =
          await getDeclarationContext(
            mockSupabase(),
            orgId,
            emissionDataId,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "returns the context when one exists",
      async () => {
        const result =
          await getDeclarationContext(
            mockSupabase(
              {
                selectResult: {
                  data: {
                    id: "ctx-1",
                    emission_data_id: "ed-1",
                    production_process_description: "Kiln-fired at 900C",
                    uses_purchased_precursors: true,
                    verifier_report_declared: true,
                    verifier_report_description: "TÜV, 2026-01",
                    created_at: "2026-09-06T00:00:00.000Z",
                    updated_at: "2026-09-06T00:00:00.000Z",
                  },
                  error: null,
                },
              },
            ),
            orgId,
            emissionDataId,
          );

        expect(result?.uses_purchased_precursors).toBe(
          true,
        );

        expect(result?.verifier_report_description).toBe(
          "TÜV, 2026-01",
        );
      },
    );
  },
);
