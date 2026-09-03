import {
  test,
  expect,
} from "./fixtures/authenticated-producer";

/**
 * The producer journey (P13 follow-up work, sibling of
 * importer-journey.spec.ts): onboard -> installations -> data ->
 * evidence -> verify -> share, driven entirely through the real UI
 * against local Supabase, building on the already-verified
 * authenticated-producer fixture (see producer-auth-smoke.spec.ts).
 *
 * Creates an operator, an installation under it (installations belong
 * to an operator -- app/(producer)/installations/installation-form.tsx
 * requires operatorId), and a DRAFT emission_data record (real required
 * fields read directly off emission-data-form.tsx). Evidence attachment
 * is attempted for real through evidence-section.tsx's actual upload
 * control, then verification is attempted as far as it genuinely goes.
 *
 * ENVIRONMENT-DEPENDENT, PROBED AT RUNTIME (updated 2026-09-02): local
 * Supabase Storage is disabled on the developer host
 * (supabase/config.toml's `[storage] enabled = false`, for the
 * machine-specific reason documented there -- do not re-enable it
 * THERE). CI enables it so the four storage-touching migrations can
 * apply for real, so the upload genuinely SUCCEEDS there. Every
 * Storage-dependent assertion below branches on a live probe
 * (`storageAvailable`) and asserts each environment's real outcome.
 * The paragraphs that follow describe the disabled-Storage branch.
 * uploadEvidenceFile (src/application/evidence/upload-evidence.ts) has
 * no metadata-only path -- it always calls
 * `supabase.storage.from(EVIDENCE_STORAGE_BUCKET).upload(...)` for the
 * real bytes before an evidence_files row is ever inserted, confirmed
 * by reading that file. A direct curl to
 * http://127.0.0.1:54321/storage/v1/bucket in this environment returns
 * HTTP 503 "name resolution failed" after ~5.4s (kong's gateway
 * failing to resolve the storage-api container, which was never
 * started) -- so a real upload attempt through the UI genuinely fails
 * the same way, after the same real network round trip. This test
 * attempts the real upload anyway (not skipped) so the failure is
 * live-demonstrated, not assumed: it asserts the exact user-facing
 * error evidence-section.tsx's uploadErrorMessageFor produces for an
 * unmatched rejection reason ("Upload failed. Please try again.").
 *
 * Because evidence can never be genuinely attached in this environment,
 * emission-data-list.tsx's checkEmissionDataEvidenceCompleteness gate
 * never clears, so the record's Verify control
 * (manage-emission-data.ts's verifyEmissionData, gated on
 * EVIDENCE_INCOMPLETE) stays genuinely, visibly disabled -- this test
 * asserts that real, honest block (disabled attribute + the exact
 * blocking copy) rather than clicking a disabled button (which Playwright
 * would hang retrying) or fabricating a verified/activated state that
 * was never actually reached. SUBMIT_FOR_VERIFICATION itself has no
 * evidence gate (only VERIFY/ACTIVATE do -- confirmed by reading
 * manage-emission-data.ts's applyTransition), so that transition is
 * fully, genuinely reached and asserted.
 *
 * Sharing is the P7-D2 bootstrap-by-email path
 * (invite-by-email-form.tsx): the producer invites an importer by email
 * without a second real account existing -- issueSharingGrant creates
 * an INVITED grant keyed on the email alone (manage-sharing-grants.ts),
 * confirmed against issued-grants-list.tsx's own rendering.
 *
 * Desktop-only / generous timeout: same discipline as
 * importer-journey.spec.ts (primary nav + org-switcher hidden below
 * md/sm; first-visit route compilation plus real Supabase round trips,
 * including the ~5.4s storage-resolution failure above, are real time,
 * not flakiness insurance).
 */
test.describe.configure(
  {
    timeout: 180_000,
  },
);

