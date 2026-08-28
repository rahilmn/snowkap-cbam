/**
 * Pure import-direction rule engine for the Snowkap CBAM layered
 * architecture (see docs/architecture/ARCHITECTURE.md):
 *
 *   UI -> Application -> Domain <- Infrastructure adapters
 *
 * This module takes an in-memory list of source files and returns the
 * layering violations it finds. It has no filesystem access itself, so
 * it can be exercised with synthetic fixtures (see layering.test.ts)
 * as well as against the real tree.
 */

export interface SourceFile {
  // Repository-root-relative path using forward slashes, e.g.
  // "src/domain/regulatory/types.ts".
  path: string;
  content: string;
}

export interface LayeringViolation {
  file: string;
  message: string;
}

const IMPORT_SPECIFIER_PATTERN =
  /import\s+(type\s+)?[^;]*?\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

export interface ImportSpecifier {
  specifier: string;
  // `import type {...} from "x"` (or `import type x from "y"`) has zero
  // runtime coupling -- erased entirely at compile time. Distinguished
  // so a rule can treat "depends on this package's TYPES for a
  // dependency-injection parameter" differently from "actually calls
  // into this package" -- see the src/application @supabase/ check.
  isTypeOnly: boolean;
}

function extractImportSpecifiers(
  content: string,
): ImportSpecifier[] {
  const specifiers: ImportSpecifier[] =
    [];

  for (
    const match of content.matchAll(
      IMPORT_SPECIFIER_PATTERN,
    )
  ) {
    const specifier =
      match[2] ?? match[3];

    if (specifier) {
      specifiers.push(
        {
          specifier,
          isTypeOnly: Boolean(match[1]),
        },
      );
    }
  }

  return specifiers;
}

/**
 * Resolves a relative import specifier (e.g. "../../domain/regulatory/types.js")
 * against the importing file's own path, returning a repo-root-relative
 * path with the trailing ".js" stripped (NodeNext convention: sources
 * are .ts, imports use .js extensions). Returns null for a bare package
 * specifier (doesn't start with "." or "/").
 */
function resolveRelativeSpecifier(
  fromFilePath: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const fromSegments =
    fromFilePath
      .split(
        "/",
      )
      .slice(
        0,
        -1,
      );

  const specifierSegments =
    specifier.split(
      "/",
    );

  const resultSegments =
    [...fromSegments];

  for (
    const segment of specifierSegments
  ) {
    if (segment === "." || segment === "") {
      continue;
    }

    if (segment === "..") {
      resultSegments.pop();
      continue;
    }

    resultSegments.push(
      segment,
    );
  }

  let resolved =
    resultSegments.join(
      "/",
    );

  if (resolved.endsWith(".js")) {
    resolved =
      resolved.slice(
        0,
        -".js".length,
      );
  }

  return resolved;
}

function isUnderDirectory(
  filePath: string,
  directory: string,
): boolean {
  return (
    filePath === directory ||
    filePath.startsWith(
      `${directory}/`,
    )
  );
}

const DECIMAL_ALLOWED_FILES = [
  "src/domain/shared/decimal",
];

const DECIMAL_ALLOWED_DIRECTORIES = [
  "src/domain/calculations",
];

function isDecimalAllowed(
  filePath: string,
): boolean {
  return (
    DECIMAL_ALLOWED_FILES.includes(
      filePath.replace(
        /\.tsx?$/,
        "",
      ),
    ) ||
    DECIMAL_ALLOWED_DIRECTORIES.some(
      (directory) =>
        isUnderDirectory(
          filePath,
          directory,
        ),
    )
  );
}

const APPLICATION_GRANDFATHERED_INFRASTRUCTURE_IMPORT =
  "src/infrastructure/regulatory/regulatory-repository";

/**
 * The Next.js<->Supabase *session* integration layer -- functionally
 * the App Router equivalent of next/headers or next/cookies, not
 * business infrastructure with meaningful swappable-adapter value the
 * way SupabaseRegulatoryRepository has. UI (Server Components, Server
 * Actions, middleware) legitimately constructs a session-scoped client
 * directly; nothing else under src/infrastructure gets this exception
 * -- the service-role client and any real adapter (regulatory,
 * eventually shipments/emissions/etc.) still must not be reached from
 * UI code directly.
 */
const UI_ALLOWED_INFRASTRUCTURE_IMPORTS = [
  "src/infrastructure/supabase/server-client",
  "src/infrastructure/supabase/browser-client",
];

/**
 * Route handlers are the sanctioned exception for direct infrastructure
 * access (docs/plans/MASTER_PLAN.md §28: "route handlers only for
 * streams (upload/download), health, and future webhooks") -- every
 * other UI file should reach infrastructure through an application
 * service once one exists, never around it.
 */
