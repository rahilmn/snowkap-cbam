import {
  describe,
  it,
  expect,
} from "vitest";

import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

/**
 * Snowkap CBAM SME Experience v2.1.1 §9.6: the product's status/
 * provenance vocabulary (src/domain/status-vocabulary) exists so a
 * screen never renders a raw domain enum value or hand-rolls its own
 * copy of STATUS_LABEL/STATUS_TONE next to it. This is the STATIC
 * half of that enforcement (v2 §9.6 layer 2) -- the compile-time half
 * is STATUS_LABEL/STATUS_TONE's own `Record<StatusKey, ...>` typing
 * (src/domain/status-vocabulary/labels.ts), which already fails to
 * compile if a domain union gains a member the label map doesn't
 * cover; this test guards the OTHER direction -- a file quietly
 * reintroducing its own bypass instead of using the shared module.
 *
 * METHOD. Text scan, matching the established pattern in
 * tests/architecture/verification-prose-scan.test.ts -- not an AST
 * walk. Two independent anti-patterns, both eliminated from the tree
 * in the same change that built this test (23 call sites migrated to
 * StatusBadge + src/domain/status-vocabulary's axis-key functions;
 * see git history for the full list):
 *
 *  A. A local `Record<SomeDomainStatusUnion, ...>` map -- exactly the
 *     shape of the DECLARATION_STATUS_TONE/SHIPMENT_STATUS_TONE/
 *     BLOCKER_LABEL/REASON_TONE/VALUE_STATUS_TONE-style consts this
 *     change removed. Scoped to the ELEVEN union type names the
 *     vocabulary's own axes are built from (types.ts) -- NOT every
 *     `Record<`, which would flag entirely unrelated maps (e.g.
 *     app/status/page.tsx's DATASET_STATUS_TONE, keyed by the
 *     regulatory dataset's own ok/missing/duplicate/error status,
 *     which is not a product-entity status this vocabulary covers at
 *     all).
 *
 *  B. `.replace(/_/g, " ")` (or the single-quoted/no-space
 *     equivalents) -- the humanize-a-raw-enum idiom every migrated
 *     call site used before this change. Banned tree-wide outside the
 *     vocabulary module itself, with a narrow, explicit, reviewed
 *     allowlist for the two remaining uses that are NOT a status/
 *     reason/methodology/role value (why-this-number-panel.tsx's
 *     calculation-trace input-key and step-name labels) -- adding to
 *     that allowlist is a deliberate, visible decision, not a silent
 *     bypass.
 */

const REPO_ROOT =
  fileURLToPath(
    new URL(
      "../..",
      import.meta.url,
    ),
  );

// The union type names src/domain/status-vocabulary/types.ts builds
// StatusKey's axes from (ReviewStatusKey's own source, ReviewStatus,
// is deliberately omitted -- review-badges.ts is itself inside the
// vocabulary module and predates this scan).
const VOCABULARY_SOURCE_TYPE_NAMES: string[] =
  [
    "ShipmentStatus",
    "DeclarationStatus",
    "CompletenessBlockerReason",
    "EmissionDataRecordStatus",
    "EmissionDataMethodology",
    "CalculationStatus",
    "SharingGrantStatus",
    "MembershipRole",
    "ResolutionReason",
    "ValueStatus",
    "IncompleteLineReason",
  ];

// Scoped to the SHAPE a label/tone map actually has (value type is a
// bare `string`, a `BadgeProps["tone"]`-style reference, or a quoted-
// literal tone union like `"neutral" | "brand" | ...`) -- not every
// `Record<OneOfTheseTypes, ...>`, which would also flag entirely
// legitimate business-logic lookup tables keyed by the same type, e.g.
// transition-actions.tsx's `Record<ShipmentStatus, TransitionActionSpec[]>`
// (which of buttons to show for a status, not what label/tone to give
// it -- an array of specs, not a label or tone value).
const RECORD_OF_VOCABULARY_TYPE =
  new RegExp(
    `Record<\\s*(${VOCABULARY_SOURCE_TYPE_NAMES.join("|")})\\b[^,]*,\\s*(?:string\\b|BadgeProps\\[|")`,
  );

// Exact receiver expressions this scan does not flag for pattern B --
// reviewed case by case (see this file's own header comment). Adding
// an entry here is a deliberate, visible decision, not a silent
// bypass: each one names the property being humanized and why it is
// not a status/reason/methodology/role value.
const REPLACE_UNDERSCORE_ALLOWLIST: string[] =
  [
    // why-this-number-panel.tsx: a calculation-trace step's `inputs`
    // object key (e.g. "direct_specific" -> "direct specific") -- a
    // field NAME, not an enum VALUE.
    "key.replace(",
    // why-this-number-panel.tsx: a calculation-trace step's own
    // `step` field (e.g. "multiply_by_factor") -- an engine step
    // name, not a StatusKey axis.
    "step.step.replace(",
  ];

