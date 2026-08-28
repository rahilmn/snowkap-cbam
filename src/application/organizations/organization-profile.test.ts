import {
  describe,
  expect,
  it,
} from "vitest";

import {
  updateOrganizationProfile,
} from "./organization-profile";

const orgId =
  "org-1" as never;

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
          orgId,
          ["IMPORTER_DECLARANT"],
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
          orgId,
          ["IMPORTER_DECLARANT"],
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
          orgId,
          ["IMPORTER_DECLARANT", "PRODUCER_OPERATOR"],
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
            orgId,
            ["IMPORTER_DECLARANT"],
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
  },
);
