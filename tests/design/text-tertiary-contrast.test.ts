import {
  describe,
  expect,
  it,
} from "vitest";

// Regression test for docs/adr/ADR-0017-text-tertiary-contrast-fix.md:
// --text-tertiary previously failed WCAG AA (as low as 2.67:1) against
// every real surface it is used against (app/design/page.tsx's swatch
// captions, components/shell/command-palette-trigger.tsx's search
// label, components/shell/wordmark.tsx's " CBAM" suffix). This checks
// the literal hex values currently in app/globals.css directly against
// the WCAG relative-luminance formula, so a future edit that
// reintroduces a failing pairing fails this test rather than shipping
// silently. Keep these hex values in sync with app/globals.css by hand
// -- there is no CSS-parsing step here, deliberately, to keep this
// test simple and fast.

function relativeLuminance(
  hex: string,
): number {
  const n =
    parseInt(
      hex.replace("#", ""),
      16,
    );

  const channel =
    (
      value: number,
    ) => {
      const c =
        value / 255;

      return c <= 0.03928
        ? c / 12.92
        : ((c + 0.055) / 1.055) ** 2.4;
    };

  const r =
    channel(
      (n >> 16) & 255,
    );

  const g =
    channel(
      (n >> 8) & 255,
    );

  const b =
    channel(
      n & 255,
    );

  return (
    0.2126 * r +
    0.7152 * g +
    0.0722 * b
  );
}

function contrastRatio(
  hexA: string,
  hexB: string,
): number {
  const l1 =
    relativeLuminance(
      hexA,
    );

  const l2 =
    relativeLuminance(
      hexB,
    );

  const lighter =
    Math.max(
      l1,
      l2,
    );

  const darker =
    Math.min(
      l1,
      l2,
    );

  return (
    (lighter + 0.05) /
    (darker + 0.05)
  );
}

const AA_NORMAL_TEXT_MINIMUM =
  4.5;

describe(
  "--text-tertiary contrast (ADR-0017)",
  () => {
    it(
      "light mode: passes AA against every real surface it is paired with",
      () => {
        const textTertiary =
          "#61616a";

        const surfaces =
          {
            "surface-page (neutral-50)":
              "#f7f7f9",

            "surface-sunken/inset (neutral-100)":
              "#ededf0",

            "surface-raised/overlay (white)":
              "#ffffff",
          };

        for (
          const [
            name,
            surfaceHex,
          ] of Object.entries(
            surfaces,
          )
        ) {
          expect(
            contrastRatio(
              textTertiary,
              surfaceHex,
            ),
            `text-tertiary vs ${name}`,
          ).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT_MINIMUM,
          );
        }
      },
    );

    it(
      "dark mode: passes AA against every real surface it is paired with",
      () => {
        const textTertiary =
          "#93939c";

        const surfaces =
          {
            "surface-page (neutral-950)":
              "#0a0a0b",

            "surface-raised/overlay (neutral-900)":
              "#16161a",

            "surface-sunken/inset (neutral-800)":
              "#222222",
          };

        for (
          const [
            name,
            surfaceHex,
          ] of Object.entries(
            surfaces,
          )
        ) {
          expect(
            contrastRatio(
              textTertiary,
              surfaceHex,
            ),
            `text-tertiary vs ${name}`,
          ).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT_MINIMUM,
          );
        }
      },
    );

    it(
      "documents the previous failure this test guards against",
      () => {
        // The old values (pre-ADR-0017) genuinely failed -- asserted here
        // so the regression this test exists for stays legible without
        // reading the ADR.
        expect(
          contrastRatio(
            "#91919a",
            "#ededf0",
          ),
        ).toBeLessThan(
          AA_NORMAL_TEXT_MINIMUM,
        );

        expect(
          contrastRatio(
            "#6b6b73",
            "#222222",
          ),
        ).toBeLessThan(
          AA_NORMAL_TEXT_MINIMUM,
        );
      },
    );
  },
);
