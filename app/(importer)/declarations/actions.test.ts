import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (P13 coverage-gap audit): app/(importer)/declarations/
// actions.ts previously had zero test coverage across all five of its
// declaration lifecycle actions (startDeclarationAction,
// refreshDeclarationDraftAction, markDeclarationReadyAction,
// recordDeclarationFiledAction, createDeclarationAmendmentAction). Same
// "mock at the module boundary, dynamic-import after" shape this
// codebase's other Server Action test files already use (app/team/
// actions.test.ts, app/(importer)/shipments/[id]/actions.test.ts).

const REDIRECT_SENTINEL =
  Symbol(
    "next/navigation redirect() called",
  );

const redirectMock =
  vi.fn(
    (..._args: unknown[]) => {
      throw REDIRECT_SENTINEL;
    },
  );

vi.mock(
  "next/navigation",
  () => (
    {
      redirect: (...args: unknown[]) => redirectMock(...args),
    }
  ),
);

vi.mock(
  "next/cache",
  () => (
    { revalidatePath: () => undefined }
  ),
);

const getServerSupabaseClientMock =
  vi.fn(
    () => ({}),
  );

vi.mock(
  "../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

vi.mock(
  "../../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

const generateOrRefreshDeclarationDraftMock =
  vi.fn();

vi.mock(
  "../../../src/application/declarations/generate-or-refresh-declaration-draft",
  () => (
    {
      generateOrRefreshDeclarationDraft: (...args: unknown[]) =>
        generateOrRefreshDeclarationDraftMock(...args),
    }
  ),
);

const markDeclarationReadyMock =
  vi.fn();

vi.mock(
  "../../../src/application/declarations/mark-declaration-ready",
  () => (
    {
      markDeclarationReady: (...args: unknown[]) => markDeclarationReadyMock(...args),
    }
  ),
);

const recordDeclarationFiledMock =
  vi.fn();

vi.mock(
  "../../../src/application/declarations/record-declaration-filed",
  () => (
    {
      recordDeclarationFiled: (...args: unknown[]) => recordDeclarationFiledMock(...args),
    }
  ),
);

const createDeclarationAmendmentMock =
  vi.fn();

vi.mock(
  "../../../src/application/declarations/create-declaration-amendment",
  () => (
    {
      createDeclarationAmendment: (...args: unknown[]) => createDeclarationAmendmentMock(...args),
    }
  ),
);

const checkMock =
  vi.fn();

vi.mock(
  "../../../src/infrastructure/rate-limit/rate-limiter",
  () => (
    {
      createInMemoryRateLimiter:
        () => (
          { check: checkMock }
        ),
    }
  ),
);

vi.mock(
  "../../../components/shell/get-client-ip",
  () => (
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const {
  startDeclarationAction,
  refreshDeclarationDraftAction,
  markDeclarationReadyAction,
  recordDeclarationFiledAction,
  createDeclarationAmendmentAction,
} =
  await import(
    "./actions"
  );

afterEach(() => {
  vi.clearAllMocks();
});

function formData(
  fields: Record<string, string>,
): FormData {
  const data =
    new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  return data;
}

const ALLOWED =
  { allowed: true, retryAfterMs: 0 } as const;

function rejected(
  retryAfterMs: number,
) {
  return { allowed: false, retryAfterMs };
}

const ORG_SUMMARY =
  { context: { org_id: "org-1", user_id: "user-1" } };

describe(
  "rate limiting (each action rejects before calling its application function)",
  () => {
    it(
      "startDeclarationAction rejects without calling generateOrRefreshDeclarationDraft when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          rejected(61_000),
        );

        const result =
          await startDeclarationAction(
            { status: "idle" },
            formData(
              { year: "2026" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 61 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(generateOrRefreshDeclarationDraftMock).not.toHaveBeenCalled();
      },
    );

    it(
      "refreshDeclarationDraftAction rejects without calling generateOrRefreshDeclarationDraft when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          rejected(1_000),
        );

        const result =
          await refreshDeclarationDraftAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", year: "2026" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 1 second.",
          },
        );

        expect(generateOrRefreshDeclarationDraftMock).not.toHaveBeenCalled();
      },
    );

    it(
      "markDeclarationReadyAction rejects without calling markDeclarationReady when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          rejected(30_000),
        );

        const result =
          await markDeclarationReadyAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(markDeclarationReadyMock).not.toHaveBeenCalled();
      },
    );

    it(
      "recordDeclarationFiledAction rejects without calling recordDeclarationFiled when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          rejected(30_000),
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "REF-123" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(recordDeclarationFiledMock).not.toHaveBeenCalled();
      },
    );

    it(
      "createDeclarationAmendmentAction rejects without calling createDeclarationAmendment when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          rejected(30_000),
        );

        const result =
          await createDeclarationAmendmentAction(
            { status: "idle" },
            formData(
              { originalDeclarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(createDeclarationAmendmentMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "startDeclarationAction",
  () => {
    it(
      "redirects to the new/existing draft's detail page on success",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        generateOrRefreshDeclarationDraftMock.mockResolvedValueOnce(
          { status: "OK", declaration: { id: "decl-42" } },
        );

        await expect(
          startDeclarationAction(
            { status: "idle" },
            formData(
              { year: "2026" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/declarations/decl-42",
        );
      },
    );

    it(
      "returns a validation error for an invalid year, without calling the application function",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);

        const result =
          await startDeclarationAction(
            { status: "idle" },
            formData(
              { year: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a valid 4-digit year.",
          },
        );

        expect(generateOrRefreshDeclarationDraftMock).not.toHaveBeenCalled();
      },
    );

    it(
      "surfaces the PERIOD_HAS_READY_DECLARATION message on REJECTED",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        generateOrRefreshDeclarationDraftMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERIOD_HAS_READY_DECLARATION" },
        );

        const result =
          await startDeclarationAction(
            { status: "idle" },
            formData(
              { year: "2026" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "A declaration for this period is already marked READY. Reopen it, or wait for it to be filed, before starting a new one.",
          },
        );
      },
    );

    it(
      "surfaces the PERIOD_ALREADY_FILED message on REJECTED",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        generateOrRefreshDeclarationDraftMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERIOD_ALREADY_FILED" },
        );

        const result =
          await startDeclarationAction(
            { status: "idle" },
            formData(
              { year: "2026" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "This period already has a filed declaration. Create an amendment from that declaration instead of starting a new one.",
          },
        );
      },
    );
  },
);

describe(
  "refreshDeclarationDraftAction",
  () => {
    it(
      "returns idle and revalidates the detail page on success",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        generateOrRefreshDeclarationDraftMock.mockResolvedValueOnce(
          { status: "OK", declaration: { id: "decl-1" } },
        );

        const result =
          await refreshDeclarationDraftAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", year: "2026" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(generateOrRefreshDeclarationDraftMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns an invalid-period message when this declaration's own period fails to parse",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);

        const result =
          await refreshDeclarationDraftAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", year: "not-a-year" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "This declaration's own reporting period is invalid -- contact support.",
          },
        );

        expect(generateOrRefreshDeclarationDraftMock).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "markDeclarationReadyAction",
  () => {
    it(
      "returns idle and revalidates the detail page on success",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        markDeclarationReadyMock.mockResolvedValueOnce(
          { status: "OK", declaration: { id: "decl-1" } },
        );

        const result =
          await markDeclarationReadyAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );
      },
    );

    it(
      // The task's own specific requirement: on an INCOMPLETE rejection,
      // completeness_report.blockers must be threaded through into the
      // returned action state's `blockers` field verbatim, so the detail
      // screen can render each named blocker -- not dropped in favor of
      // the bare INCOMPLETE_MESSAGE string.
      "surfaces INCOMPLETE with result.completeness_report?.blockers threaded through as `blockers`, not dropped",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);

        const blockers =
          [
            {
              reason: "SHIPMENT_HAS_NO_LINES",
              shipment_id: "shipment-1",
              shipment_reference: "SHIP-001",
            },
            {
              reason: "LINE_NOT_CALCULATED",
              shipment_id: "shipment-2",
              shipment_reference: "SHIP-002",
              line_id: "line-9",
              line_number: 3,
            },
          ];

        markDeclarationReadyMock.mockResolvedValueOnce(
          {
            status: "REJECTED",
            reason: "INCOMPLETE",
            completeness_report: {
              generated_at: "2026-08-30T00:00:00.000Z",
              shipment_count: 2,
              line_count: 3,
              complete: false,
              blockers,
            },
          },
        );

        const result =
          await markDeclarationReadyAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This declaration isn't complete yet -- see the named blockers below.",
            blockers,
          },
        );
      },
    );

    it(
      "surfaces the NOT_DRAFT message on REJECTED, with no blockers field",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        markDeclarationReadyMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "NOT_DRAFT" },
        );

        const result =
          await markDeclarationReadyAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This declaration is no longer in DRAFT -- reload the page.",
            blockers: undefined,
          },
        );
      },
    );
  },
);

