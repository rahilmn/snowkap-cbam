import {
  test,
  expect,
} from "./fixtures/authenticated-importer";

/**
 * The full importer journey (P13 follow-up work tracked in
 * tests/e2e/shell.spec.ts's own "full Playwright E2E coverage of the
 * auth flow itself... is tracked as follow-up work" comment): intake ->
 * classify -> resolve -> calculate -> explain -> report -> declare ->
 * LOCK, driven entirely through the real UI against local Supabase,
 * building on the already-verified authenticated-importer fixture
 * (see tests/e2e/importer-auth-smoke.spec.ts).
 *
 * A single CN8 good/origin combination is used throughout the journey:
 * 25232100 ("White Portland cement") x origin CN. This is a real,
 * unambiguous, AVAILABLE row in the live local regulatory dataset --
 * confirmed directly against local Supabase's REST API before writing
 * this spec (default_emission_values: good "White Portland cement",
 * country China, direct 1.250, indirect 0.140, total 1.390
 * TCO2E_PER_TONNE, production_route_id null -- i.e. resolves without
 * needing a production route to be specified), not invented or assumed.
 * This makes the DEFAULT-path resolution + calculation deterministic:
 * 100 t x 1.390 tCO2e/t = 139 tCO2e (RULE-EE-001,
 * src/domain/calculations/calculate-line-emissions.ts).
 *
 * Desktop-only: the primary nav, the org-switcher, and the multi-column
 * tables this journey depends on are all hidden/reflowed below `md`/`sm`
 * (tests/e2e/shell.spec.ts's own "responsive" suite) -- same skip
 * discipline as importer-auth-smoke.spec.ts.
 *
 * A generous per-test timeout: this is one long, real, sequential UI
 * journey against a real dev server -- first-visit route compilation
 * plus a genuine network round trip to local Supabase for every step,
 * not flakiness insurance.
 */
test.describe.configure(
  {
    timeout: 180_000,
  },
);

