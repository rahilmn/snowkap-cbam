import Link from "next/link";

import {
  AppShell,
} from "../components/shell/app-shell";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

/**
 * Placeholder home screen -- Phase 2's scope is the application shell
 * and design system, not real product screens (those begin at Phase
 * 4). This exists to prove the shell renders end-to-end and to link
 * to the component gallery.
 */
export default function HomePage() {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Dashboard" },
      ]}
    >
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Dashboard
      </h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>
            Snowkap CBAM
          </CardTitle>

          <CardDescription>
            Application shell walking skeleton (Phase 2). Product
            screens begin at Phase 4.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link
            href="/design"
            className="text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
          >
            View the design system gallery →
          </Link>
        </CardContent>
      </Card>
    </AppShell>
  );
}
