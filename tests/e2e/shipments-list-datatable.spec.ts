import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

/**
 * S3 (importer experience), v2.1.1 DataTable foundation. The
 * shipments list is the first screen migrated from a hand-rolled
 * <table> to the new shared DataTable component
 * (components/ui/data-table.tsx) -- this spec proves the real
 * behaviour that component adds: sortable column headers, a mobile
 * card fallback instead of horizontal table compression, and keyboard
 * reachability with a visible focus outline, matching the exact
 * idiom shell.spec.ts's own "accessibility" describe block already
 * established (.focus() -> toBeFocused() -> getComputedStyle
 * outlineWidth check).
 */
test.describe.configure(
  {
    timeout: 120_000,
  },
);

test.describe(
  "shipments list: DataTable",
  () => {
    test(
      "sorting by a column header re-orders the desktop table, and the header announces its own sort state",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "desktop-only: primary nav is hidden below md, and this test is specifically about the desktop table's sort headers",
        );

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        const references =
          [
            `SHIP-DT-${importerOrgSession.runId}-B`,
            `SHIP-DT-${importerOrgSession.runId}-A`,
          ];

        for (
          const reference of references
        ) {
          await page.goto(
            "/shipments",
          );

          await page.getByRole(
            "link",
            { name: "New shipment" },
          ).click();

          await page.getByLabel("Reference").fill(reference);
          await page.getByLabel("Release date").fill("2026-01-15");

          await page.getByRole(
            "button",
            { name: "Create shipment" },
          ).click();

          await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);
        }

        await page.goto(
          "/shipments",
        );

        const referenceHeader =
          page.getByRole(
            "button",
            { name: "Reference" },
          );

        // aria-sort lives on the <th> (per the WAI-ARIA table pattern),
        // not the <button> inside it.
        const referenceColumnHeaderCell =
          page.locator(
            'th:has(button:text("Reference"))',
          );

        await expect(referenceColumnHeaderCell).toHaveAttribute(
          "aria-sort",
          "none",
        );

        // Real rows, real order: default order is newest-created-first
        // (listShipments orders by created_at desc), so B (created
        // first) sorts after A (created second) by default.
        const rowReferences =
          () =>
            page.locator(
              "table tbody tr td:first-child a",
            ).allTextContents();

        await referenceHeader.click();

        await expect(referenceColumnHeaderCell).toHaveAttribute(
          "aria-sort",
          "ascending",
        );

        await expect
          .poll(
            rowReferences,
          ).toEqual(
            [...references].sort(),
          );

        await referenceHeader.click();

        await expect(referenceColumnHeaderCell).toHaveAttribute(
          "aria-sort",
          "descending",
        );

        await expect
          .poll(
            rowReferences,
          ).toEqual(
            [...references].sort().reverse(),
          );
      },
    );

    test(
      "a sort-header button is keyboard-reachable with a visible focus outline",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "desktop-only: sort headers only render in the desktop table variant",
        );

        await page.goto(
          "/shipments",
        );

        await page.getByRole(
          "link",
          { name: "New shipment" },
        ).click();

        await page.getByLabel("Reference").fill(`SHIP-DT-KB-${importerOrgSession.runId}`);
        await page.getByLabel("Release date").fill("2026-01-15");

        await page.getByRole(
          "button",
          { name: "Create shipment" },
        ).click();

        await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

        await page.goto(
          "/shipments",
        );

        const referenceHeader =
          page.getByRole(
            "button",
            { name: "Reference" },
          );

        await referenceHeader.focus();

        await expect(referenceHeader).toBeFocused();

        // A visible focus outline is present (design system rule --
        // app/globals.css :focus-visible), same check shell.spec.ts's
        // own accessibility suite uses for the theme toggle.
        const outlineWidth =
          await referenceHeader.evaluate(
            (el) => getComputedStyle(el).outlineWidth,
          );

        expect(outlineWidth).not.toBe("0px");
      },
    );

    test(
      "at mobile width, the shipments list renders as stacked cards instead of a horizontally-compressed table, with no horizontal overflow",
      async (
        {
          page,
          importerOrgSession,
        },
      ) => {
        const reference =
          `SHIP-DT-MOBILE-${importerOrgSession.runId}`;

        // Create at desktop width -- shipment intake needs the primary
        // nav, hidden below md (same skip discipline as every other
        // spec in this suite).
        await page.setViewportSize(
          { width: 1280, height: 800 },
        );

        await page.goto(
          "/shipments",
        );

        await page.getByRole(
          "link",
          { name: "New shipment" },
        ).click();

        await page.getByLabel("Reference").fill(reference);
        await page.getByLabel("Release date").fill("2026-01-15");

        await page.getByRole(
          "button",
          { name: "Create shipment" },
        ).click();

        await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

        await page.setViewportSize(
          { width: 375, height: 812 },
        );

        await page.goto(
          "/shipments",
        );

        // The desktop <table> is hidden entirely at mobile width.
        await expect(
          page.locator("table"),
        ).toBeHidden();

        // The row renders as a card instead -- reachable by its own
        // reference link, same as the desktop table's first column.
        await expect(
          page.getByRole(
            "link",
            { name: reference },
          ),
        ).toBeVisible();

        const overflow =
          await page.evaluate(
            () =>
              document.body.scrollWidth >
              window.innerWidth,
          );

        expect(overflow).toBe(false);
      },
    );
  },
);
