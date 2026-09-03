import {
  test,
  expect,
  type Page,
} from "@playwright/test";

import {
  randomUUID,
} from "node:crypto";

/**
 * The one journey no other spec can run: a producer's actual emissions
 * data taken all the way to VERIFIED and ACTIVE, shared, and then used
 * by a real importer to determine a real shipment line.
 *
 * Why it is separate from cross-org-sharing-journey.spec.ts. That spec
 * proves the grant lifecycle (issue -> accept -> revoke -> history
 * intact) and deliberately leaves the producer's record UNVERIFIED, so
 * it can assert the honest empty state on the importer's side. It runs
 * everywhere. This one needs the opposite: a record that genuinely
 * reaches VERIFIED, which requires attached evidence, which requires
 * Supabase Storage. Storage is disabled on the developer host
 * (supabase/config.toml `[storage] enabled = false`, for a
 * machine-specific reason recorded there) and enabled in CI precisely
 * so the storage-touching migrations apply. Rather than weaken the
 * sibling spec's assertions into conditionals, this journey lives on
 * its own and skips where it cannot run.
 *
 * It is the live proof for four separate claims:
 *
 *   - Determining from shared actual data works end to end, through the
 *     real UI, across two organizations.
 *   - The dataset is previewed before it is used, and replacing an
 *     existing determination asks first.
 *   - Choosing the same dataset twice changes nothing, is reported as
 *     such, and does not offer the action at all.
 *   - After the producer revokes the grant, the importer still sees WHO
 *     supplied the figures they already declared -- the frozen
 *     determination stays attributable (migration 20260902150000).
 */

const PASSWORD =
  "e2e-Password-123!";

async function signUpAndOnboard(
  page: Page,
  {
    email,
    organizationName,
    capabilityLabel,
  }: {
    email: string;
    organizationName: string;
    capabilityLabel: RegExp;
  },
): Promise<void> {
  await page.goto(
    "/sign-up",
  );

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);

  await page.getByRole(
    "button",
    { name: "Create account" },
  ).click();

  await expect(page).toHaveURL(
    /\/onboarding$/,
  );

  await page.getByLabel("Organization name").fill(organizationName);

  await page.getByRole(
    "checkbox",
    { name: capabilityLabel },
  ).check();

  await page.getByRole(
    "button",
    { name: "Create organization" },
  ).click();

  await expect(page).toHaveURL(
    "/",
  );
}

/**
 * A generous per-test timeout, matching cross-org-sharing-journey.spec.ts,
 * which this journey is shaped exactly like: two full organisation
 * journeys in two browser contexts -- sign-up, onboarding, installation,
 * emission data, evidence upload, verification, activation, sharing,
 * acceptance, determination and calculation -- against a real dev server
 * and a real Supabase.
 *
 * 2026-09-03 (P14.3). It had no timeout declaration at all and therefore
 * inherited Playwright's 30s default, which is nowhere near enough. That
 * went unnoticed because this spec is Storage-gated: it skipped on every
 * developer host, and its first CI run failed at 30.1s on the initial
 * attempt and both retries. Its two sibling journeys have carried an
 * explicit budget from the start (importer-journey 180s,
 * cross-org-sharing-journey 300s); this one was simply never given one,
 * because nothing had ever run it long enough to find out.
 *
 * Not flakiness insurance: the same journey completes in about 66s
 * against a remote hosted project, so the budget is roughly 4x headroom
 * rather than a way to absorb a real hang.
 */
test.describe.configure(
  {
    timeout: 300_000,
  },
);

