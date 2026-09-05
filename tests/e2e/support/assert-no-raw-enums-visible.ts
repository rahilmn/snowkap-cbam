import {
  type Page,
  expect,
} from "@playwright/test";

/**
 * Snowkap CBAM SME Experience v2.1.1 §9.6, layer 3: the runtime half
 * of vocabulary enforcement. Layers 1/2 (compile-time exhaustiveness
 * in src/domain/status-vocabulary/labels.ts, and the static scan in
 * tests/architecture/status-vocabulary-enforcement.test.ts) both
 * check the SOURCE; this checks what a real browser actually painted,
 * which is the only place a bug that slips past both of those would
 * still be visible -- e.g. a StatusBadge call site accidentally
 * concatenating the raw value alongside the label, not instead of it.
 *
 * The raw literal values below are every concrete member of every
 * StatusKey axis (src/domain/status-vocabulary/types.ts) EXCEPT
 * IncompleteLineReasonKey's three members, which collide with English
 * words too generic to search for reliably in prose ("NOT_CALCULATED"
 * is fine; none of the three collide in practice, so they ARE
 * included below for completeness). Deliberately duplicated as a flat
 * literal list rather than imported from the domain module: this is
 * an E2E test asset (tests/e2e/**), which must not import from
 * src/domain/** (that boundary exists for the app's own runtime code,
 * but keeping this list independent means a compile-time typo in
 * types.ts and a runtime-sweep typo here are extremely unlikely to be
 * the SAME typo, which is exactly the kind of independent check this
 * layer exists to be).
 */
const RAW_ENUM_VALUES: string[] =
  [
    // shipment / declaration
    "DRAFT",
    "READY",
    "LOCKED",
    "VOID",
    "FILED_RECORDED",

    // emission_record
    "ACTIVE",
    "SUPERSEDED",
    "DISCARDED",

    // sharing_grant
    "INVITED",
    "REVOKED",
    "EXPIRED",

    // resolution
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

    // value
    "AVAILABLE",
    "SOURCE_TEXT",

    // calculation
    "COMPUTED",
    "INPUT_UNRESOLVED",
    "VALUE_UNAVAILABLE",
    "UNIT_UNSUPPORTED",
    "PARAMETER_DATASET_UNAVAILABLE",

    // blocker
    "NO_SHIPMENTS_IN_PERIOD",
    "SHIPMENT_NOT_LOCKABLE",
    "SHIPMENT_HAS_NO_LINES",
    "LINE_NOT_DETERMINED",
    "LINE_NOT_CALCULATED",
    "LINE_CALCULATION_STALE",

    // methodology
    "EU_METHOD",
    "EQUIVALENT_METHOD",

    // role
    "OWNER",
    "ADMIN",
    "MEMBER",
  ];

// Word-boundary, case-SENSITIVE (every raw value is SCREAMING_SNAKE
// or all-caps -- STATUS_LABEL's humanized copy never is, e.g. "Filed
// (recorded)" for FILED_RECORDED, so a case-sensitive match cannot
// collide with legitimate sentence-case prose).
const RAW_ENUM_PATTERN =
  new RegExp(
    `\\b(${RAW_ENUM_VALUES.join("|")})\\b`,
  );

/**
 * Asserts that no raw StatusKey-axis enum value is currently painted
 * as visible text anywhere on `page`. `data-status-key` (StatusBadge's
 * own machine-readable attribute) is not visible text -- an
 * `innerText()` read never includes it -- so a real StatusBadge render
 * passes this check without any special-casing; only a bypass that
 * puts the RAW value where a human reads it can fail it.
 *
 * Call this at checkpoints in a journey spec right after navigating to
 * or updating a screen that renders shipment/declaration/emission-
 * record/sharing-grant/resolution/value/calculation/blocker/
 * methodology/role state -- not on every single page, since most
 * screens in a journey render none of these.
 */
export async function assertNoRawEnumsVisible(
  page: Page,
): Promise<void> {
  const visibleText =
    await page.locator(
      "body",
    ).innerText();

  const match =
    visibleText.match(
      RAW_ENUM_PATTERN,
    );

  expect(
    match,
    match
      ? `Found a raw enum value "${match[0]}" rendered as visible text -- ` +
        `it should render via StatusBadge (components/ui/status-badge) instead.`
      : undefined,
  ).toBeNull();
}