const REPLACE_UNDERSCORE_PATTERN =
  /[\w.]+\.replace\(\s*\/_\/g,\s*["'] ["']\s*\)/g;

const SCAN_ROOTS: string[] =
  [
    "app",
    "components",
  ];

const SKIP_DIRECTORIES =
  new Set(
    [
      "node_modules",
      ".next",
      ".next-e2e",
      "dist",
      "api",
    ],
  );

// The vocabulary module's own files are exempt from both rules -- they
// ARE the shared implementation these rules exist to force everything
// else to use.
const EXEMPT_PATH_PREFIX =
  "src/domain/status-vocabulary/";

function isTestFile(
  path: string,
): boolean {
  return /\.test\.tsx?$/.test(
    path,
  );
}

function walk(
  directory: string,
  repoRelativePrefix: string,
  out: { path: string; absolutePath: string }[],
): void {
  let entries;

  try {
    entries =
      readdirSync(
        directory,
      );
  } catch {
    return;
  }

  for (
    const entry of entries
  ) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue;
    }

    const absolutePath =
      join(
        directory,
        entry,
      );

    const repoRelativePath =
      `${repoRelativePrefix}/${entry}`;

    const stat =
      statSync(
        absolutePath,
      );

    if (stat.isDirectory()) {
      walk(
        absolutePath,
        repoRelativePath,
        out,
      );

      continue;
    }

    if (
      /\.tsx?$/.test(entry) &&
      !isTestFile(entry)
    ) {
      out.push(
        {
          path: repoRelativePath,
          absolutePath,
        },
      );
    }
  }
}

function listScannedFiles(): { path: string; absolutePath: string }[] {
  const files: { path: string; absolutePath: string }[] =
    [];

  for (
    const root of SCAN_ROOTS
  ) {
    walk(
      join(REPO_ROOT, root),
      root,
      files,
    );
  }

  return files.filter(
    (file) =>
      !file.path.startsWith(
        EXEMPT_PATH_PREFIX,
      ),
  );
}

function stripComments(
  text: string,
): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe(
  "status vocabulary enforcement (v2.1.1 §9.6, layer 2: static scan)",
  () => {
    it(
      "no file outside src/domain/status-vocabulary hand-rolls its own Record<...> map over a vocabulary axis's source type",
      () => {
        const files =
          listScannedFiles();

        expect(files.length).toBeGreaterThan(0);

        const violations: string[] =
          [];

        for (
          const file of files
        ) {
          const source =
            stripComments(
              readFileSync(
                file.absolutePath,
                "utf8",
              ),
            );

          if (RECORD_OF_VOCABULARY_TYPE.test(source)) {
            const match =
              source.match(
                RECORD_OF_VOCABULARY_TYPE,
              );

            violations.push(
              `${file.path}: "${match?.[0]}" -- use STATUS_LABEL/STATUS_TONE ` +
                `(src/domain/status-vocabulary) instead of a local Record<...> map`,
            );
          }
        }

        expect(
          violations,
          `Found ${violations.length} hand-rolled vocabulary map(s):\n${violations.join("\n")}`,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "no file outside src/domain/status-vocabulary humanizes a raw enum with .replace(/_/g, \" \"), outside the reviewed allowlist",
      () => {
        const files =
          listScannedFiles();

        const violations: string[] =
          [];

        for (
          const file of files
        ) {
          const source =
            stripComments(
              readFileSync(
                file.absolutePath,
                "utf8",
              ),
            );

          for (
            const match of source.matchAll(
              REPLACE_UNDERSCORE_PATTERN,
            )
          ) {
            const isAllowed =
              REPLACE_UNDERSCORE_ALLOWLIST.some(
                (allowed) =>
                  match[0].startsWith(
                    allowed,
                  ),
              );

            if (!isAllowed) {
              violations.push(
                `${file.path}: "${match[0]}" -- render via StatusBadge ` +
                  `(components/ui/status-badge) and an axis-key function ` +
                  `(src/domain/status-vocabulary) instead`,
              );
            }
          }
        }

        expect(
          violations,
          `Found ${violations.length} raw-enum-humanizing .replace() call(s):\n${violations.join("\n")}`,
        ).toEqual(
          [],
        );
      },
    );
  },
);
