"use client";

import {
  useEffect,
} from "react";

import Link from "next/link";

import {
  Button,
} from "../components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

/**
 * 2026-08-29 (P13 audit finding, live-reproduced for the sibling
 * not-found.tsx case): no error.tsx existed anywhere in app/ -- an
 * uncaught exception during a page render (a Postgres hiccup, or any
 * other server-side throw -- CLAUDE.md's own architecture reserves
 * `throw` for exactly "infrastructure failures and integrity
 * violations") had nowhere to land except Next's bare, unstyled
 * default error screen: no branding, no nav back into the app, no
 * "try again". This file (Next's own root error.tsx convention) is a
 * Client Component by Next's own requirement (it needs the `reset`
 * callback for the "Try again" action) and renders inside the existing
 * root layout, so the shell/theme/wordmark chrome is already there.
 *
 * Deliberately never renders `error.message` -- an unhandled throw is,
 * by this codebase's own convention, an infrastructure failure or
 * integrity violation, never a value meant for an end user (contrast
 * the discriminated {status,reason} results every expected outcome
 * already uses); a generic message avoids leaking anything internal.
 */
export default function GlobalError(
  {
    error,
    reset,
  }: {
    error: Error & { digest?: string };
    reset: () => void;
  },
) {
  useEffect(
    () => {
      // eslint-disable-next-line no-console
      console.error(
        error,
      );
    },
    [error],
  );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)] p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">
            Something went wrong
          </CardTitle>

          <CardDescription>
            An unexpected error occurred. You can try again, or head
            back to the dashboard.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <Button
            type="button"
            onClick={
              () =>
                reset()
            }
          >
            Try again
          </Button>

          <Link
            href="/"
            className="text-center text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
          >
            Back to Snowkap CBAM
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
