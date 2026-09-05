import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  IncompleteLineReason,
} from "../../src/application/reporting/build-period-summary";

import type {
  IncompleteLineReasonKey,
} from "../../src/domain/status-vocabulary/types";

import {
  incompleteLineReasonKey,
} from "../../src/domain/status-vocabulary";

/**
 * S1 remediation (independent Opus 5 review, S1 finding #3).
 *
 * IncompleteLineReasonKey (src/domain/status-vocabulary/types.ts) is
 * the one StatusKey axis NOT built as a template literal type off its
 * own domain union, because its source type -- IncompleteLineReason --
 * lives in the APPLICATION layer, and src/domain/** may depend on
 * nothing outside itself (CLAUDE.md's layering rule, enforced for real
 * by tests/architecture/layering.test.ts, which flags a domain file's
 * relative import from src/application regardless of whether it is
 * `import type` -- see checkLayering in layering-rules.ts, which does
 * not special-case type-only imports for domain files). That left this
 * one axis without a COMPILE-TIME exhaustiveness guarantee: a 4th
 * IncompleteLineReason member would compile clean and only surface as
 * a RUNTIME throw, at incompleteLineReasonKey's own exhaustive-switch
 * `default` branch (axis-keys.ts).
 *
 * This file closes that gap WITHOUT weakening the layering rule and
 * WITHOUT src/domain importing anything from src/application: the
 * cross-referencing import happens HERE, in tests/architecture/, which
 * sits entirely outside the UI -> Application -> Domain layering graph
 * checkLayering actually walks (confirmed: its own "actual repository"
 * describe block only scans src/domain, src/application, app, and
 * components -- never tests/**) -- so pulling in both layers' TYPES
 * for a compile-time-only check is not a layering violation, it is
 * exactly what an architecture test is for. src/domain/status-
 * vocabulary/types.ts itself is completely unchanged by this file.
 *
 * `Equals<A, B>` below is the standard TypeScript idiom for exact type
 * equality (distributive conditional types compared in an invariant
 * position via a wrapping function type) -- it is `true` only when A
 * and B have exactly the same members in both directions, so it
 * catches EITHER side gaining, losing, or renaming a member, not just
 * one direction. It has zero runtime footprint: erased entirely by
 * `tsc`, so this remains a type-only cross-layer reference, never a
 * runtime one.
 *
 * If IncompleteLineReason ever drifts from IncompleteLineReasonKey,
 * `pnpm typecheck` now fails at _assertIncompleteLineReasonKeyMatches
 * below -- exhaustiveness is enforced by the type system again, the
 * same property every other StatusKey axis already has.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type AssertTrue<_T extends true> =
  true;

// The real assertion. Confirmed (RED step of this remediation) that
// deliberately omitting a member here fails `pnpm typecheck` with
// "Type 'false' does not satisfy the constraint 'true'" at this exact
// line -- proving Equals<> genuinely detects drift, not just when the
// two unions already happen to agree.
type _assertIncompleteLineReasonKeyMatchesApplicationUnion =
  AssertTrue<
    Equals<
      IncompleteLineReasonKey,
      `incomplete_line.${IncompleteLineReason}`
    >
  >;

describe(
  "IncompleteLineReasonKey exhaustiveness (mechanical cross-layer check, S1 finding #3)",
  () => {
    it(
      "incompleteLineReasonKey round-trips every current IncompleteLineReason member to its StatusKey",
      () => {
        const reasons: IncompleteLineReason[] =
          [
            "NO_DETERMINATION",
            "NOT_CALCULATED",
            "CALCULATION_STALE",
          ];

        for (
          const reason of reasons
        ) {
          expect(
            incompleteLineReasonKey(
              reason,
            ),
          ).toBe(
            `incomplete_line.${reason}`,
          );
        }
      },
    );
  },
);