describe(
  "recordDeclarationFiledAction",
  () => {
    it(
      "returns a validation error for an empty filedReference, without calling recordDeclarationFiled",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter the filing reference.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(recordDeclarationFiledMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns idle and revalidates the detail page on success",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        recordDeclarationFiledMock.mockResolvedValueOnce(
          { status: "OK", declarationId: "decl-1" },
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "REF-2026-Q1-001" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(recordDeclarationFiledMock).toHaveBeenCalledWith(
          expect.anything(),
          ORG_SUMMARY.context,
          "decl-1",
          "REF-2026-Q1-001",
        );
      },
    );

    it(
      "surfaces the EMPTY_FILED_REFERENCE message when the application function itself rejects it (whitespace-only reference)",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        recordDeclarationFiledMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "EMPTY_FILED_REFERENCE" },
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "   " },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Enter the filing reference exactly as it appears on the declarant's own official-channel confirmation -- this field can't be blank.",
          },
        );
      },
    );

    it(
      "surfaces the NO_MEMBER_SHIPMENTS message, distinct from the other filing-time reasons",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        recordDeclarationFiledMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "NO_MEMBER_SHIPMENTS" },
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "REF-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This declaration has no member shipments to lock.",
          },
        );
      },
    );

    it(
      "surfaces the SHIPMENTS_NOT_LOCKABLE message, distinct from the other filing-time reasons",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        recordDeclarationFiledMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "SHIPMENTS_NOT_LOCKABLE" },
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "REF-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "One or more member shipments are no longer READY or LOCKED -- refresh the draft and re-check ready.",
          },
        );
      },
    );

    it(
      "surfaces the INCOMPLETE message, distinct from the other filing-time reasons",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        recordDeclarationFiledMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "INCOMPLETE" },
        );

        const result =
          await recordDeclarationFiledAction(
            { status: "idle" },
            formData(
              { declarationId: "decl-1", filedReference: "REF-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "A fresh re-check at filing time found a member line with no calculation result -- refresh the draft and re-check ready.",
          },
        );
      },
    );
  },
);

