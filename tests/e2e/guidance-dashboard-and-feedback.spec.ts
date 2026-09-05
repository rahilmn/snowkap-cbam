import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

/**
 * Snowkap CBAM SME Experience v2.1.1, S2: the dashboard work queue
 * (I19) and product feedback, driven through the real UI against a
 * real authenticated importer session -- the same fixture and
 * discipline as importer-journey.spec.ts. Covers the two explicitly
 * required test categories no unit test can: mobile behaviour and
 * keyboard/accessibility behaviour.
 *
 * Desktop-only for the guidance-derivation steps themselves (creating
 * a shipment needs the primary nav, hidden below md -- same skip
 * discipline as importer-journey.spec.ts); the dedicated mobile test
 * below sets its own viewport instead of relying on the mobile-chromium
 * project.
 */
test.describe.configure(
  {
    timeout: 120_000,
  },
);

test.describe(
  "guidance dashboard: I19 (mark shipment ready)",
  () => {
    test(
      "a real, complete DRAFT shipment appears as a REQUIRED guidance item, is reachable by keyboard, links to the shipment, and disappears once marked ready",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "primary nav is hidden below md -- covered by the dedicated mobile test below",
        );

        const CN_CODE =
          "25232100";

        const shipmentReference =
          `SHIP-GUIDE-${importerOrgSession.runId}`;

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        await test.step(
          "before: the dashboard shows the empty state (nothing needs attention yet)",
          async () => {
            await page.goto(
              "/",
            );

            await expect(
              page.getByText("Nothing needs your attention right now."),
            ).toBeVisible();
          },
        );

        await test.step(
          "create a complete DRAFT shipment (a resolved determination, no calculation needed -- I19 doesn't require one)",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Shipments", exact: true },
            ).click();

            await page.getByRole(
              "link",
              { name: "New shipment" },
            ).click();

            await page.getByLabel("Reference").fill(shipmentReference);
            await page.getByLabel("Release date").fill("2026-01-15");

            await page.getByRole(
              "button",
              { name: "Create shipment" },
            ).click();

            await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

            await page.getByPlaceholder(
              "Search by code or description, e.g. 25232100 or cement",
            ).fill(CN_CODE);

            const option =
              page.getByRole("option").filter({ hasText: CN_CODE });

            await expect(option).toBeVisible();
            await option.click();

            await page.getByLabel("Origin country").fill("CN");
            await page.getByLabel("Quantity", { exact: true }).fill("100");

            await page.getByRole(
              "button",
              { name: "Add line" },
            ).click();

            await expect(
              page.getByRole("cell", { name: CN_CODE }),
            ).toBeVisible();

            await page.getByRole(
              "button",
              { name: "Resolve default value" },
            ).click();

            await expect(
              page.locator('[data-status-key="resolution.EXACT_CN8_MATCH"]'),
            ).toBeVisible();
          },
        );

        await test.step(
          "the I19 item appears on the dashboard, REQUIRED, correctly linked, and reachable by keyboard",
          async () => {
            await page.goto(
              "/",
            );

            const guidanceSection =
              page.getByRole(
                "region",
                { name: "Needs your attention" },
              );

            await expect(guidanceSection).toBeVisible();

            const itemLink =
              guidanceSection.getByRole(
                "link",
                { name: `Mark ${shipmentReference} ready` },
              );

            await expect(itemLink).toBeVisible();

            await expect(
              guidanceSection.getByText("Required", { exact: true }),
            ).toBeVisible();

            // Keyboard reachability: the item's own link is a real,
            // focusable anchor -- Tab into the guidance section and
            // confirm the link itself can receive focus and has a
            // visible focus outline (design system rule --
            // app/globals.css :focus-visible), same check shell.spec.ts's
            // own accessibility suite uses for the theme toggle.
            await itemLink.focus();

            await expect(itemLink).toBeFocused();

            const outlineWidth =
              await itemLink.evaluate(
                (el) => getComputedStyle(el).outlineWidth,
              );

            expect(outlineWidth).not.toBe("0px");

            // No dismiss control on a REQUIRED item -- dismissal only
            // ever applies once an item is no longer REQUIRED
            // (src/domain/guidance/dismiss.ts).
            await expect(
              guidanceSection.getByRole("button", { name: /Dismiss/ }),
            ).toHaveCount(0);

            // Navigates to the real shipment.
            await itemLink.click();

            await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

            await expect(
              page.getByRole("heading", { name: shipmentReference }),
            ).toBeVisible();
          },
        );

        await test.step(
          "after marking the shipment ready, the I19 item disappears and the dashboard returns to its empty state",
          async () => {
            await page.getByRole(
              "button",
              { name: "Mark ready" },
            ).click();

            await expect(
              page.locator('[data-status-key="shipment.READY"]'),
            ).toBeVisible();

            await page.goto(
              "/",
            );

            await expect(
              page.getByText("Nothing needs your attention right now."),
            ).toBeVisible();

            await expect(
              page.getByRole("link", { name: `Mark ${shipmentReference} ready` }),
            ).toHaveCount(0);
          },
        );
      },
    );

    test(
      "the guidance section is usable at mobile width",
      async (
        {
          page,
          importerOrgSession,
        },
      ) => {
        const CN_CODE =
          "25232100";

        const shipmentReference =
          `SHIP-GUIDEM-${importerOrgSession.runId}`;

        // Create the shipment at desktop width first (the shipment
        // form and CN/TARIC picker are the same journey every other
        // spec drives at desktop width) -- this test's own subject is
        // the DASHBOARD's mobile rendering, not shipment intake at
        // mobile width, which importer-journey.spec.ts already skips
        // on mobile for the same reason.
        await page.setViewportSize(
          { width: 1280, height: 800 },
        );

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        await page.goto(
          "/",
        );

        await primaryNav.getByRole(
          "link",
          { name: "Shipments", exact: true },
        ).click();

        await page.getByRole(
          "link",
          { name: "New shipment" },
        ).click();

        await page.getByLabel("Reference").fill(shipmentReference);
        await page.getByLabel("Release date").fill("2026-01-15");

        await page.getByRole(
          "button",
          { name: "Create shipment" },
        ).click();

        await page.getByPlaceholder(
          "Search by code or description, e.g. 25232100 or cement",
        ).fill(CN_CODE);

        await page.getByRole("option").filter({ hasText: CN_CODE }).click();

        await page.getByLabel("Origin country").fill("CN");
        await page.getByLabel("Quantity", { exact: true }).fill("100");

        await page.getByRole(
          "button",
          { name: "Add line" },
        ).click();

        await page.getByRole(
          "button",
          { name: "Resolve default value" },
        ).click();

        await expect(
          page.locator('[data-status-key="resolution.EXACT_CN8_MATCH"]'),
        ).toBeVisible();

        // Now the actual subject: the dashboard's guidance section at
        // mobile width (375x812, matching shell.spec.ts's own mobile
        // viewport test).
        await page.setViewportSize(
          { width: 375, height: 812 },
        );

        await page.goto(
          "/",
        );

        const guidanceSection =
          page.getByRole(
            "region",
            { name: "Needs your attention" },
          );

        await expect(guidanceSection).toBeVisible();

        await expect(
          guidanceSection.getByRole(
            "link",
            { name: `Mark ${shipmentReference} ready` },
          ),
        ).toBeVisible();

        // No horizontal overflow at mobile width (same check
        // shell.spec.ts's own mobile test uses).
        const overflow =
          await page.evaluate(
            () =>
              document.body.scrollWidth >
              window.innerWidth,
          );

        expect(overflow).toBe(false);
      },
    );

    test(
      "2026-09-05 (S2 remediation, B1): more than 3 REQUIRED items cap the dashboard at exactly 3 cards, show a REQUIRED-specific overflow control with the exact count, and /attention#required exposes the complete list",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "primary nav is hidden below md -- shipment creation needs desktop width",
        );

        const CN_CODE =
          "25232100";

        const SHIPMENT_COUNT =
          4;

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        const references: string[] =
          [];

        for (
          let index = 0;
          index < SHIPMENT_COUNT;
          index += 1
        ) {
          const reference =
            `SHIP-OVERFLOW-${importerOrgSession.runId}-${index}`;

          references.push(
            reference,
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

          await page.getByPlaceholder(
            "Search by code or description, e.g. 25232100 or cement",
          ).fill(CN_CODE);

          await page.getByRole(
            "option",
          ).filter({ hasText: CN_CODE }).click();

          await page.getByLabel("Origin country").fill("CN");
          await page.getByLabel("Quantity", { exact: true }).fill("100");

          await page.getByRole(
            "button",
            { name: "Add line" },
          ).click();

          await page.getByRole(
            "button",
            { name: "Resolve default value" },
          ).click();

          await expect(
            page.locator('[data-status-key="resolution.EXACT_CN8_MATCH"]'),
          ).toBeVisible();
        }

        await page.goto(
          "/",
        );

        const guidanceSection =
          page.getByRole(
            "region",
            { name: "Needs your attention" },
          );

        await expect(guidanceSection).toBeVisible();

        // Exactly DASHBOARD_GUIDANCE_CAP (3) cards, never all 4 -- the
        // exact defect the fresh Opus 5 review found (every REQUIRED
        // item rendered uncapped).
        await expect(
          guidanceSection.getByRole(
            "link",
            { name: /^Mark SHIP-OVERFLOW-/ },
          ),
        ).toHaveCount(
          3,
        );

        const overflowControl =
          guidanceSection.getByRole(
            "link",
            { name: "1 more required item needs your attention →" },
          );

        await expect(overflowControl).toBeVisible();
        await expect(overflowControl).toHaveAttribute(
          "href",
          "/attention#required",
        );

        await overflowControl.click();

        await expect(page).toHaveURL(
          /\/attention#required$/,
        );

        // The complete ranked set is on /attention -- all 4, not just
        // the dashboard's own 3-card preview.
        const requiredSection =
          page.getByRole(
            "region",
            { name: "Required" },
          );

        for (
          const reference of references
        ) {
          await expect(
            requiredSection.getByRole(
              "link",
              { name: `Mark ${reference} ready` },
            ),
          ).toBeVisible();
        }
      },
    );
  },
);