function isUiFile(
  filePath: string,
): boolean {
  return (
    (isUnderDirectory(filePath, "app") &&
      !isUnderDirectory(filePath, "app/api")) ||
    isUnderDirectory(filePath, "components")
  );
}

/**
 * Checks one file against the layering rules and returns any
 * violations. `files` is only used to know which import targets exist
 * in the domain/application/infrastructure tree at all — this function
 * does not require every import to resolve to a real file.
 */
export function checkLayering(
  files: SourceFile[],
): LayeringViolation[] {
  const violations: LayeringViolation[] =
    [];

  for (
    const file of files
  ) {
    const isDomain =
      isUnderDirectory(
        file.path,
        "src/domain",
      );

    const isApplication =
      isUnderDirectory(
        file.path,
        "src/application",
      );

    const isUi =
      isUiFile(
        file.path,
      );

    if (!isDomain && !isApplication && !isUi) {
      continue;
    }

    const isDomainTest =
      isDomain &&
      /\.test\.tsx?$/.test(
        file.path,
      );

    const specifiers =
      extractImportSpecifiers(
        file.content,
      );

    for (
      const { specifier, isTypeOnly } of specifiers
    ) {
      const relativeTarget =
        resolveRelativeSpecifier(
          file.path,
          specifier,
        );

      if (relativeTarget === null) {
        // Bare package specifier.
        if (isDomain) {
          if (specifier === "decimal.js") {
            if (!isDecimalAllowed(file.path)) {
              violations.push(
                {
                  file: file.path,
                  message:
                    `src/domain imports "decimal.js" outside the allowed ` +
                    `files (src/domain/shared/decimal.ts, src/domain/calculations/**).`,
                },
              );
            }

            continue;
          }

          if (
            specifier === "zod" ||
            specifier.startsWith(
              "@supabase/",
            ) ||
            specifier === "next" ||
            specifier.startsWith(
              "next/",
            ) ||
            specifier === "react" ||
            specifier.startsWith(
              "react/",
            )
          ) {
            violations.push(
              {
                file: file.path,
                message:
                  `src/domain must not import "${specifier}" — domain code must ` +
                  `stay framework- and infrastructure-independent.`,
              },
            );
          }
        }

        if (isApplication) {
          if (
            specifier.startsWith(
              "@supabase/",
            ) &&
            !isTypeOnly
          ) {
            violations.push(
              {
                file: file.path,
                message:
                  `src/application must not import "${specifier}" directly — ` +
                  `Supabase access belongs in src/infrastructure, behind a port. ` +
                  `(A type-only "import type" is fine -- e.g. typing a client ` +
                  `parameter for dependency injection has zero runtime coupling.)`,
              },
            );
          }
        }

        continue;
      }

      // Relative specifier. Note that a domain *test* file (isDomainTest)
      // is still a domain file (isDomain) — the check below already
      // covers "domain unit tests may not import infrastructure" without
      // a separate branch, since every domain test lives under
      // src/domain and this rule applies to every file under src/domain.
      if (isDomain) {
        if (
          isUnderDirectory(
            relativeTarget,
            "src/application",
          ) ||
          isUnderDirectory(
            relativeTarget,
            "src/infrastructure",
          )
        ) {
          violations.push(
            {
              file: file.path,
              message: isDomainTest
                ? `Domain unit test must not import from infrastructure ` +
                  `or application ("${relativeTarget}").`
                : `src/domain must not import from "${relativeTarget}" — ` +
                  `domain code may only depend on other domain code.`,
            },
          );
        }
      }

      if (isApplication) {
        if (
          isUnderDirectory(
            relativeTarget,
            "src/infrastructure",
          ) &&
          relativeTarget !== APPLICATION_GRANDFATHERED_INFRASTRUCTURE_IMPORT
        ) {
          violations.push(
            {
              file: file.path,
              message:
                `src/application must not import from "${relativeTarget}" — ` +
                `the only grandfathered exception is the RegulatoryRepository ` +
                `port at ${APPLICATION_GRANDFATHERED_INFRASTRUCTURE_IMPORT}.`,
            },
          );
        }
      }

      if (isUi) {
        if (
          isUnderDirectory(
            relativeTarget,
            "src/infrastructure",
          ) &&
          !UI_ALLOWED_INFRASTRUCTURE_IMPORTS.includes(
            relativeTarget,
          )
        ) {
          violations.push(
            {
              file: file.path,
              message:
                `"${file.path}" must not import from "${relativeTarget}" — ` +
                `UI (app/** outside app/api/**, and components/**) must reach ` +
                `infrastructure through an application service, not directly. ` +
                `Route handlers (app/api/**) and the session-scoped Supabase ` +
                `clients (src/infrastructure/supabase/{server-client,browser-client}) ` +
                `are the sanctioned exceptions.`,
            },
          );
        }
      }
    }
  }

  return violations;
}
