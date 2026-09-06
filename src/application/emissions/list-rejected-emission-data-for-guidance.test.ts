import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listRejectedEmissionDataForGuidance,
} from "./list-rejected-emission-data-for-guidance";

const orgId =
  "org-1" as never;

function mockSupabase(
  {
    emissionDataResult = { data: [], error: null },
    installationsResult = { data: [], error: null },
  }: {
    emissionDataResult?: { data: unknown; error: unknown };
    installationsResult?: { data: unknown; error: unknown };
  } = {},
) {
  const filters: Record<string, [string, unknown][]> =
    {};

  return {
    from: (
      table: string,
    ) => {
      filters[table] =
        [];

      const chain = {
        select: () => chain,
        eq: (
          col: string,
          val: unknown,
        ) => {
          filters[table]!.push(
            [col, val],
          );

          return chain;
        },
        in: (
          col: string,
          val: unknown,
        ) => {
          filters[table]!.push(
            [col, val],
          );

          return chain;
        },
        then: (
          resolve: (result: { data: unknown; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === "emission_data" ? emissionDataResult : installationsResult,
          ).then(
            resolve,
            reject,
          ),
      };

      return chain;
    },
    __filters: filters,
  } as never;
}

describe(
  "listRejectedEmissionDataForGuidance",
  () => {
    it(
      "returns an empty array with no follow-up installations query when there are no rejected records",
      async () => {
        const result =
          await listRejectedEmissionDataForGuidance(
            mockSupabase(),
            orgId,
          );

        expect(result).toEqual(
          [],
        );
      },
    );

    it(
      "resolves each record's installation name via a follow-up query",
      async () => {
        const result =
          await listRejectedEmissionDataForGuidance(
            mockSupabase(
              {
                emissionDataResult: {
                  data: [
                    { id: "ed-1", installation_id: "inst-1", rejection_reason: "Missing evidence" },
                  ],
                  error: null,
                },
                installationsResult: {
                  data: [
                    { id: "inst-1", name: "Steel Works A" },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
          );

        expect(result).toEqual(
          [
            {
              id: "ed-1",
              installation_id: "inst-1",
              installation_name: "Steel Works A",
              rejection_reason: "Missing evidence",
            },
          ],
        );
      },
    );

    it(
      "degrades a single record to 'Unknown installation' if the installation lookup doesn't return it -- never crashes",
      async () => {
        const result =
          await listRejectedEmissionDataForGuidance(
            mockSupabase(
              {
                emissionDataResult: {
                  data: [
                    { id: "ed-1", installation_id: "inst-1", rejection_reason: null },
                  ],
                  error: null,
                },
                installationsResult: {
                  data: [],
                  error: null,
                },
              },
            ),
            orgId,
          );

        expect(result[0]?.installation_name).toBe(
          "Unknown installation",
        );
      },
    );

    it(
      "throws on a genuine emission_data fetch error -- never silently returns [] the same way a real absence of rejected records does (S5 cross-phase hardening)",
      async () => {
        await expect(
          listRejectedEmissionDataForGuidance(
            mockSupabase(
              {
                emissionDataResult: { data: null, error: { message: "boom" } },
              },
            ),
            orgId,
          ),
        ).rejects.toThrow(
          "boom",
        );
      },
    );

    it(
      "throws on a genuine installations fetch error",
      async () => {
        await expect(
          listRejectedEmissionDataForGuidance(
            mockSupabase(
              {
                emissionDataResult: {
                  data: [
                    { id: "ed-1", installation_id: "inst-1", rejection_reason: null },
                  ],
                  error: null,
                },
                installationsResult: { data: null, error: { message: "boom" } },
              },
            ),
            orgId,
          ),
        ).rejects.toThrow(
          "boom",
        );
      },
    );
  },
);