test.describe(
  "producer full journey: onboard -> installations -> data -> evidence -> verify -> share",
  () => {
    test(
      "creates an operator and installation, records emission data, attempts evidence + verification, and issues a sharing grant",
      async (
        {
          page,
          producerOrgSession,
          isMobile,
          request,
        },
      ) => {
        // Probed LIVE rather than assumed from an env var or from
        // config.toml, because the question is whether the storage-api
        // container actually answers -- which is exactly what differs
        // between the developer host (where it is disabled and kong
        // returns 503 "name resolution failed") and CI (where it is
        // enabled so the storage-touching migrations can apply).
        //
        // Every Storage-dependent assertion below branches on this, so
        // the spec asserts each environment's REAL outcome instead of
        // encoding one environment's limitation as the expected result.
        const storageAvailable =
          await request
            .get(
              `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/storage/v1/bucket`,
              { timeout: 10_000 },
            )
            .then((r) => r.status() !== 503)
            .catch(() => false);

        // 2026-09-03 (Phase 2 review). The branch above asserts each
        // environment's real outcome, which is right for the developer
        // host -- but in CI, where .github/workflows/ci.yml enables
        // Storage precisely so the four storage-touching migrations
        // apply for real, taking the disabled branch means the evidence
        // upload/verify path silently did not run while the job still
        // reported "passed". A silent revert to `[storage] enabled =
        // false`, or an unhealthy Storage container, would therefore be
        // indistinguishable from success. Under CI it is a hard failure.
        if (process.env.CI && !storageAvailable) {
          throw new Error(
            "Supabase Storage is unavailable under CI. This job enables Storage on purpose; " +
              "without it the evidence-upload, verification and activation assertions below do " +
              "not execute. Failing loudly rather than passing on the disabled branch.",
          );
        }

        test.skip(
          isMobile,
          "primary nav, org-switcher, and the multi-column tables this journey depends on are hidden/reflowed below md/sm -- desktop-only, same discipline as importer-auth-smoke.spec.ts / importer-journey.spec.ts",
        );

        const operatorName =
          `Operator ${producerOrgSession.runId}`;

        const installationName =
          `Installation ${producerOrgSession.runId}`;

        const cnScopeInput =
          "72081000, 72082500";

        const periodYear =
          "2026";

        const directSpecific =
          "1.85";

        const indirectSpecific =
          "0.32";

        const emissionUnit =
          "tCO2e/t";

        const importerEmail =
          `e2e-importer-invitee-${producerOrgSession.runId}@example.com`;

        const EVIDENCE_INCOMPLETE_NOTICE =
          "Additional evidence is required before these actual emissions can be used as verified data.";

        const primaryNav =
          page.getByRole(
            "navigation",
            { name: "Primary" },
          );

        await test.step(
          "installations: create an operator",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Installations", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/installations$/);

            // Both OperatorForm and InstallationForm on this page have a
            // "Name" and a "Country" label -- getByLabel would be
            // ambiguous (strict-mode violation), so these use the real
            // element ids read directly off operator-form.tsx rather
            // than a guessed disambiguator.
            await page.locator("#operator-name").fill(operatorName);
            await page.locator("#operator-country").fill("DE");
            await page.locator("#operator-contactEmail").fill(
              `operator-${producerOrgSession.runId}@example.com`,
            );

            await page.getByRole("button", { name: "Add operator" }).click();

            // Not getByText: operatorName also appears verbatim as an
            // <option> in installation-form.tsx's operator select on
            // this same page (confirmed live -- a strict-mode
            // violation), so this scopes to the real OperatorList's
            // <li> (operator-list.tsx) instead.
            await expect(
              page.getByRole("listitem").filter({ hasText: operatorName }),
            ).toBeVisible();
          },
        );

        await test.step(
          "installations: create an installation under that operator",
          async () => {
            // installation-form.tsx: an installation belongs to an
            // operator -- the operator select only has real options once
            // the operator above actually exists.
            await page.locator("#installation-operatorId").selectOption(
              { label: operatorName },
            );

            await page.locator("#installation-name").fill(installationName);
            await page.locator("#installation-country").fill("DE");
            await page.locator("#installation-unLocode").fill("DEHAM");
            await page.locator("#installation-address").fill(
              "1 Industrial Way, Hamburg",
            );

            await page.getByRole("button", { name: "Add installation" }).click();

            // Scoped the same way as the operator assertion above --
            // installationName does not appear in any <option> on this
            // page today, but scoping to the real InstallationList's
            // <li> (installation-list.tsx) keeps this assertion honest
            // about what it's actually checking either way.
            await expect(
              page.getByRole("listitem").filter({ hasText: installationName }),
            ).toBeVisible();
          },
        );

        await test.step(
          "data: record actual emission data for the installation",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Emissions", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/emission-data$/);

            await page.getByLabel("Installation").selectOption(
              { label: installationName },
            );

            await page.getByLabel("CN codes in scope").fill(cnScopeInput);

            // Reporting period defaults to Annual and methodology
            // defaults to EU method (emission-data-form.tsx's own
            // defaultValue) -- left untouched so the real defaults are
            // exercised, same discipline as the fixture leaving the
            // slug field to derive itself.
            await page.getByLabel("Year").fill(periodYear);

            // exact: true -- "Indirect specific emissions" contains
            // "direct specific emissions" as a literal substring, so a
            // non-exact getByLabel("Direct specific emissions") matches
            // both fields (confirmed live -- a real strict-mode
            // violation, not a hypothetical one).
            await page.getByLabel(
              "Direct specific emissions",
              { exact: true },
            ).fill(directSpecific);

            await page.getByLabel(
              "Indirect specific emissions",
              { exact: true },
            ).fill(indirectSpecific);

            await page.getByLabel("Unit").fill(emissionUnit);

            await page.getByRole("button", { name: "Record emission data" }).click();

            await expect(
              page.getByText(`${periodYear} · ${cnScopeInput} · v1`),
            ).toBeVisible();

            await expect(
              page.getByText(
                `Direct ${directSpecific} / Indirect ${indirectSpecific} ${emissionUnit} · EU METHOD`,
              ),
            ).toBeVisible();

            await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
            await expect(page.getByText("UNVERIFIED", { exact: true })).toBeVisible();

            // Live, re-derived completeness (checkEmissionDataEvidenceCompleteness)
            // is Incomplete from the moment the record exists -- no
            // evidence has been attached yet.
            await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
            await expect(page.getByText("No evidence attached.")).toBeVisible();
            await expect(page.getByText(EVIDENCE_INCOMPLETE_NOTICE)).toBeVisible();
          },
        );

        await test.step(
          "evidence: attempt a real upload (blocked by this environment's disabled local Storage)",
          async () => {
            await page.locator('input[type="file"]').setInputFiles(
              {
                name: `evidence-${producerOrgSession.runId}.pdf`,
                mimeType: "application/pdf",
                buffer: Buffer.from(
                  "%PDF-1.4 fake evidence content for e2e test\n",
                ),
              },
            );

            await page.getByRole("button", { name: "Upload" }).click();

            // Real round trip: app/api/evidence/upload/route.ts's
            // uploadEvidenceFile genuinely calls Supabase Storage, which
            // is disabled locally -- confirmed live (curl to
            // http://127.0.0.1:54321/storage/v1/bucket returns 503 "name
            // resolution failed" after ~5.4s) before this session ever
            // wrote this spec. Generous timeout to cover that real
            // round trip, not flakiness insurance.
            // 2026-09-02. This step used to assert ONLY the failure
            // path, because local Supabase Storage is disabled
            // (config.toml `[storage] enabled = false`, for a
            // machine-specific reason documented there). CI now enables
            // Storage so the four storage-touching migrations apply for
            // real, which means the upload GENUINELY SUCCEEDS there --
            // and the old assertion correctly failed.
            //
            // Branching rather than weakening: each environment now
            // asserts its own real outcome, and the success branch is
            // NEW coverage of a path this repo previously described as
            // "shim-verified only". `storageAvailable` is probed live
            // (below), not assumed from an env var.
            if (storageAvailable) {
              await expect(
                page.getByText("Upload failed. Please try again."),
              ).toBeHidden();

              // Real bytes stored: the file is listed and the record is
              // no longer evidence-incomplete.
              await expect(
                page.getByText(`evidence-${producerOrgSession.runId}.pdf`),
              ).toBeVisible({ timeout: 20_000 });

              await expect(page.getByText("No evidence attached.")).toBeHidden();
            } else {
              await expect(
                page.getByText("Upload failed. Please try again."),
              ).toBeVisible(
                { timeout: 20_000 },
              );

              // Evidence genuinely never attached -- the record is still
              // honestly Incomplete, not silently assumed complete.
              await expect(page.getByText("No evidence attached.")).toBeVisible();
            }
          },
        );

        await test.step(
          "verify: submit for verification (no evidence gate on this transition)",
          async () => {
            // manage-emission-data.ts's applyTransition only checks
            // evidence completeness for the VERIFY action, never for
            // SUBMIT_FOR_VERIFICATION -- confirmed by reading that file
            // -- so this transition is genuinely, fully reachable.
            await page.getByRole(
              "button",
              { name: "Submit for verification" },
            ).click();

            await expect(
              page.getByText("VERIFICATION PENDING", { exact: true }),
            ).toBeVisible();
          },
        );

        await test.step(
          "verify: the Verify control is genuinely, visibly blocked by incomplete evidence",
          async () => {
            // The onboarding org creator holds OWNER (org-context.ts:
            // hasAdminAccess is ADMIN or OWNER), so the ADMIN+-only
            // Verify/Reject controls do render here -- but Verify stays
            // disabled: emission-data-list.tsx's VerifyButton is
            // genuinely disabled (not just visually discouraged) while
            // evidenceComplete is false, matching the owner's
            // blocking-model directive quoted in that file. Asserting
            // disabled state rather than clicking it -- Playwright would
            // hang retrying actionability on a button that can never
            // become enabled here.
            const verifyButton =
              page.getByRole("button", { name: "Verify", exact: true });

            await expect(verifyButton).toBeVisible();

            if (storageAvailable) {
              // Evidence really attached, so evidenceComplete is true and
              // the gate correctly RELEASES. Asserting the release is as
              // important as asserting the block: a gate that never opens
              // is indistinguishable from a broken control.
              await expect(verifyButton).toBeEnabled();

              await expect(
                page.getByText("Incomplete", { exact: true }),
              ).toBeHidden();
            } else {
              await expect(verifyButton).toBeDisabled();

              await expect(verifyButton).toHaveAttribute(
                "title",
                EVIDENCE_INCOMPLETE_NOTICE,
              );

              // The persistent, non-dismissible Incomplete state (the
              // owner's directive: "must be a persistent, visible state
              // on the record") is still present after the real
              // transition above, not just at record-creation time.
              await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
            }
          },
        );

        await test.step(
          "share: issue a bootstrap-by-email sharing grant for the installation",
          async () => {
            await primaryNav.getByRole(
              "link",
              { name: "Sharing", exact: true },
            ).click();

            await expect(page).toHaveURL(/\/sharing$/);

            await page.getByLabel("Installation").selectOption(
              { label: installationName },
            );

            await page.getByLabel("Importer's email").fill(importerEmail);

            await page.getByRole(
              "button",
              { name: "Invite to view data" },
            ).click();

            // issueSharingGrant's bootstrap-by-email path (P7-D2) --
            // this does NOT require the invited importer's account to
            // exist yet; the grant is created keyed on the email alone
            // (manage-sharing-grants.ts), confirmed by reading
            // issueSharingGrant before writing this assertion.
            await expect(
              page.getByText(`Invited: ${importerEmail}`),
            ).toBeVisible();

            await expect(page.getByText("INVITED", { exact: true })).toBeVisible();

            // canManage (OWNER) -> the revoke control genuinely renders
            // for an INVITED grant (issued-grants-list.tsx's canRevoke).
            await expect(
              page.getByRole(
                "button",
                { name: `Revoke access for ${installationName}` },
              ),
            ).toBeVisible();
          },
        );
      },
    );
  },
);