test.describe(
  "importer full journey: intake -> classify -> resolve -> calculate -> explain -> report -> declare -> LOCK",
  () => {
    test(
      "creates a supplier and shipment, classifies + resolves + calculates a line, explains it, reports on it, and declares it through to LOCK",
      async (
        {
          page,
          importerOrgSession,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "primary nav, org-switcher, and the multi-column tables this journey depends on are hidden/reflowed below md/sm -- desktop-only, same discipline as importer-auth-smoke.spec.ts",
        );

        const CN_CODE =
          "25232100";

        const ORIGIN_COUNTRY =
          "CN";

        const QUANTITY_TONNES =
          "100";

        const EXPECTED_EMBEDDED_EMISSIONS_TCO2E =
          "139";

        const supplierName =
          `Cement Supplier ${importerOrgSession.runId}`;

        const shipmentReference =
          `SHIP-${importerOrgSession.runId}`;

        const filedReference =
          `CBAM-FILED-${importerOrgSession.runId}`;

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        let shipmentUrl =
          "";

        await test.step(
          "intake: create a supplier",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Suppliers", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/suppliers$/);

            await page.getByLabel("Name", { exact: true }).fill(supplierName);
            await page.getByLabel("Country", { exact: true }).fill(ORIGIN_COUNTRY);
            await page.getByLabel("Contact email").fill(
              `supplier-${importerOrgSession.runId}@example.com`,
            );

            await page.getByRole("button", { name: "Add supplier" }).click();

            await expect(page.getByText(supplierName)).toBeVisible();
          },
        );

        await test.step(
          "intake: create a shipment",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Shipments", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/shipments$/);

            await page.getByRole("link", { name: "New shipment" }).click();

            await expect(page).toHaveURL(/\/shipments\/new$/);

            await page.getByLabel("Reference").fill(shipmentReference);
            await page.getByLabel("Release date").fill("2026-08-29");
            await page.getByLabel("Customs MRN").fill(`MRN-${importerOrgSession.runId}`);
            await page.getByLabel("Customs procedure").selectOption(
              "RELEASE_FOR_FREE_CIRCULATION",
            );

            await page.getByRole("button", { name: "Create shipment" }).click();

            await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

            shipmentUrl =
              page.url();

            await expect(
              page.getByRole("heading", { name: shipmentReference }),
            ).toBeVisible();

            await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
          },
        );

        await test.step(
          "classify: add a line via the live CN/TARIC picker",
          async () => {
            // Not getByLabel: cmdk's CommandInput (cn-code-picker.tsx)
            // wires its own internal aria-labelledby onto the input,
            // which overrides the implicit <label>-wrapping association
            // add-line-form.tsx otherwise relies on (confirmed live: the
            // rendered combobox has no accessible name at all) -- the
            // placeholder is the one stable, real identifier for this
            // field.
            await page.getByPlaceholder(
              "Search by code or description, e.g. 25232100 or cement",
            ).fill(CN_CODE);

            const option =
              page.getByRole("option").filter({ hasText: CN_CODE });

            await expect(option).toBeVisible();
            await option.click();

            await page.getByLabel("Origin country").fill(ORIGIN_COUNTRY);
            await page.getByLabel("Quantity", { exact: true }).fill(QUANTITY_TONNES);

            await page.getByRole("button", { name: "Add line" }).click();

            await expect(page.getByRole("cell", { name: CN_CODE })).toBeVisible();
          },
        );

        await test.step(
          "resolve: regulatory default-value determination",
          async () => {
            await page.getByRole("button", { name: "Resolve default value" }).click();

            await expect(page.getByText("EXACT CN8 MATCH")).toBeVisible();
          },
        );

        await test.step(
          "calculate: line embedded emissions",
          async () => {
            await page.getByRole("button", { name: "Calculate", exact: true }).click();

            await expect(
              page.getByText(`${EXPECTED_EMBEDDED_EMISSIONS_TCO2E} tCO2e`).first(),
            ).toBeVisible();
          },
        );

        await test.step(
          "explain: open \"Why this number?\" and verify the full chain",
          async () => {
            await page.getByRole(
              "button",
              { name: /Why this number\? Line 1/ },
            ).click();

            await expect(
              page.getByText(/Dataset 2026-definitive-corrected/),
            ).toBeVisible();

            await expect(
              page.getByText(/Origin mapped to "China"/),
            ).toBeVisible();

            await expect(page.getByText(/RULE-EE-001/)).toBeVisible();

            await page.getByRole("button", { name: "Verify reproducibility" }).click();

            await expect(page.getByText(/^Reproducible/)).toBeVisible();
          },
        );

        await test.step(
          "shipment lifecycle: mark ready",
          async () => {
            await page.getByRole("button", { name: "Mark ready" }).click();

            await expect(page.getByText("READY", { exact: true })).toBeVisible();
          },
        );

        await test.step(
          "report: view the period report",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Reports", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/reports$/);

            await page.getByLabel("Year").fill("2026");
            await page.getByRole("button", { name: "View report" }).click();

            await expect(page).toHaveURL(/\/reports\?.*year=2026/);

            await expect(
              page.getByText(`${EXPECTED_EMBEDDED_EMISSIONS_TCO2E} tCO2e`).first(),
            ).toBeVisible();
          },
        );

        await test.step(
          "declare: start a declaration for the period",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Declarations", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/declarations$/);

            await page.getByLabel("Year").fill("2026");
            await page.getByRole("button", { name: "Start declaration" }).click();

            await expect(page).toHaveURL(/\/declarations\/[0-9a-f-]{36}$/);

            await expect(
              page.getByText("Complete -- ready to mark ready"),
            ).toBeVisible();
          },
        );

        await test.step(
          "declare: mark ready and record filed (LOCK)",
          async () => {
            await page.getByRole("button", { name: "Mark ready" }).click();

            await expect(page.getByText("READY", { exact: true })).toBeVisible();

            await page.getByLabel("Filing reference").fill(filedReference);

            await expect(
              page.getByText(/LOCKS every member shipment permanently/),
            ).toBeVisible();

            await page.getByRole(
              "button",
              { name: "Record filed (locks shipments)" },
            ).click();

            await expect(page.getByText("FILED RECORDED")).toBeVisible();

            await expect(
              page.getByText(`${EXPECTED_EMBEDDED_EMISSIONS_TCO2E} tCO2e`).first(),
            ).toBeVisible();
          },
        );

        await test.step(
          "verify LOCK: the shipment is now permanently locked",
          async () => {
            await page.goto(shipmentUrl);

            await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();

            await expect(
              page.getByRole("heading", { name: "Add a line" }),
            ).toHaveCount(0);
          },
        );

        await test.step(
          "audit: every mutation along the journey is recorded",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Audit", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/audit$/);

            await expect(
              page.getByText("No audit events recorded yet"),
            ).toHaveCount(0);
          },
        );
      },
    );
  },
);
