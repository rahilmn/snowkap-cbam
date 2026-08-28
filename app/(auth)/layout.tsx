import type {
  ReactNode,
} from "react";

import {
  Wordmark,
} from "../../components/shell/wordmark";

/**
 * Shared shell for sign-in/sign-up/reset (master plan §27 screen 1:
 * "centered card, wordmark, low density · public"). Deliberately does
 * NOT render the app shell (topbar/sidebar) -- these are the one set
 * of screens reachable while signed out.
 */
export default function AuthLayout(
  {
    children,
  }: {
    children: ReactNode;
  },
) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--surface-page)] p-6">
      <Wordmark className="text-lg" />

      {children}
    </div>
  );
}
