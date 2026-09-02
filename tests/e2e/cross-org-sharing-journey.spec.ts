import {
  test,
  expect,
  type Page,
} from "@playwright/test";

import {
  randomUUID,
} from "node:crypto";

/**
 * P13: the third and final major E2E journey, cross-organization this
 * time -- grant -> consume -> revoke -> history-intact. Sibling of
 * producer-journey.spec.ts (the GRANT half) and importer-journey.spec.ts
 * (the DEFAULT-value determination path, which this journey deliberately
 * does NOT repeat), but unlike either of those this test needs TWO real,
 * independent, concurrently-authenticated sessions in the SAME test --
 * a producer org and an importer org -- so the two existing org-session
 * fixtures (tests/e2e/fixtures/authenticated-{producer,importer}.ts)
 * can't be used directly (each owns the single default `page`/context
 * Playwright's own `test` fixture provides per test). Mechanism chosen
 * here: two explicit `browser.newContext()` calls, each with its own
 * `page`, driven through the identical sign-up -> onboarding sequence
 * those two fixtures already established and proved live -- copied
 * in, not imported, since neither fixture is parameterizable by a
 * caller-chosen email (this test's importer MUST sign up with the
 * exact email the producer's bootstrap grant was addressed to, which
 * the fixture's own randomUUID-derived email can't express).
 *
 * REAL, CONFIRMED ENVIRONMENT LIMITATION (same root cause
 * producer-journey.spec.ts already live-demonstrated: local Supabase
 * Storage is disabled -- supabase/config.toml's `[storage] enabled =
 * false`): manage-emission-data.ts's applyTransition (VERIFY) and
 * activateEmissionData (ACTIVATE) both hard-gate on
 * checkEmissionDataEvidenceCompleteness, which requires a non-empty
 * evidence_file_ids -- and uploadEvidenceFile has no metadata-only path,
 * so no emission_data row can ever genuinely reach verification_status
 * = 'VERIFIED' through the real UI in this environment. Confirmed again
 * by reading manage-emission-data.ts directly before writing this test
 * (not re-derived from the sibling spec's comment alone). Since
 * listAvailableActualEmissionData (src/application/emissions/
 * list-available-actual-data.ts) -- the real UI call site behind the
 * shipment line's "Use actual data" picker AND the /emissions "Shared-in
 * producer data" table -- filters on
 * .eq("status","ACTIVE").eq("verification_status","VERIFIED") before
 * anything else (org-scoping, grant-scoping, cn_scope), this means the
 * CONSUME stage's "importer actually reads a shared ACTUAL determination
 * and record_shared_data_consumption fires" cannot be genuinely reached
 * in this environment -- not for lack of a real, correctly-issued and
 * -accepted ACTIVE sharing grant (that part IS reached and verified
 * below), but because the upstream evidence-upload gate blocks every
 * path to a VERIFIED row before cross-org sharing ever enters the
 * picture. This test does not re-run producer-journey.spec.ts's own
 * ~20s live proof of the Storage 503 (that's already proven, and
 * re-proving it here would just be redundant real time against an
 * already-confirmed blocker) -- instead it demonstrates the DOWNSTREAM
 * consequence live: a genuinely ACTIVE cross-org grant exists, yet the
 * importer's real "Use actual data" picker and "Shared-in producer
 * data" table are both honestly empty, at the exact UI call sites the
 * task asked this test to find and exercise.
 *
 * HISTORY-INTACT, precisely: src/domain/sharing/grant-lifecycle.ts's own
 * doc comment states the guarantee this codebase actually designs for --
 * "REVOKED/EXPIRED are terminal ... revocation/expiry end *future* reads
 * only -- nothing here touches any ActualEmissionSnapshot already taken
 * through this grant, since those are frozen copies elsewhere" -- and
 * transitionSharingGrant's REVOKE branch is a pure, additive
 * `{...grant, status: "REVOKED"}` (nothing else on the row is touched).
 * Because no ActualEmissionSnapshot was ever genuinely taken in this
 * environment (see above), this test proves the concrete, live-provable
 * half of that same guarantee instead: the sharing_grant's own audit
 * trail (issued -> accepted -> revoked, three separate, real
 * audit_events rows written across three separate real actions) all
 * remain visible together on the producer's /activity screen after the
 * revoke -- the later REVOKED-transition event never displaces or hides
 * the earlier ones -- and the grant's own row on /sharing/status is
 * never deleted by revocation, only its status field and (per
 * list-shared-data-status.ts's resolveGranteeLabel and the P11 security
 * fix in 20260829320000's own header comment) its grantee-name
 * resolution change.
 *
 * Desktop-only / generous timeout: two full org journeys (sign-up,
 * onboarding, operator/installation, emission data, sharing grant,
 * accept, revoke) across two concurrent real browser contexts, each a
 * genuine round trip to local Supabase -- not flakiness insurance.
 */