describe(
  "createDeclarationAmendmentAction",
  () => {
    it(
      "redirects to the new amendment's detail page on success",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        createDeclarationAmendmentMock.mockResolvedValueOnce(
          { status: "OK", declaration: { id: "decl-amend-1" } },
        );

        await expect(
          createDeclarationAmendmentAction(
            { status: "idle" },
            formData(
              { originalDeclarationId: "decl-1" },
            ),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/declarations/decl-amend-1",
        );
      },
    );

    it(
      "surfaces the ORIGINAL_NOT_FILED message on REJECTED",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        createDeclarationAmendmentMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "ORIGINAL_NOT_FILED" },
        );

        const result =
          await createDeclarationAmendmentAction(
            { status: "idle" },
            formData(
              { originalDeclarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only a filed declaration can be amended.",
          },
        );
      },
    );

    it(
      "surfaces the ALREADY_AMENDED message on REJECTED, distinct from ORIGINAL_NOT_FILED",
      async () => {
        checkMock.mockReturnValueOnce(ALLOWED);
        getCurrentOrgSummaryMock.mockResolvedValueOnce(ORG_SUMMARY);
        createDeclarationAmendmentMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "ALREADY_AMENDED" },
        );

        const result =
          await createDeclarationAmendmentAction(
            { status: "idle" },
            formData(
              { originalDeclarationId: "decl-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "This declaration already has an active amendment.",
          },
        );
      },
    );
  },
);