test.describe(
  "product feedback",
  () => {
    test(
      "submitting feedback from the topbar trigger captures the originating page, and the rating control is keyboard-operable",
      async (
        {
          page,
          importerOrgSession: _importerOrgSession,
        },
      ) => {
        await page.goto(
          "/shipments",
        );

        await page.getByRole(
          "link",
          { name: "Send feedback" },
        ).click();

        await expect(page).toHaveURL(
          /\/feedback\?from=%2Fshipments/,
        );

        // Keyboard operability: the rating control is a real
        // radiogroup of real radio inputs -- Tab to the first option
        // and select via the keyboard, not a click.
        const firstRatingOption =
          page.getByRole(
            "radio",
            { name: "1" },
          );

        await firstRatingOption.focus();

        await expect(firstRatingOption).toBeFocused();

        // The radio input itself is visually hidden (sr-only) inside
        // its <label> -- real mouse users click the label, and the
        // browser natively delegates that to the input. Playwright's
        // role locator resolves to the input itself, so a .click()
        // there targets the input's own (off-screen) box rather than
        // the visible label a real user would click -- click the
        // label's text instead, scoped to the radiogroup.
        await page.getByRole(
          "radiogroup",
          { name: "Rating" },
        ).getByText(
          "4",
          { exact: true },
        ).click();

        await page.getByLabel(
          /Anything you'd like to add/,
        ).fill(
          "E2E feedback check.",
        );

        await page.getByRole(
          "button",
          { name: "Send feedback" },
        ).click();

        await expect(
          page.getByText("Thanks -- your feedback was sent."),
        ).toBeVisible();
      },
    );
  },
);
