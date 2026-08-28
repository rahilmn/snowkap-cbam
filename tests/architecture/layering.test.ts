import {
  describe,
  expect,
  it,
} from "vitest";

import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  checkLayering,
  type SourceFile,
} from "./layering-rules";

// Repository root, resolved from this file's own location rather than
// process.cwd() (see the same pattern in
// src/domain/regulatory/resolve-default-value.real-data.test.ts).
const REPO_ROOT =
  fileURLToPath(
    new URL(
      "../..",
      import.meta.url,
    ),
  );

function listTypeScriptFiles(
  absoluteDirectory: string,
  repoRelativePrefix: string,
): SourceFile[] {
  const entries =
    readdirSync(
      absoluteDirectory,
    );

  const files: SourceFile[] =
    [];

  for (
    const entry of entries
  ) {
    const absolutePath =
      `${absoluteDirectory}/${entry}`;

    const repoRelativePath =
      `${repoRelativePrefix}/${entry}`;

    const stats =
      statSync(
        absolutePath,
      );

    if (stats.isDirectory()) {
      files.push(
        ...listTypeScriptFiles(
          absolutePath,
          repoRelativePath,
        ),
      );

      continue;
    }

    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
      continue;
    }

    files.push(
      {
        path: repoRelativePath,
        content:
          readFileSync(
            absolutePath,
            "utf-8",
          ),
      },
    );
  }

  return files;
}

describe(
  "checkLayering (rule engine, synthetic fixtures)",
  () => {
    it(
      "reports no violations for a clean domain -> nothing dependency",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/types.ts",
              content: `export interface Widget { id: string; }`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "catches a domain file importing from src/infrastructure",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/service.ts",
              content:
                `import { getSupabaseClient } from "../../infrastructure/supabase/client";`,
            },
          ];

        const violations =
          checkLayering(
            files,
          );

        expect(
          violations,
        ).toHaveLength(
          1,
        );

        expect(
          violations[0]?.file,
        ).toBe(
          "src/domain/widgets/service.ts",
        );
      },
    );

    it(
      "catches a domain file importing from src/application",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/service.ts",
              content:
                `import { doThing } from "../../application/widgets/do-thing";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "catches a domain file importing zod",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/types.ts",
              content:
                `import { z } from "zod";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "catches a domain file importing @supabase/supabase-js",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/types.ts",
              content:
                `import { createClient } from "@supabase/supabase-js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "catches decimal.js imported outside the allowlisted files",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/types.ts",
              content:
                `import { Decimal } from "decimal.js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows decimal.js in src/domain/shared/decimal.ts",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/shared/decimal.ts",
              content:
                `import { Decimal } from "decimal.js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "allows decimal.js anywhere under src/domain/calculations",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/calculations/engine.ts",
              content:
                `import { Decimal } from "decimal.js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "catches an application file importing @supabase/supabase-js directly",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/application/widgets/create-widget.ts",
              content:
                `import { createClient } from "@supabase/supabase-js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows an application file to import @supabase/supabase-js's TYPES only (dependency injection)",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/application/widgets/get-widget.ts",
              content:
                `import type { SupabaseClient } from "@supabase/supabase-js";\n` +
                `export async function getWidget(supabase: SupabaseClient) {}`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "still catches an application file with BOTH a type-only and a value import of @supabase/supabase-js",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/application/widgets/mixed.ts",
              content:
                `import type { SupabaseClient } from "@supabase/supabase-js";\n` +
                `import { createClient } from "@supabase/supabase-js";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows the multi-line import type style this codebase actually uses",
      () => {
        // Matches the real formatting in
        // src/application/organizations/get-current-org-context.ts --
        // guards the IMPORT_SPECIFIER_PATTERN regex against only
        // handling single-line imports.
        const files: SourceFile[] =
          [
            {
              path: "src/application/widgets/get-widget.ts",
              content:
                `import type {\n` +
                `  SupabaseClient,\n` +
                `} from "@supabase/supabase-js";\n` +
                `\n` +
                `export async function getWidget(supabase: SupabaseClient) {}`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "catches an application file importing an infrastructure adapter that is not the grandfathered port",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/application/widgets/create-widget.ts",
              content:
                `import { SupabaseWidgetRepository } from "../../infrastructure/widgets/supabase-widget-repository";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows the grandfathered RegulatoryRepository port import from application",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/application/regulatory/resolve-active-default-value.ts",
              content:
                `import type { RegulatoryRepository } from "../../infrastructure/regulatory/regulatory-repository";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "catches a domain unit test importing infrastructure",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "src/domain/widgets/service.test.ts",
              content:
                `import { getSupabaseClient } from "../../infrastructure/supabase/client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "catches a page component importing infrastructure directly",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "app/widgets/page.tsx",
              content:
                `import { getSupabaseClient } from "../../src/infrastructure/supabase/client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "catches a UI component importing infrastructure directly",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "components/widgets/widget-list.tsx",
              content:
                `import { getSupabaseClient } from "../../src/infrastructure/supabase/client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows a route handler (app/api/**) to import infrastructure directly",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "app/api/widgets/route.ts",
              content:
                `import { getSupabaseClient } from "../../../src/infrastructure/supabase/client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "allows UI to import the session-scoped Supabase clients directly",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "app/(auth)/actions.ts",
              content:
                `import { getServerSupabaseClient } from "../../src/infrastructure/supabase/server-client";`,
            },
            {
              path: "components/widgets/live-widget.tsx",
              content:
                `import { getBrowserSupabaseClient } from "../../src/infrastructure/supabase/browser-client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "still catches UI importing the service-role Supabase client (not covered by the session-client exception)",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "app/widgets/page.tsx",
              content:
                `import { getSupabaseClient } from "../../src/infrastructure/supabase/client";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "allows UI to import plain domain types",
      () => {
        const files: SourceFile[] =
          [
            {
              path: "app/widgets/page.tsx",
              content:
                `import type { Widget } from "../../src/domain/widgets/types";`,
            },
          ];

        expect(
          checkLayering(
            files,
          ),
        ).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "checkLayering (actual repository)",
  () => {
    it(
      "finds zero layering violations in src/domain and src/application",
      () => {
        const domainFiles =
          listTypeScriptFiles(
            `${REPO_ROOT}src/domain`,
            "src/domain",
          );

        const applicationFiles =
          listTypeScriptFiles(
            `${REPO_ROOT}src/application`,
            "src/application",
          );

        const violations =
          checkLayering(
            [
              ...domainFiles,
              ...applicationFiles,
            ],
          );

        expect(
          violations,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "finds zero layering violations in app/ and components/",
      () => {
        const appFiles =
          listTypeScriptFiles(
            `${REPO_ROOT}app`,
            "app",
          );

        const componentFiles =
          listTypeScriptFiles(
            `${REPO_ROOT}components`,
            "components",
          );

        const violations =
          checkLayering(
            [
              ...appFiles,
              ...componentFiles,
            ],
          );

        expect(
          violations,
        ).toEqual(
          [],
        );
      },
    );
  },
);
