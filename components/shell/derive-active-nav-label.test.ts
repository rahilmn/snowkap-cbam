import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveActiveNavLabel,
} from "./derive-active-nav-label";

import {
  IMPORTER_NAV,
  PRODUCER_NAV,
  SETTINGS_NAV,
} from "./sidebar";

const importerAndSettingsNav =
  [...IMPORTER_NAV, ...SETTINGS_NAV];

const producerAndSettingsNav =
  [...PRODUCER_NAV, ...SETTINGS_NAV];

describe(
  "deriveActiveNavLabel",
  () => {
    it(
      "matches the root path to the Dashboard item exactly, never as a prefix of every other route",
      () => {
        expect(
          deriveActiveNavLabel(
            "/",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Dashboard",
        );

        expect(
          deriveActiveNavLabel(
            "/shipments",
            importerAndSettingsNav,
          ),
        ).not.toBe(
          "Dashboard",
        );
      },
    );

    it(
      "matches an exact-href route",
      () => {
        expect(
          deriveActiveNavLabel(
            "/shipments",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Shipments",
        );

        expect(
          deriveActiveNavLabel(
            "/emission-data",
            producerAndSettingsNav,
          ),
        ).toBe(
          "Emissions",
        );
      },
    );

    it(
      "matches a detail/nested route under a top-level href by path-segment prefix",
      () => {
        expect(
          deriveActiveNavLabel(
            "/shipments/abc-123",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Shipments",
        );

        expect(
          deriveActiveNavLabel(
            "/shipments/new",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Shipments",
        );

        expect(
          deriveActiveNavLabel(
            "/declarations/abc-123",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Declarations",
        );
      },
    );

    it(
      "never matches a different route that merely shares a text prefix (path-segment boundary, not string prefix)",
      () => {
        // Not a real pair in this nav today, but proves the boundary
        // rule holds rather than depending on there being no close
        // calls in the current data.
        const items =
          [
            { label: "Ship", icon: importerAndSettingsNav[0].icon, href: "/ship" },
            { label: "Shipments", icon: importerAndSettingsNav[0].icon, href: "/shipments" },
          ];

        expect(
          deriveActiveNavLabel(
            "/shipments",
            items,
          ),
        ).toBe(
          "Shipments",
        );

        expect(
          deriveActiveNavLabel(
            "/shipments",
            items,
          ),
        ).not.toBe(
          "Ship",
        );
      },
    );

    it(
      "matches a SETTINGS_NAV item regardless of which experience's primary nav it's concatenated with",
      () => {
        expect(
          deriveActiveNavLabel(
            "/team",
            importerAndSettingsNav,
          ),
        ).toBe(
          "Team",
        );

        expect(
          deriveActiveNavLabel(
            "/organization",
            producerAndSettingsNav,
          ),
        ).toBe(
          "Organization",
        );
      },
    );

    it(
      "never matches a disabled placeholder item (no href to match against)",
      () => {
        expect(
          deriveActiveNavLabel(
            "/anything",
            producerAndSettingsNav,
          ),
        ).not.toBe(
          "Evidence",
        );

        expect(
          deriveActiveNavLabel(
            "/anything",
            producerAndSettingsNav,
          ),
        ).not.toBe(
          "Internal review",
        );
      },
    );

    it(
      "returns undefined for a route with no corresponding nav item",
      () => {
        expect(
          deriveActiveNavLabel(
            "/status",
            importerAndSettingsNav,
          ),
        ).toBeUndefined();

        expect(
          deriveActiveNavLabel(
            "/account/password",
            importerAndSettingsNav,
          ),
        ).toBeUndefined();

        expect(
          deriveActiveNavLabel(
            "/onboarding/setup",
            importerAndSettingsNav,
          ),
        ).toBeUndefined();
      },
    );

    it(
      "the longer of two matching hrefs wins",
      () => {
        const items =
          [
            { label: "Short", icon: importerAndSettingsNav[0].icon, href: "/a" },
            { label: "Long", icon: importerAndSettingsNav[0].icon, href: "/a/b" },
          ];

        expect(
          deriveActiveNavLabel(
            "/a/b/c",
            items,
          ),
        ).toBe(
          "Long",
        );
      },
    );
  },
);
