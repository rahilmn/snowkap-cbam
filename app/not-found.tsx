import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

/**
 * 2026-08-29 (P13 audit finding, live-reproduced): no not-found.tsx
 * existed anywhere in app/ -- a nonexistent route rendered Next's bare
 * default "404 / This page could not be found." on a plain unstyled
 * page, with no branding, no navigation back into the app, and none of
 * the design system applied. This file (Next's own root not-found.tsx
 * convention) renders inside the existing root layout, so the
 * shell/theme/wordmark chrome around it is already there for free --
 * this only needs to supply the content.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)] p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">
            Page not found
          </CardTitle>

          <CardDescription>
            The page you&apos;re looking for doesn&apos;t exist or may
            have moved.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link
            href="/"
            className="text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
          >
            Back to Snowkap CBAM
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