test.describe.configure(
  {
    timeout: 300_000,
  },
);

const PASSWORD =
  "Password123!";

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
  // --- Sign up (app/(auth)/sign-up/sign-up-form.tsx) ---
  await page.goto(
    "/sign-up",
  );

  await page.getByLabel(
    "Email",
    { exact: true },
  ).fill(
    email,
  );

  await page.getByLabel(
    "Password",
    { exact: true },
  ).fill(
    PASSWORD,
  );

  await page.getByRole(
    "button",
    { name: "Create account" },
  ).click();

  // Local Supabase has enable_confirmations = false (same as both
  // sibling fixtures rely on), so signUpAction redirects straight to
  // /onboarding with no email click-through.
  await expect(
    page,
  ).toHaveURL(
    /\/onboarding$/,
  );

  // --- Onboarding (app/onboarding/onboarding-form.tsx) ---
  await page.getByLabel(
    "Organization name",
  ).fill(
    organizationName,
  );

  await page.getByRole(
    "checkbox",
    { name: capabilityLabel },
  ).check();

  await page.getByRole(
    "button",
    { name: "Create organization" },
  ).click();

  await expect(
    page,
  ).toHaveURL(
    "/",
  );
}

test.describe(
  "cross-org sharing journey: grant -> consume -> revoke -> history-intact",
  () => {
    test(
      "a producer shares an installation's data with a real importer org by email, the importer accepts and attempts to consume it, the producer revokes access, and the grant's own history survives the revoke",
      async (
        {
          browser,
          isMobile,
        },
      ) => {
        test.skip(
          isMobile,
          "primary nav, org-switcher, and the multi-column tables this journey depends on are hidden/reflowed below md/sm -- desktop-only, same discipline as producer-journey.spec.ts / importer-journey.spec.ts",
        );

        const runId =
          randomUUID().slice(
            0,
            8,
          );

        const producerEmail =
          `e2e-cross-producer-${runId}@example.com`;

        const importerEmail =
          `e2e-cross-importer-${runId}@example.com`;

        const producerOrgName =
          `E2E Cross Producer Org ${runId}`;

        const importerOrgName =
          `E2E Cross Importer Org ${runId}`;

        const operatorName =
          `Operator ${runId}`;

        const installationName =
          `Installation ${runId}`;

        // A single, exact CN8 code used on both sides: the producer's
        // emission_data cn_scope AND the importer's shipment line's
        // declared cn_code, so cnScopeCoversCnCode's exact-match branch
        // (src/domain/emissions/cn-scope-covers-code.ts) applies
        // trivially -- the ONLY remaining gate on visibility is the
        // verification-status filter this test exists to demonstrate,
        // not a cn_scope mismatch. Real, regulatory-resolvable CN8 code
        // already confirmed live against local Supabase in
        // importer-journey.spec.ts's own doc comment ("White Portland
        // cement", origin CN) -- reused here so the shipment-line "Add
        // line" step (which goes through the live CN/TARIC picker,
        // cn-code-picker.tsx) is exercised against a code already known
        // to resolve in this dataset, not a guess.
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

        // Two independent, concurrent, real browser contexts -- see
        // this file's own top-of-file doc comment for why this
        // mechanism was chosen over the two single-org fixtures.
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
            "setup: producer signs up and onboards as PRODUCER_OPERATOR",
            async () => {
              await signUpAndOnboard(
                producerPage,
                {
                  email: producerEmail,
                  organizationName: producerOrgName,
                  capabilityLabel: /Producer \/ Operator/,
                },
              );
            },
          );

          await test.step(
            "grant: producer creates an operator and an installation",
            async () => {
              await producerNav.getByRole(
                "link",
                { name: "Installations", exact: true },
              ).click();

              await expect(producerPage).toHaveURL(/\/installations$/);

              // Both OperatorForm and InstallationForm on this page have
              // "Name"/"Country" labels -- ambiguous via getByLabel
              // (confirmed live in producer-journey.spec.ts), so real
              // element ids from operator-form.tsx are used instead.
              await producerPage.locator("#operator-name").fill(operatorName);
              await producerPage.locator("#operator-country").fill("DE");
              await producerPage.locator("#operator-contactEmail").fill(
                `operator-${runId}@example.com`,
              );

              await producerPage.getByRole("button", { name: "Add operator" }).click();

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

              await producerPage.getByRole("button", { name: "Add installation" }).click();

              await expect(
                producerPage.getByRole("listitem").filter({ hasText: installationName }),
              ).toBeVisible();
            },
          );

          await test.step(
            "grant: producer records actual emission data for the installation (left unverified -- see this file's own doc comment)",
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

              await producerPage.getByRole("button", { name: "Record emission data" }).click();

              await expect(
                producerPage.getByText(`${periodYear} · ${cnCode} · v1`),
              ).toBeVisible();

              // Genuinely, honestly unverified -- this record is never
              // taken through SUBMIT_FOR_VERIFICATION/VERIFY here (that
              // exact blocked path is already live-proven in
              // producer-journey.spec.ts; re-running its ~20s Storage
              // 503 wait here would add real time without adding new
              // information). What matters for THIS journey is only
              // that a real emission_data row exists, scoped to this
              // exact installation and cn_scope, and is NOT VERIFIED.
              await expect(producerPage.getByText("UNVERIFIED", { exact: true })).toBeVisible();
            },
          );

          await test.step(
            "grant: producer issues a bootstrap-by-email sharing grant addressed to the importer's real email",
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

              await expect(producerPage.getByText("INVITED", { exact: true })).toBeVisible();
            },
          );

          await test.step(
            "consume: a real, second org signs up using that exact invited email",
            async () => {
              await signUpAndOnboard(
                importerPage,
                {
                  email: importerEmail,
                  organizationName: importerOrgName,
                  capabilityLabel: /Importer \/ Declarant/,
                },
              );
            },
          );

          await test.step(
            "consume: the importer sees the real pending sharing-grant invitation and accepts it",
            async () => {
              await importerPage.goto(
                "/accept-invitation",
              );

              await expect(
                importerPage.getByText(producerOrgName),
              ).toBeVisible();

              await expect(
                importerPage.getByText(
                  `Wants to share ${installationName}'s emissions data with you`,
                ),
              ).toBeVisible();

              // 2026-09-03 (P14). Accepting is a cross-party,
              // irreversible bind, so it asks first -- and it names the
              // organization it is binding to, because that is the
              // choice the dialog exists to surface. This importer user
              // belongs to exactly one importer organization, so there
              // is nothing to choose and it is preselected.
              await expect(
                importerPage.getByText(
                  `Accepting into ${importerOrgName}.`,
                ),
              ).toBeVisible();

              await importerPage.getByRole("button", { name: "Accept", exact: true }).click();

              const acceptDialog =
                importerPage.getByRole(
                  "dialog",
                  { name: `Accept shared data into ${importerOrgName}?` },
                );

              await expect(acceptDialog).toBeVisible();

              await expect(
                acceptDialog.getByText(
                  `Every member of ${importerOrgName} will be able to read`,
                  { exact: false },
                ),
              ).toBeVisible();

              // Cancel first: the dialog must be a real gate, not
              // decoration -- nothing may be bound by opening it.
              await acceptDialog.getByRole(
                "button",
                { name: "Cancel" },
              ).click();

              await expect(acceptDialog).toBeHidden();

              await expect(
                importerPage.getByText(
                  `Wants to share ${installationName}'s emissions data with you`,
                ),
              ).toBeVisible();

              await importerPage.getByRole("button", { name: "Accept", exact: true }).click();

              await importerPage.getByRole(
                "dialog",
                { name: `Accept shared data into ${importerOrgName}?` },
              ).getByRole(
                "button",
                { name: `Accept into ${importerOrgName}` },
              ).click();

              // acceptSharingGrantInvitationAction deliberately does NOT
              // redirect on success (see its own doc comment) -- it
              // revalidates this same route instead, so the accepted
              // item drops out of listMyPendingSharingGrantInvitations's
              // live result. With zero org invitations and exactly this
              // one sharing-grant invitation, the page's own
              // hasNothingPending flips true.
              await expect(
                importerPage.getByText(`No pending invitations for ${importerEmail}.`),
              ).toBeVisible();
            },
          );

          await test.step(
            "consume: the producer confirms the grant is genuinely ACTIVE, with the real importer org's identity now resolved cross-org",
            async () => {
              await producerPage.goto(
                "/sharing",
              );

              const grantItem =
                producerPage.getByRole("listitem").filter({ hasText: installationName });

              await expect(
                grantItem.getByText("ACTIVE", { exact: true }),
              ).toBeVisible();

              // granteeLabel on THIS screen is deliberately always
              // "Invited: {email}" regardless of status (see
              // issued-grants-list.tsx's own IssuedGrantRow doc comment)
              // -- unchanged by acceptance, confirmed here rather than
              // assumed.
              await expect(
                grantItem.getByText(`Invited: ${importerEmail}`),
              ).toBeVisible();

              await producerPage.goto(
                "/sharing/status",
              );

              // list-shared-data-status.ts's resolveGranteeLabel: once
              // grantee_org_id resolves (via
              // organizations_select_via_own_issued_sharing_grant, gated
              // to status = 'ACTIVE') AND invited_email is still set,
              // the label is "{orgName} (accepted via invite to
              // {email})" -- the real, live cross-org name resolution
              // this P7-D4 RLS policy exists for, proven here rather
              // than assumed from the migration's own comment.
              await expect(
                producerPage.getByText(
                  `Shared with ${importerOrgName} (accepted via invite to ${importerEmail})`,
                ),
              ).toBeVisible();
            },
          );

          await test.step(
            "consume: the importer's 'Shared-in producer data' browse view is honestly empty -- blocked by this environment's disabled Storage",
            async () => {
              await importerPage.goto(
                "/emissions",
              );

              // listAvailableActualEmissionData(..., null) backs this
              // section (app/(importer)/emissions/page.tsx) -- despite a
              // genuinely ACTIVE grant for this installation, the
              // .eq("verification_status","VERIFIED") filter excludes
              // the real (but unverified) emission_data row this test
              // created above, so this is the honest, live-demonstrated
              // empty state, not an assumption.
              await expect(
                importerPage.getByText(
                  "No producer data has been shared with your organization yet. Ask a producer to issue a sharing grant for one of their installations.",
                ),
              ).toBeVisible();
            },
          );

          await test.step(
            "consume: the real 'Use actual data' picker (determineFromActualDataAction's own UI entry point) is genuinely absent on a matching shipment line",
            async () => {
              await importerNav.getByRole(
                "link",
                { name: "Shipments", exact: true },
              ).click();

              await expect(importerPage).toHaveURL(/\/shipments$/);

              await importerPage.getByRole("link", { name: "New shipment" }).click();

              await expect(importerPage).toHaveURL(/\/shipments\/new$/);

              await importerPage.getByLabel("Reference").fill(`SHIP-${runId}`);
              await importerPage.getByLabel("Release date").fill("2026-08-29");
              await importerPage.getByLabel("Customs MRN").fill(`MRN-${runId}`);
              await importerPage.getByLabel("Customs procedure").selectOption(
                "RELEASE_FOR_FREE_CIRCULATION",
              );

              await importerPage.getByRole("button", { name: "Create shipment" }).click();

              await expect(importerPage).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

              // Same CN8 code the producer's own emission_data.cn_scope
              // declares (this test's own cnCode constant) -- so a
              // cn_scope mismatch can never be the reason the picker is
              // absent; only the verification-status gate can be.
              await importerPage.getByPlaceholder(
                "Search by code or description, e.g. 25232100 or cement",
              ).fill(cnCode);

              const option =
                importerPage.getByRole("option").filter({ hasText: cnCode });

              await expect(option).toBeVisible();
              await option.click();

              await importerPage.getByLabel("Origin country").fill("CN");
              await importerPage.getByLabel("Quantity", { exact: true }).fill("10");

              await importerPage.getByRole("button", { name: "Add line" }).click();

              await expect(importerPage.getByRole("cell", { name: cnCode })).toBeVisible();

              // emissions-cell.tsx only renders the
              // <select name="emissionDataId"> / "Determine from actual
              // data" form at all when availableActualData.length > 0 --
              // with zero VERIFIED rows visible to this org (own or
              // shared), that whole block is genuinely absent from the
              // DOM, not merely empty inside an open dropdown.
              await expect(
                importerPage.locator('select[name="emissionDataId"]'),
              ).toHaveCount(0);

              await expect(
                importerPage.getByRole(
                  "button",
                  { name: "Determine from actual data" },
                ),
              ).toHaveCount(0);
            },
          );

          await test.step(
            "revoke: the producer revokes the grant",
            async () => {
              await producerPage.goto(
                "/sharing",
              );

              const grantItem =
                producerPage.getByRole("listitem").filter({ hasText: installationName });

              // Revoking is irreversible -- a REVOKED grant is terminal
              // and the producer must issue a new one to share again --
              // so it asks first (P14 dialog #1).
              await producerPage.getByRole(
                "button",
                { name: `Revoke access for ${installationName}` },
              ).click();

              const revokeDialog =
                producerPage.getByRole(
                  "dialog",
                  { name: `Revoke access for ${installationName}?` },
                );

              await expect(revokeDialog).toBeVisible();

              // Cancel first. A confirmation that cannot be declined is
              // decoration, and this asserts the grant is genuinely
              // untouched by opening the dialog.
              await revokeDialog.getByRole(
                "button",
                { name: "Keep sharing" },
              ).click();

              await expect(revokeDialog).toBeHidden();

              await expect(
                grantItem.getByText("ACTIVE", { exact: true }),
              ).toBeVisible();

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
                grantItem.getByText("REVOKED", { exact: true }),
              ).toBeVisible();

              // canRevoke (issued-grants-list.tsx) is only true for
              // INVITED/ACTIVE -- REVOKED is terminal, so the control
              // itself must now be genuinely gone, not merely disabled.
              await expect(
                grantItem.getByRole(
                  "button",
                  { name: `Revoke access for ${installationName}` },
                ),
              ).toHaveCount(0);
            },
          );

          await test.step(
            "history-intact: the producer's own issued -> revoked audit trail survives the revoke, both still visible together",
            async () => {
              await producerPage.goto(
                "/activity",
              );

              // Both actions here (issue, revoke) were performed BY the
              // producer, so recordAuditEvent wrote both under the
              // PRODUCER's own org_id (manage-sharing-grants.ts's
              // issueSharingGrant/revokeSharingGrant both pass
              // orgId: context.org_id, the acting org) -- confirmed live
              // that the later REVOKED-transition event does not
              // displace, hide, or overwrite the earlier issued one.
              // This is the concrete, live-provable form of
              // grant-lifecycle.ts's own "REVOKED ... end future reads
              // only" guarantee this environment can reach (see this
              // file's own top-of-file doc comment for why the
              // ActualEmissionSnapshot half of that same guarantee is
              // not reachable here).
              await expect(
                producerPage.getByText("sharing_grant.issued", { exact: true }),
              ).toBeVisible();

              await expect(
                producerPage.getByText("sharing_grant.revoked", { exact: true }),
              ).toBeVisible();
            },
          );

          await test.step(
            "history-intact: the importer's own accept record -- on a DIFFERENT org's audit trail entirely -- is untouched by the producer's later revoke",
            async () => {
              // acceptSharingGrantInvitation (manage-sharing-grants.ts)
              // records 'sharing_grant.accepted' under
              // row.result_org_id -- the ACCEPTING (importer) org, not
              // the grantor's (confirmed live against
              // 20260829300000_p7d2_sharing_grant_email_bootstrap.sql's
              // own `return query select 'OK'::text, p_org_id` before
              // writing this assertion, not assumed from the producer
              // side alone). A stronger cross-org form of
              // history-intact than same-org persistence: the
              // producer's later, unilateral REVOKE action cannot
              // retroactively alter or hide a record that lives on a
              // completely separate organization's own audit_events
              // rows -- audit_events_select_own_org
              // (20260828070000) scopes each org to only ever read its
              // own rows, so this could not have been made to
              // disappear by the revoke even if the revoke had wanted
              // to.
              await importerPage.goto(
                "/audit",
              );

              await expect(
                importerPage.getByText("sharing_grant.accepted", { exact: true }),
              ).toBeVisible();
            },
          );

          await test.step(
            "history-intact: the grant's own row on /sharing/status is not deleted by revocation -- only its status and grantee-name resolution change",
            async () => {
              await producerPage.goto(
                "/sharing/status",
              );

              await expect(
                producerPage.getByRole("heading", { name: installationName }),
              ).toBeVisible();

              await expect(
                producerPage.getByText("REVOKED", { exact: true }),
              ).toBeVisible();

              // 2026-09-03 (P14). This assertion previously expected
              // the label to DEGRADE after revocation, to
              // "Pending invite: {email}" -- the grantee org's name
              // could no longer be resolved once the grant left ACTIVE,
              // because the naming function was gated on a live grant.
              //
              // Migration 20260902150000 changed that deliberately: a
              // grant that was genuinely ACCEPTED keeps naming the
              // organization that accepted it, for any status. A frozen
              // determination outlives the grant it was read through,
              // and a figure an importer has already declared has to
              // stay attributable to whoever supplied it -- losing the
              // name at exactly the moment the relationship ends is the
              // opposite of what an audit trail is for.
              //
              // The email stays in the label too, because this grant was
              // issued to an address rather than to a known org, and
              // that is part of how it came about.
              await expect(
                producerPage.getByText(
                  `Shared with ${importerOrgName} (accepted via invite to ${importerEmail})`,
                ),
              ).toBeVisible();

              // No consumption ever happened (see this file's own
              // top-of-file doc comment) -- the honest, real empty state
              // is still asserted explicitly rather than skipped, so
              // this row's continued presence after revoke is proven
              // whole, not just partially.
              await expect(
                producerPage.getByText(
                  "No consumption events recorded -- the grantee has not yet determined a shipment line from this data.",
                ),
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
