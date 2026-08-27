import {
  AppShell,
} from "../../components/shell/app-shell";

import {
  Badge,
} from "../../components/ui/badge";

import {
  Button,
} from "../../components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

import {
  RegulatoryStatusBadge,
} from "../../components/ui/regulatory-status-badge";

import type {
  ResolutionReason,
} from "../../src/domain/regulatory/types";

const ALL_RESOLUTION_REASONS: ResolutionReason[] = [
  "EXACT_TARIC_MATCH",
  "EXACT_CN8_MATCH",
  "EXACT_HS6_MATCH",
  "EXACT_HS4_MATCH",
  "OTHER_COUNTRIES_FALLBACK",
  "REFERENCE_REQUIRED",
  "UNAVAILABLE",
  "NOT_APPLICABLE",
  "AMBIGUOUS",
  "NO_MATCH",
];

const NEUTRAL_SWATCHES = [
  "neutral-950",
  "neutral-900",
  "neutral-800",
  "neutral-700",
  "neutral-600",
  "neutral-500",
  "neutral-400",
  "neutral-300",
  "neutral-200",
  "neutral-100",
  "neutral-50",
];

const BRAND_SWATCHES = [
  "brand-800",
  "brand-700",
  "brand-600",
  "brand-500",
  "brand-400",
  "brand-100",
  "brand-50",
];

const INTERACTIVE_SWATCHES = [
  "interactive-700",
  "interactive-600",
  "interactive-500",
  "interactive-100",
  "interactive-50",
];

const SEMANTIC_SWATCHES = [
  "success-700",
  "success-600",
  "success-100",
  "warning-700",
  "warning-600",
  "warning-100",
  "danger-700",
  "danger-600",
  "danger-100",
];

/**
 * Dev-only design-system review venue, per
 * docs/plans/MASTER_PLAN.md §26 ("Review venue: dev-only in-app
 * /design gallery route (no Storybook dependency)"). Not linked from
 * product navigation; reachable directly at /design for design review
 * during development.
 */
export default function DesignGalleryPage() {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Design system" },
      ]}
    >
      <div className="flex max-w-4xl flex-col gap-10">
        <section>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Snowkap CBAM design system
          </h1>

          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            &ldquo;Precision instrument, glacial calm.&rdquo; Grounded
            in live-verified Snowkap brand colors (charcoal + orange);
            see app/globals.css for the full token set and its
            provenance notes.
          </p>
        </section>

        <ColorSection
          title="Neutral"
          tokens={NEUTRAL_SWATCHES}
        />

        <ColorSection
          title="Brand (verified: #DF5900)"
          tokens={BRAND_SWATCHES}
        />

        <ColorSection
          title="Interactive (this product's own extension)"
          tokens={INTERACTIVE_SWATCHES}
        />

        <ColorSection
          title="Semantic"
          tokens={SEMANTIC_SWATCHES}
        />

        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Typography
          </h2>

          <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4">
            <p className="text-3xl font-semibold">
              Aa — 30 / semibold
            </p>

            <p className="text-xl font-semibold">
              Aa — 20 / semibold
            </p>

            <p className="text-base">
              Aa — 16 / regular
            </p>

            <p className="text-sm">
              Aa — 14 / regular (default body)
            </p>

            <p className="font-mono text-sm">
              2507008080 — tabular / mono (codes, traces, checksums)
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Buttons
          </h2>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4">
            <Button variant="primary">
              Primary
            </Button>

            <Button variant="secondary">
              Secondary
            </Button>

            <Button variant="ghost">
              Ghost
            </Button>

            <Button variant="destructive">
              Destructive
            </Button>

            <Button
              variant="primary"
              loading
            >
              Loading
            </Button>

            <Button
              variant="primary"
              disabled
            >
              Disabled
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Badges
          </h2>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4">
            <Badge tone="neutral">
              Neutral
            </Badge>

            <Badge tone="brand">
              Brand
            </Badge>

            <Badge tone="success">
              Success
            </Badge>

            <Badge tone="warning">
              Warning
            </Badge>

            <Badge tone="danger">
              Danger
            </Badge>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Regulatory status badges
          </h2>

          <p className="mb-3 text-sm text-[var(--text-secondary)]">
            The &ldquo;status honesty&rdquo; element (§25): every
            resolution reason renders distinctly — a fallback never
            looks like an exact match, an unresolved value never looks
            like success.
          </p>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-4">
            {ALL_RESOLUTION_REASONS.map(
              (reason) => (
                <RegulatoryStatusBadge
                  key={reason}
                  reason={reason}
                />
              ),
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Card
          </h2>

          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>
                Card title
              </CardTitle>

              <CardDescription>
                Supporting description text.
              </CardDescription>
            </CardHeader>

            <CardContent>
              Card body content.
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function ColorSection(
  {
    title,
    tokens,
  }: {
    title: string;
    tokens: string[];
  },
) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
        {title}
      </h2>

      <div className="flex flex-wrap gap-3">
        {tokens.map(
          (token) => (
            <div
              key={token}
              className="flex flex-col gap-1.5"
            >
              <div
                className="size-16 rounded-[var(--radius-md)] border border-[var(--border-default)]"
                style={{
                  backgroundColor:
                    `var(--color-${token})`,
                }}
              />

              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                {token}
              </span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
