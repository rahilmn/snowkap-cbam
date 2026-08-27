import type {
  Metadata,
} from "next";

import {
  Inter,
  JetBrains_Mono,
} from "next/font/google";

import "./globals.css";

const inter =
  Inter(
    {
      subsets: ["latin"],
      variable: "--font-inter",
      display: "swap",
    },
  );

const jetBrainsMono =
  JetBrains_Mono(
    {
      subsets: ["latin"],
      variable: "--font-jetbrains-mono",
      display: "swap",
    },
  );

export const metadata: Metadata = {
  title: {
    default:
      "Snowkap CBAM",

    template:
      "%s · Snowkap CBAM",
  },

  description:
    "CBAM compliance platform: shipment intake, classification, regulatory " +
    "emissions resolution, and declaration preparation.",
};

/**
 * Resolves and applies a concrete "light" or "dark" data-theme
 * attribute before first paint -- from a previously-stored choice
 * (see components/shell/theme-toggle.tsx), falling back to the OS
 * preference. data-theme is *always* set to one of the two literal
 * values; it is never left absent.
 *
 * This is deliberately simpler than the alternative (leave data-theme
 * unset for "follow the OS" and let CSS's
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`
 * do the deciding): that pattern did not reliably apply in this
 * project's actual rendering/automation environment during Phase 2
 * verification (WCAG contrast checks against a live page found the
 * "light" override never took effect via either the toggle button or
 * direct attribute manipulation, while a fully JS-resolved explicit
 * attribute -- this approach -- verified correctly in the same
 * environment). It also matches the standard approach used by
 * `next-themes` and shadcn/ui: resolve once in JS, keep CSS to two
 * unconditional blocks (base :root + :root[data-theme="dark"]), and
 * avoid a second, CSS-media-query-derived source of truth altogether.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("snowkap-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export default function RootLayout(
  {
    children,
  }: {
    children: React.ReactNode;
  },
) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          // eslint-disable-next-line react/no-danger -- static, no user input
          dangerouslySetInnerHTML={{
            __html:
              THEME_INIT_SCRIPT,
          }}
        />
      </head>

      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
