import {
  describe,
  expect,
  it,
} from "vitest";

import {
  capabilityAllowsProvenance,
  mayManageOwnInstallationRecords,
} from "./provenance-capability";

import type {
  OrgContext,
} from "../organizations/org-context";

function context(
  capabilities: string[],
): OrgContext {
  return {
    org_id: "org-1" as never,
    user_id: "user-1" as never,
    role: "MEMBER",
    capabilities: capabilities as never,
  };
}

describe(
  "capabilityAllowsProvenance (owner decision D2)",
  () => {
    it(
      "lets a producer claim OPERATOR_PROVIDED",
      () => {
        expect(
          capabilityAllowsProvenance(
            context(["PRODUCER_OPERATOR"]),
            "OPERATOR_PROVIDED",
          ),
        ).toBe(true);
      },
    );

    it(
      "lets an importer claim IMPORTER_ENTERED",
      () => {
        // The whole point of D2. Before it, this returned nothing
        // because the concept had no gate to pass -- the services
        // required PRODUCER_OPERATOR outright, so an importer could not
        // record an external operator at all.
        expect(
          capabilityAllowsProvenance(
            context(["IMPORTER_DECLARANT"]),
            "IMPORTER_ENTERED",
          ),
        ).toBe(true);
      },
    );

    it(
      "does NOT let an importer claim OPERATOR_PROVIDED",
      () => {
        // The distinction D2 exists to protect. IMPORTER_ENTERED means
        // "transcribed from an external operator"; OPERATOR_PROVIDED
        // means "the operator entered this themselves". An importer
        // claiming the latter would be asserting something about
        // someone else's attestation.
        expect(
          capabilityAllowsProvenance(
            context(["IMPORTER_DECLARANT"]),
            "OPERATOR_PROVIDED",
          ),
        ).toBe(false);
      },
    );

    it(
      "does NOT let a producer claim IMPORTER_ENTERED",
      () => {
        expect(
          capabilityAllowsProvenance(
            context(["PRODUCER_OPERATOR"]),
            "IMPORTER_ENTERED",
          ),
        ).toBe(false);
      },
    );

    it(
      "lets an organization holding BOTH capabilities claim either",
      () => {
        // Correct rather than a loophole: such an organization
        // genuinely does both things, and it is the RECORD's provenance
        // -- not the organization's -- that describes where a number
        // came from.
        const dual =
          context(["PRODUCER_OPERATOR", "IMPORTER_DECLARANT"]);

        expect(
          capabilityAllowsProvenance(dual, "OPERATOR_PROVIDED"),
        ).toBe(true);

        expect(
          capabilityAllowsProvenance(dual, "IMPORTER_ENTERED"),
        ).toBe(true);
      },
    );

    it(
      "lets an organization holding neither capability claim nothing",
      () => {
        const none =
          context([]);

        expect(
          capabilityAllowsProvenance(none, "OPERATOR_PROVIDED"),
        ).toBe(false);

        expect(
          capabilityAllowsProvenance(none, "IMPORTER_ENTERED"),
        ).toBe(false);
      },
    );
  },
);

describe(
  "mayManageOwnInstallationRecords",
  () => {
    it.each(
      [
        ["PRODUCER_OPERATOR"],
        ["IMPORTER_DECLARANT"],
        ["PRODUCER_OPERATOR", "IMPORTER_DECLARANT"],
      ],
    )(
      "admits an organization holding %s",
      (...capabilities) => {
        expect(
          mayManageOwnInstallationRecords(
            context(capabilities as string[]),
          ),
        ).toBe(true);
      },
    );

    it(
      "refuses an organization holding neither",
      () => {
        expect(
          mayManageOwnInstallationRecords(
            context([]),
          ),
        ).toBe(false);
      },
    );
  },
);
