import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getOrganizationSmeProfile,
  upsertOrganizationSmeProfile,
} from "./organization-sme-profile";

const ownerContext =
  {
    org_id: "org-1",
    user_id: "user-1",
    role: "OWNER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const adminContext =
  {
    org_id: "org-1",
    user_id: "user-2",
    role: "ADMIN",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

const memberContext =
  {
    org_id: "org-1",
    user_id: "user-3",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

interface MockOptions {
  existingRow?: Record<string, unknown> | null;
  selectError?: unknown;
  upsertResult?: Record<string, unknown> | null;
  upsertError?: unknown;
}

function mockSupabase(
  {
    existingRow = null,
    selectError = null,
    upsertResult,
    upsertError = null,
  }: MockOptions = {},
) {
  let capturedUpsertPayload:
    unknown;

  return {
    client: {
      from: () => (
        {
          select: () => (
            {
              eq: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      { data: existingRow, error: selectError },
                    ),
                }
              ),
            }
          ),

          upsert: (
            payload: unknown,
          ) => {
            capturedUpsertPayload =
              payload;

            return {
              select: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      {
                        data:
                          upsertError
                            ? null
                            : upsertResult !== undefined
                              ? upsertResult
                              : {
                                  org_id: "org-1",
                                  sectors: (payload as { sectors: string[] }).sectors,
                                  onboarding_completed_at: (payload as { onboarding_completed_at: string | null }).onboarding_completed_at,
                                  updated_at: "2026-09-05T00:00:00Z",
                                  updated_by_user_id: "user-1",
                                },
                        error: upsertError,
                      },
                    ),
                }
              ),
            };
          },
        }
      ),
    } as never,

    getCapturedUpsertPayload: () =>
      capturedUpsertPayload as { org_id: string; sectors: string[]; onboarding_completed_at: string | null },
  };
}

describe(
  "getOrganizationSmeProfile",
  () => {
    it(
      "returns null when no profile row exists yet -- never taken as an error, matching an org that has not been through onboarding-setup",
      async () => {
        const { client } =
          mockSupabase();

        const result =
          await getOrganizationSmeProfile(
            client,
            "org-1" as never,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "maps a real row",
      async () => {
        const { client } =
          mockSupabase(
            {
              existingRow: {
                org_id: "org-1",
                sectors: ["IRON_STEEL", "ALUMINIUM"],
                onboarding_completed_at: "2026-09-01T00:00:00Z",
                updated_at: "2026-09-01T00:00:00Z",
                updated_by_user_id: "user-1",
              },
            },
          );

        const result =
          await getOrganizationSmeProfile(
            client,
            "org-1" as never,
          );

        expect(result).toEqual(
          {
            org_id: "org-1",
            sectors: ["IRON_STEEL", "ALUMINIUM"],
            onboarding_completed_at: "2026-09-01T00:00:00Z",
            updated_at: "2026-09-01T00:00:00Z",
            updated_by_user_id: "user-1",
          },
        );
      },
    );
  },
);

describe(
  "upsertOrganizationSmeProfile",
  () => {
    describe(
      "role gate",
      () => {
        it(
          "rejects PERMISSION_DENIED for a plain MEMBER, before touching the database",
          async () => {
            const { client, getCapturedUpsertPayload } =
              mockSupabase();

            const result =
              await upsertOrganizationSmeProfile(
                client,
                memberContext,
                ["CEMENT"],
              );

            expect(result).toEqual(
              { status: "PERMISSION_DENIED" },
            );

            expect(getCapturedUpsertPayload()).toBeUndefined();
          },
        );

        it(
          "allows an ADMIN",
          async () => {
            const { client } =
              mockSupabase();

            const result =
              await upsertOrganizationSmeProfile(
                client,
                adminContext,
                ["CEMENT"],
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );

        it(
          "allows the OWNER",
          async () => {
            const { client } =
              mockSupabase();

            const result =
              await upsertOrganizationSmeProfile(
                client,
                ownerContext,
                ["CEMENT"],
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );
      },
    );

    it(
      "sets onboarding_completed_at the first time sectors becomes non-empty",
      async () => {
        const { client, getCapturedUpsertPayload } =
          mockSupabase(
            { existingRow: null },
          );

        await upsertOrganizationSmeProfile(
          client,
          ownerContext,
          ["CEMENT", "FERTILISERS"],
        );

        expect(getCapturedUpsertPayload().onboarding_completed_at).not.toBeNull();
      },
    );

    it(
      "leaves onboarding_completed_at null when sectors is empty and no row exists yet",
      async () => {
        const { client, getCapturedUpsertPayload } =
          mockSupabase(
            { existingRow: null },
          );

        await upsertOrganizationSmeProfile(
          client,
          ownerContext,
          [],
        );

        expect(getCapturedUpsertPayload().onboarding_completed_at).toBeNull();
      },
    );

    it(
      "never moves onboarding_completed_at backwards or resets it on a later edit -- \"finished setup\" is a one-way fact about the org",
      async () => {
        const { client, getCapturedUpsertPayload } =
          mockSupabase(
            {
              existingRow: {
                org_id: "org-1",
                sectors: ["CEMENT"],
                onboarding_completed_at: "2026-09-01T00:00:00Z",
                updated_at: "2026-09-01T00:00:00Z",
                updated_by_user_id: "user-1",
              },
            },
          );

        await upsertOrganizationSmeProfile(
          client,
          ownerContext,
          [],
        );

        expect(getCapturedUpsertPayload().onboarding_completed_at).toBe(
          "2026-09-01T00:00:00Z",
        );
      },
    );

    it(
      "the upsert payload never includes updated_at or updated_by_user_id -- both are pinned by the database trigger, never accepted from the caller",
      async () => {
        const { client, getCapturedUpsertPayload } =
          mockSupabase();

        await upsertOrganizationSmeProfile(
          client,
          ownerContext,
          ["HYDROGEN"],
        );

        const payload =
          getCapturedUpsertPayload();

        expect(payload).not.toHaveProperty(
          "updated_at",
        );

        expect(payload).not.toHaveProperty(
          "updated_by_user_id",
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the upsert errors",
      async () => {
        const { client } =
          mockSupabase(
            { upsertError: { message: "denied" } },
          );

        const result =
          await upsertOrganizationSmeProfile(
            client,
            ownerContext,
            ["CEMENT"],
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "is idempotent: calling twice with the same sectors returns the same declared sectors both times",
      async () => {
        const { client } =
          mockSupabase();

        const first =
          await upsertOrganizationSmeProfile(
            client,
            ownerContext,
            ["IRON_STEEL"],
          );

        const second =
          await upsertOrganizationSmeProfile(
            client,
            ownerContext,
            ["IRON_STEEL"],
          );

        expect(first.status).toBe(
          "OK",
        );

        expect(second.status).toBe(
          "OK",
        );

        if (first.status === "OK" && second.status === "OK") {
          expect(first.profile.sectors).toEqual(
            second.profile.sectors,
          );
        }
      },
    );
  },
);