test.describe(
  "actual-data determination: verified producer data -> shared -> used on a real shipment line",
  () => {
    test(
      "an importer determines a line from a producer's verified, shared dataset, is shown what it contains before committing, cannot re-apply the same dataset, and keeps the producer's name after the grant is revoked",
      async (
        {
          browser,
          isMobile,
          request,
        },
      ) => {
        test.skip(
          isMobile,
          "primary nav, org-switcher and the multi-column lines table this journey drives are hidden or reflowed below md/sm -- desktop-only, same discipline as cross-org-sharing-journey.spec.ts",
        );

        // Probed live, never assumed from an env var. On the developer
        // host kong answers 503 for the storage service; in CI it
        // answers normally because the workflow enables it.
        // 2026-09-03 (P14.2). Probes the Storage the APPLICATION is
        // actually configured against, rather than assuming localhost.
        // The URL was hard-coded, which silently made this a
        // local-only probe: pointed at a Storage-capable hosted
        // project, it would have reported Storage unavailable and taken
        // the skip while the app underneath had working Storage all
        // along. Default unchanged, so local and CI behave exactly as
        // before.
        const supabaseUrl =
          process.env.NEXT_PUBLIC_SUPABASE_URL
          ?? process.env.SUPABASE_URL
          ?? "http://127.0.0.1:54321";

        const storageAvailable =
          await request
            .get(
              `${supabaseUrl}/storage/v1/bucket`,
              { timeout: 10_000 },
            )
            .then((response) => response.status() !== 503)
            .catch(() => false);

        // Under CI, taking the skip would mean this journey silently did
        // not run while the job still reported success -- so a silent
        // revert to `[storage] enabled = false`, or an unhealthy storage
        // container, would be indistinguishable from a pass. Fail loudly
        // there; skip honestly everywhere else.
        if (process.env.CI && !storageAvailable) {
          throw new Error(
            "Supabase Storage is unavailable under CI. This job enables Storage on purpose; " +
              "without it the verified-actual-data determination journey does not execute. " +
              "Failing loudly rather than skipping silently.",
          );
        }

        test.skip(
          !storageAvailable,
          "Supabase Storage is disabled on this host, so no emission_data record can reach VERIFIED through the real UI -- see this file's own doc comment.",
        );

        const runId =
          randomUUID().slice(0, 8);

        const producerEmail =
          `e2e-actual-producer-${runId}@example.com`;

        const importerEmail =
          `e2e-actual-importer-${runId}@example.com`;

        const producerOrgName =
          `E2E Actual Producer Org ${runId}`;

        const importerOrgName =
          `E2E Actual Importer Org ${runId}`;

        const operatorName =
          `Operator ${runId}`;

        const installationName =
          `Installation ${runId}`;

        // The same real, regulatory-resolvable CN8 code the sibling
        // journeys use on both sides, so cn_scope coverage is trivially
        // satisfied and nothing about CN matching can be the reason a
        // step fails.
        const cnCode =
          "25232100";

        const periodYear =
          "2026";

        const directSpecific =
          "1.85";

        const indirectSpecific =
          "0.32";

        const emissionUnit =
          "tCO2e/t";

        const producerContext =
          await browser.newContext();

        const importerContext =
          await browser.newContext();

        const producerPage =
          await producerContext.newPage();

        const importerPage =
          await importerContext.newPage();

        const producerNav =
          producerPage.getByRole(
            "navigation",
            { name: "Primary" },
          );

        const importerNav =
          importerPage.getByRole(
            "navigation",
            { name: "Primary" },
          );

        try {
          await test.step(
            "producer: sign up, create an operator and an installation",
            async () => {
              await signUpAndOnboard(
                producerPage,
                {
                  email: producerEmail,
                  organizationName: producerOrgName,
                  capabilityLabel: /Producer \/ Operator/,
                },
              );

              await producerNav.getByRole(
                "link",
                { name: "Installations", exact: true },
              ).click();

              await expect(producerPage).toHaveURL(/\/installations$/);

              // Real element ids: both forms on this page carry
              // "Name"/"Country" labels, so getByLabel is ambiguous.
              await producerPage.locator("#operator-name").fill(operatorName);
              await producerPage.locator("#operator-country").fill("DE");
              await producerPage.locator("#operator-contactEmail").fill(
                `operator-${runId}@example.com`,
              );

              await producerPage.getByRole(
                "button",
                { name: "Add operator" },
              ).click();

              await expect(
                producerPage.getByRole("listitem").filter({ hasText: operatorName }),
              ).toBeVisible();

              await producerPage.locator("#installation-operatorId").selectOption(
                { label: operatorName },
              );

              await producerPage.locator("#installation-name").fill(installationName);
              await producerPage.locator("#installation-country").fill("DE");
              await producerPage.locator("#installation-unLocode").fill("DEHAM");
              await producerPage.locator("#installation-address").fill(
                "1 Industrial Way, Hamburg",
              );

              await producerPage.getByRole(
                "button",
                { name: "Add installation" },
              ).click();

              await expect(
                producerPage.getByRole("listitem").filter({ hasText: installationName }),
              ).toBeVisible();
            },
          );

          await test.step(
            "producer: record emission data and attach real evidence",
            async () => {
              await producerNav.getByRole(
                "link",
                { name: "Emissions", exact: true },
              ).click();

              await expect(producerPage).toHaveURL(/\/emission-data$/);

              await producerPage.getByLabel("Installation").selectOption(
                { label: installationName },
              );

              await producerPage.getByLabel("CN codes in scope").fill(cnCode);
              await producerPage.getByLabel("Year").fill(periodYear);

              await producerPage.getByLabel(
                "Direct specific emissions",
                { exact: true },
              ).fill(directSpecific);

              await producerPage.getByLabel(
                "Indirect specific emissions",
                { exact: true },
              ).fill(indirectSpecific);

              await producerPage.getByLabel("Unit").fill(emissionUnit);

              await producerPage.getByRole(
                "button",
                { name: "Record emission data" },
              ).click();

              await expect(
                producerPage.getByText(`${periodYear} · ${cnCode} · v1`),
              ).toBeVisible();

              await producerPage.locator('input[type="file"]').setInputFiles(
                {
                  name: `evidence-${runId}.pdf`,
                  mimeType: "application/pdf",
                  buffer: Buffer.from(
                    "%PDF-1.4 fake evidence content for e2e test\n",
                  ),
                },
              );

              await producerPage.getByRole(
                "button",
                { name: "Upload" },
              ).click();

              // Real bytes, real round trip to Supabase Storage.
              await expect(
                producerPage.getByText(`evidence-${runId}.pdf`),
              ).toBeVisible({ timeout: 20_000 });

              await expect(
                producerPage.getByText("No evidence attached."),
              ).toBeHidden();
            },
          );

          await test.step(
            "producer: submit, verify and activate -- both confirmed first",
            async () => {
              await producerPage.getByRole(
                "button",
                { name: "Submit for verification" },
              ).click();

              await expect(
                producerPage.getByText("VERIFICATION PENDING", { exact: true }),
              ).toBeVisible();

              // Dialog #15. Verification is irreversible in the shape
              // this product offers -- a VERIFIED record has no path
              // back -- and it locks the evidence behind it.
              await producerPage.getByRole(
                "button",
                { name: "Verify", exact: true },
              ).click();

              const verifyDialog =
                producerPage.getByRole(
                  "dialog",
                  { name: "Verify this emission data record?" },
                );

              await expect(verifyDialog).toBeVisible();

              await verifyDialog.getByRole(
                "button",
                { name: "Verify record" },
              ).click();

              await expect(
                producerPage.getByText("VERIFIED", { exact: true }),
              ).toBeVisible();

              // Dialog #16. Activation is a cross-party transition: it
              // changes what every grantee importer reads.
              await producerPage.getByRole(
                "button",
                { name: "Activate", exact: true },
              ).click();

              const activateDialog =
                producerPage.getByRole(
                  "dialog",
                  { name: "Activate this record?" },
                );

              await expect(activateDialog).toBeVisible();

              await activateDialog.getByRole(
                "button",
                { name: "Activate", exact: true },
              ).click();

              await expect(
                producerPage.getByText("ACTIVE", { exact: true }),
              ).toBeVisible();
            },
          );

          await test.step(
            "producer: share the installation with the importer by email",
            async () => {
              await producerNav.getByRole(
                "link",
                { name: "Sharing", exact: true },
              ).click();

              await expect(producerPage).toHaveURL(/\/sharing$/);

              await producerPage.getByLabel("Installation").selectOption(
                { label: installationName },
              );

              await producerPage.getByLabel("Importer's email").fill(importerEmail);

              await producerPage.getByRole(
                "button",
                { name: "Invite to view data" },
              ).click();

              await expect(
                producerPage.getByText(`Invited: ${importerEmail}`),
              ).toBeVisible();
            },
          );

          await test.step(
            "importer: sign up with that exact address and accept the shared data",
            async () => {
              await signUpAndOnboard(
                importerPage,
                {
                  email: importerEmail,
                  organizationName: importerOrgName,
                  capabilityLabel: /Importer \/ Declarant/,
                },
              );

              await importerPage.goto(
                "/accept-invitation",
              );

              await expect(
                importerPage.getByText(
                  `Accepting into ${importerOrgName}.`,
                ),
              ).toBeVisible();

              await importerPage.getByRole(
                "button",
                { name: "Accept", exact: true },
              ).click();

              await importerPage.getByRole(
                "dialog",
                { name: `Accept shared data into ${importerOrgName}?` },
              ).getByRole(
                "button",
                { name: `Accept into ${importerOrgName}` },
              ).click();

              await expect(
                importerPage.getByText(
                  `No pending invitations for ${importerEmail}.`,
                ),
              ).toBeVisible();
            },
          );

          await test.step(
            "importer: the shared dataset is previewed in full before it is used",
            async () => {
              // 2026-09-03 (P14.2). This step used to click the shell
              // nav directly, and could never have worked: the previous
              // step leaves the importer on /accept-invitation, which
              // renders a standalone centred card and NO app shell --
              // so there is no navigation "Primary" landmark on the
              // page and the click waited until the test timed out.
              //
              // Never caught before because this spec is Storage-gated:
              // it skipped on every developer host and CI has not run on
              // this branch, so it had never executed to this line in
              // any environment. Found by running it for the first time
              // against a Storage-capable hosted project.
              //
              // Returning to the app first is what a real user does --
              // /accept-invitation's own copy points them back to the
              // dashboard.
              await importerPage.goto("/");

              await expect(importerNav).toBeVisible();

              await importerNav.getByRole(
                "link",
                { name: "Shipments", exact: true },
              ).click();

              await importerPage.getByRole(
                "link",
                { name: "New shipment" },
              ).click();

              await importerPage.getByLabel("Reference").fill(`SHIP-${runId}`);
              await importerPage.getByLabel("Release date").fill("2026-08-29");
              await importerPage.getByLabel("Customs MRN").fill(`MRN-${runId}`);
              await importerPage.getByLabel("Customs procedure").selectOption(
                "RELEASE_FOR_FREE_CIRCULATION",
              );

              await importerPage.getByRole(
                "button",
                { name: "Create shipment" },
              ).click();

              await expect(importerPage).toHaveURL(
                /\/shipments\/[0-9a-f-]{36}$/,
              );

              await importerPage.getByPlaceholder(
                "Search by code or description, e.g. 25232100 or cement",
              ).fill(cnCode);

              const cnOption =
                importerPage.getByRole("option").filter({ hasText: cnCode });

              await expect(cnOption).toBeVisible();
              await cnOption.click();

              await importerPage.getByLabel("Origin country").fill("CN");
              await importerPage.getByLabel("Quantity", { exact: true }).fill("10");

              await importerPage.getByRole(
                "button",
                { name: "Add line" },
              ).click();

              await expect(
                importerPage.getByRole("cell", { name: cnCode }),
              ).toBeVisible();

              // Nothing is selected by default and the action is not
              // offered until something is: there is no dataset it would
              // be safe to pick on the importer's behalf.
              const determineButton =
                importerPage.getByRole(
                  "button",
                  { name: "Determine from actual data" },
                );

              await expect(determineButton).toBeDisabled();

              await importerPage.getByLabel(
                "Choose a verified dataset",
              ).selectOption(
                { index: 1 },
              );

              // The preview: the figures being frozen, in view, before
              // the decision -- not a truncated string inside a select.
              await expect(
                importerPage.getByText("Selected dataset"),
              ).toBeVisible();

              // exact: true because the option in the dataset <select>
              // also carries the producer's name, so a substring match
              // resolves to two elements and fails strict mode. The
              // assertion is about the PREVIEW's Source row -- the <dd>
              // -- which is the thing that has to be visible before the
              // importer commits.
              await expect(
                importerPage.getByText(
                  `Shared by ${producerOrgName}`,
                  { exact: true },
                ),
              ).toBeVisible();

              // exact: true for the same reason as the Source row above
              // -- the option in the dataset <select> also carries the
              // figure, so a substring match resolves to two elements.
              // This assertion is about the preview's Direct row.
              await expect(
                importerPage.getByText(
                  `${directSpecific} ${emissionUnit}`,
                  { exact: true },
                ),
              ).toBeVisible();

              // The line declares origin CN; the installation is in DE.
              // Both are shown, and the difference is stated. No rule is
              // invented about whether that is allowed -- the human
              // judges. See actual-data-preview.tsx.
              await expect(
                importerPage.getByText(
                  "differs from the installation's country",
                ),
              ).toBeVisible();

              await expect(determineButton).toBeEnabled();
            },
          );

          await test.step(
            "importer: determine the line, then find the same dataset offers nothing to do",
            async () => {
              await importerPage.getByRole(
                "button",
                { name: "Determine from actual data" },
              ).click();

              await expect(
                importerPage.getByText("Actual data", { exact: true }),
              ).toBeVisible();

              // Re-choosing the SAME dataset. The server decided this,
              // not a client-side id comparison -- the comparison covers
              // the record's evidence set, its verifier and the grant it
              // was read through, none of which reach the browser.
              await importerPage.getByLabel(
                "Choose a verified dataset",
              ).selectOption(
                { index: 1 },
              );

              await expect(
                importerPage.getByText(
                  "This line is already determined from that exact dataset. Choosing it again would change nothing.",
                ),
              ).toBeVisible();

              await expect(
                importerPage.getByRole(
                  "button",
                  { name: "Determine from actual data" },
                ),
              ).toBeDisabled();
            },
          );

          await test.step(
            "producer: revoke the grant",
            async () => {
              await producerNav.getByRole(
                "link",
                { name: "Sharing", exact: true },
              ).click();

              await producerPage.getByRole(
                "button",
                { name: `Revoke access for ${installationName}` },
              ).click();

              await producerPage.getByRole(
                "dialog",
                { name: `Revoke access for ${installationName}?` },
              ).getByRole(
                "button",
                { name: "Revoke access" },
              ).click();

              await expect(
                producerPage.getByText("REVOKED", { exact: true }),
              ).toBeVisible();
            },
          );

          await test.step(
            "importer: the producer is still named on the determination they already made",
            async () => {
              await importerPage.goto(
                "/emissions",
              );

              // The whole point of migration 20260902150000. The frozen
              // determination outlives the grant, and a figure an
              // importer has already declared must stay attributable to
              // whoever supplied it -- "Unknown organization" is not an
              // acceptable provenance on a compliance record.
              await expect(
                importerPage.getByText(
                  `Shared by ${producerOrgName}`,
                ),
              ).toBeVisible();

              await expect(
                importerPage.getByText("Unknown organization"),
              ).toHaveCount(0);

              // And the change of state is disclosed rather than hidden.
              await expect(
                importerPage.getByText("Access since revoked"),
              ).toBeVisible();
            },
          );
        } finally {
          await producerContext.close();
          await importerContext.close();
        }
      },
    );
  },
);
