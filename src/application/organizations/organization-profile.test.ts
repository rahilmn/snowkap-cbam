import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getOrganizationProfile,
  updateOrganizationProfile,
} from "./organization-profile";

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

function mockSupabase(
  updateError: unknown = null,
) {
  let capturedPayload:
    unknown;

  return {
    client: {
      from: () => (
        {
          update: (
            payload: unknown,
          ) => {
            capturedPayload =
              payload;

            return {
              eq: () =>
                Promise.resolve(
                  { error: updateError },
                ),
            };
          },
        }
      ),
    } as never,

    getCapturedPayload: () =>
      capturedPayload as { capabilities: string[] },
  };
}

function mockSelectSupabase(
  result: { data: unknown; error: unknown },
) {
  return {
    from: () => (
      {
        select: () => (
          {
            eq: () => (
              {
                maybeSingle: () =>
                  Promise.resolve(
                    result,
                  ),
              }
            ),
          }
        ),
      }
    ),
  } as never;
}

describe(
  "getOrganizationProfile",
  () => {
    it(
      "maps the row to an Organization",
      async () => {
        const result =
          await getOrganizationProfile(
            mockSelectSupabase(
              {
                data: {
                  id: "org-1",
                  name: "Acme",
                  slug: "acme",
                  capabilities: ["IMPORTER_DECLARANT"],
                  eori_number: null,
                  cbam_declarant_status: "NOT_REGISTERED",
                  acts_as_indirect_representative: false,
                  country_of_establishment: null,
                  created_at: "2026-01-01T00:00:00Z",
                },
                error: null,
              },
            ),
            "org-1" as never,
          );

        expect(result?.name).toBe(
          "Acme",
        );
      },
    );

    it(
      "returns null when the org doesn't exist (or isn't visible via RLS)",
      async () => {
        const result =
          await getOrganizationProfile(
            mockSelectSupabase(
              { data: null, error: null },
            ),
            "org-1" as never,
          );

        expect(result).toBeNull();
      },
    );

    it(
      "2026-09-07 (S5 review round 5, finding S5R5-A): throws on a genuine query error, distinct from a null row with no error",
      async () => {
        await expect(
          getOrganizationProfile(
            mockSelectSupabase(
              { data: null, error: { message: "connection terminated unexpectedly" } },
            ),
            "org-1" as never,
          ),
        ).rejects.toThrow(
          "connection terminated unexpectedly",
        );
      },
    );
  },
);

describe(
  "updateOrganizationProfile",
  () => {
    it(
      "adds a new capability to the existing set",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await updateOrganizationProfile(
          client,
          ownerContext,
          {
            name: "Acme",
            eoriNumber: null,
            cbamDeclarantStatus: "NOT_REGISTERED",
            countryOfEstablishment: null,
            addCapability: "PRODUCER_OPERATOR",
          },
        );

        expect(getCapturedPayload().capabilities).toEqual(
          ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
        );
      },
    );

    it(
      "does not duplicate a capability the org already has",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await updateOrganizationProfile(
          client,
          ownerContext,
          {
            name: "Acme",
            eoriNumber: null,
            cbamDeclarantStatus: "NOT_REGISTERED",
            countryOfEstablishment: null,
            addCapability: "IMPORTER_DECLARANT",
          },
        );

        expect(getCapturedPayload().capabilities).toEqual(
          ["IMPORTER_DECLARANT"],
        );
      },
    );

    it(
      "leaves capabilities unchanged when addCapability is null",
      async () => {
        const { client, getCapturedPayload } =
          mockSupabase();

        await updateOrganizationProfile(
          client,
          {
            org_id: "org-1",
            user_id: "user-1",
            role: "OWNER",
            capabilities: ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
          } as never,
          {
            name: "Acme",
            eoriNumber: null,
            cbamDeclarantStatus: "NOT_REGISTERED",
            countryOfEstablishment: null,
            addCapability: null,
          },
        );

        expect(getCapturedPayload().capabilities).toEqual(
          ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
        );
      },
    );

    it(
      "returns PERSIST_FAILED when the update errors",
      async () => {
        const { client } =
          mockSupabase(
            { message: "denied" },
          );

        const result =
          await updateOrganizationProfile(
            client,
            ownerContext,
            {
              name: "Acme",
              eoriNumber: null,
              cbamDeclarantStatus: "NOT_REGISTERED",
              countryOfEstablishment: null,
              addCapability: null,
            },
          );

        expect(result).toEqual(
          { status: "PERSIST_FAILED" },
        );
      },
    );

    describe(
      "role gate",
      () => {
        it(
          "rejects PERMISSION_DENIED for an ADMIN, before touching the database (P13 audit follow-up: this gate previously lived only in the calling Server Action, unproven by any test)",
          async () => {
            const { client, getCapturedPayload } =
              mockSupabase();

            const result =
              await updateOrganizationProfile(
                client,
                adminContext,
                {
                  name: "Acme",
                  eoriNumber: null,
                  cbamDeclarantStatus: "NOT_REGISTERED",
                  countryOfEstablishment: null,
                  addCapability: null,
                },
              );

            expect(result).toEqual(
              { status: "PERMISSION_DENIED" },
            );

            expect(getCapturedPayload()).toBeUndefined();
          },
        );

        it(
          "rejects PERMISSION_DENIED for a plain MEMBER",
          async () => {
            const { client } =
              mockSupabase();

            const result =
              await updateOrganizationProfile(
                client,
                memberContext,
                {
                  name: "Acme",
                  eoriNumber: null,
                  cbamDeclarantStatus: "NOT_REGISTERED",
                  countryOfEstablishment: null,
                  addCapability: null,
                },
              );

            expect(result).toEqual(
              { status: "PERMISSION_DENIED" },
            );
          },
        );

        it(
          "allows the OWNER",
          async () => {
            const { client } =
              mockSupabase();

            const result =
              await updateOrganizationProfile(
                client,
                ownerContext,
                {
                  name: "Acme",
                  eoriNumber: null,
                  cbamDeclarantStatus: "NOT_REGISTERED",
                  countryOfEstablishment: null,
                  addCapability: null,
                },
              );

            expect(result).toEqual(
              { status: "OK" },
            );
          },
        );
      },
    );
  },
);
