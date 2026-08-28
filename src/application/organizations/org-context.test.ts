import {
  describe,
  expect,
  it,
} from "vitest";

import {
  hasAdminAccess,
  hasCapability,
  type OrgContext,
} from "./org-context";

function context(
  overrides: Partial<OrgContext> = {},
): OrgContext {
  return {
    org_id:
      "org-1" as OrgContext["org_id"],

    user_id:
      "user-1" as OrgContext["user_id"],

    role:
      "MEMBER",

    capabilities:
      [],

    ...overrides,
  };
}

describe(
  "hasAdminAccess",
  () => {
    it(
      "is true for OWNER",
      () => {
        expect(
          hasAdminAccess(
            context(
              { role: "OWNER" },
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is true for ADMIN",
      () => {
        expect(
          hasAdminAccess(
            context(
              { role: "ADMIN" },
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is false for MEMBER",
      () => {
        expect(
          hasAdminAccess(
            context(
              { role: "MEMBER" },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "hasCapability",
  () => {
    it(
      "is true when the org holds the capability",
      () => {
        expect(
          hasCapability(
            context(
              { capabilities: ["IMPORTER_DECLARANT"] },
            ),
            "IMPORTER_DECLARANT",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is false when the org does not hold the capability",
      () => {
        expect(
          hasCapability(
            context(
              { capabilities: ["IMPORTER_DECLARANT"] },
            ),
            "PRODUCER_OPERATOR",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is true for both capabilities when the org holds both",
      () => {
        const dualCapabilityContext =
          context(
            {
              capabilities: [
                "IMPORTER_DECLARANT",
                "PRODUCER_OPERATOR",
              ],
            },
          );

        expect(
          hasCapability(
            dualCapabilityContext,
            "IMPORTER_DECLARANT",
          ),
        ).toBe(
          true,
        );

        expect(
          hasCapability(
            dualCapabilityContext,
            "PRODUCER_OPERATOR",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);
