import {
  expect,
  test,
} from "./fixtures/authenticated-importer";

/**
 * 2026-08-29 (P13 audit finding, live-reproduced at 768x1024): with no
 * truncation/min-width guard, a real org name (e.g. this fixture's own
 * "E2E Importer Org <runId>", 26 chars -- exactly the shape a genuine
 * organization name takes) wrapped to multiple lines inside the fixed
 * h-14 (56px) topbar at tablet widths and visually overlapped the
 * breadcrumb row underneath. tests/e2e/shell.spec.ts's own "responsive"
 * suite only exercises 375px (org-switcher hidden below sm) and 1280px
 * (plenty of room) -- this closes exactly the untested band in between
 * shell.spec.ts's own comments already call out.
 *
 * Fixed in components/shell/{topbar,org-switcher}.tsx: min-w-0 on the
 * flex ancestors (required for Tailwind's truncate to have any effect
 * in a flex row) plus a max-width cap on the org name itself.
 */
test.describe(
  "topbar responsive (tablet band)",
  () => {
    test(
      "a real org name never wraps or overflows the topbar's fixed height at 768px",
      async (
        {
          page,
          importerOrgSession,
        },
      ) => {
        await page.setViewportSize(
          {
            width: 768,
            height: 1024,
          },
        );

        await page.goto(
          "/",
        );

        const header =
          page.getByRole(
            "banner",
          );

        await expect(
          header,
        ).toBeVisible();

        const orgNameControl =
          page.getByRole(
            "button",
            { name: new RegExp(importerOrgSession.organizationName) },
          );

        await expect(
          orgNameControl,
        ).toBeVisible();

        const headerBox =
          await header.boundingBox();

        const orgBox =
          await orgNameControl.boundingBox();

        if (!headerBox || !orgBox) {
          throw new Error(
            "Could not measure header/org-switcher bounding boxes.",
          );
        }

        // The exact overlap geometry the audit measured: the wrapped
        // block spilled both above and below the header's own bounds
        // (button top=-16.4px, bottom=71.6px vs header bottom=56px).
        // A truncated, single-line control stays fully inside the
        // header's box instead.
        expect(
          orgBox.y,
        ).toBeGreaterThanOrEqual(
          headerBox.y,
        );

        expect(
          orgBox.y + orgBox.height,
        ).toBeLessThanOrEqual(
          headerBox.y + headerBox.height,
        );

        // No horizontal page overflow either (the same class of check
        // shell.spec.ts's own mobile responsive test already makes).
        const hasHorizontalOverflow =
          await page.evaluate(
            () =>
              document.body.scrollWidth >
              window.innerWidth,
          );

        expect(
          hasHorizontalOverflow,
        ).toBe(
          false,
        );
      },
    );
  },
);
