import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-30 (test-coverage audit): app/(producer)/emission-data/actions.ts
// had ZERO test coverage across all five exported Server Actions --
// including verifyEmissionDataAction/rejectEmissionDataAction, which
// this file's own doc comments call the PRIMARY enforcement layer for
// the ADMIN+-only verify/reject compliance gate (manage-emission-data.ts's
// hasAdminAccess check, with a DB trigger as only an independent
// backstop). Same "mock at the module boundary, dynamic-import after"
// shape app/(producer)/sharing/actions.test.ts and app/team/actions.test.ts
// already use; the supabase.auth.getUser() mock shape (requireOrgAndUser
// here calls it, unlike sharing's requireOrgContext, which doesn't)
// mirrors app/(importer)/shipments/[id]/actions.test.ts instead.

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

const getUserMock =
  vi.fn(
    () => (
      { data: { user: { id: "user-1" } } }
    ),
  );

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: {
          getUser: () => getUserMock(),
        },
      }
    ),
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

const recordEmissionDataMock =
  vi.fn();

const submitForVerificationMock =
  vi.fn();

const activateEmissionDataMock =
  vi.fn();

const discardEmissionDataMock =
  vi.fn();

const verifyEmissionDataMock =
  vi.fn();

const rejectEmissionDataMock =
  vi.fn();

vi.mock(
  "../../../src/application/emissions/manage-emission-data",
  () => (
    {
      recordEmissionData: (...args: unknown[]) => recordEmissionDataMock(...args),
      submitForVerification: (...args: unknown[]) => submitForVerificationMock(...args),
      activateEmissionData: (...args: unknown[]) => activateEmissionDataMock(...args),
      discardEmissionData: (...args: unknown[]) => discardEmissionDataMock(...args),
      verifyEmissionData: (...args: unknown[]) => verifyEmissionDataMock(...args),
      rejectEmissionData: (...args: unknown[]) => rejectEmissionDataMock(...args),
    }
  ),
);

const removeEvidenceFileMock =
  vi.fn();

vi.mock(
  "../../../src/application/evidence/upload-evidence",
  () => (
    {
      removeEvidenceFile: (...args: unknown[]) => removeEvidenceFileMock(...args),
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
  recordEmissionDataAction,
  transitionEmissionDataAction,
  removeEvidenceFileAction,
  verifyEmissionDataAction,
  rejectEmissionDataAction,
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

function validAnnualFields(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    installationId: "installation-1",
    cnScope: "8501,8502",
    periodKind: "ANNUAL",
    periodYear: "2025",
    directSpecific: "1.23",
    indirectSpecific: "0.45",
    emissionUnit: "tCO2e/t",
    methodology: "EU_METHOD",
    ...overrides,
  };
}

/** Reused by every test that needs to reach past the rate-limit gate
 * and requireOrgAndUser down to the mocked application-layer call. */
function primeAllowedOrgContext(): void {
  checkMock.mockReturnValueOnce(
    { allowed: true, retryAfterMs: 0 },
  );

  getCurrentOrgSummaryMock.mockResolvedValueOnce(
    { context: { org_id: "org-1" } },
  );
}

describe(
  "recordEmissionDataAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 45_000 },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(),
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 45 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(recordEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the schema's message when installationId is missing",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(
                { installationId: "" },
              ),
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Choose an installation.",
          },
        );

        expect(recordEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a valid-reporting-year error when periodYear is out of range",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(
                { periodYear: "1999" },
              ),
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a valid reporting year.",
          },
        );

        expect(recordEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "constructs an ANNUAL period and calls recordEmissionData with it",
      async () => {
        primeAllowedOrgContext();

        recordEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(),
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(recordEmissionDataMock).toHaveBeenCalledTimes(1);

        const input =
          recordEmissionDataMock.mock.calls[0]?.[2];

        expect(input.period).toEqual(
          { kind: "ANNUAL", year: 2025 },
        );
      },
    );

    it(
      "constructs a QUARTERLY period when a valid quarter is chosen",
      async () => {
        primeAllowedOrgContext();

        recordEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(
                { periodKind: "QUARTERLY", periodQuarter: "3" },
              ),
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        const input =
          recordEmissionDataMock.mock.calls[0]?.[2];

        expect(input.period).toEqual(
          { kind: "QUARTERLY", year: 2025, quarter: 3 },
        );
      },
    );

    it(
      "returns a choose-a-quarter error, without calling recordEmissionData, when QUARTERLY has no valid quarter",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(
                { periodKind: "QUARTERLY", periodQuarter: "5" },
              ),
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Choose a quarter for a quarterly reporting period.",
          },
        );

        expect(recordEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "splits, trims, and drops empty entries when building cnScope",
      async () => {
        primeAllowedOrgContext();

        recordEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        await recordEmissionDataAction(
          { status: "idle" },
          formData(
            validAnnualFields(
              { cnScope: "  8501 , ,8502  ,, 8503 " },
            ),
          ),
        );

        const input =
          recordEmissionDataMock.mock.calls[0]?.[2];

        expect(input.cnScope).toEqual(
          ["8501", "8502", "8503"],
        );
      },
    );

    it(
      "returns the not-a-member error when the caller has no current org context",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
        );

        const result =
          await recordEmissionDataAction(
            { status: "idle" },
            formData(
              validAnnualFields(),
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "You are not a member of an organization.",
          },
        );

        expect(recordEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    describe(
      "REJECTED-reason mapping",
      () => {
        it(
          "maps EMPTY_CN_SCOPE to the at-least-one-CN-code message",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "EMPTY_CN_SCOPE" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Enter at least one CN code.",
              },
            );
          },
        );

        it(
          "maps INVALID_DIRECT_SPECIFIC to the direct-specific message",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "INVALID_DIRECT_SPECIFIC" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Enter a valid direct specific emissions value.",
              },
            );
          },
        );

        it(
          "maps INVALID_INDIRECT_SPECIFIC to the indirect-specific message",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "INVALID_INDIRECT_SPECIFIC" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Enter a valid indirect specific emissions value.",
              },
            );
          },
        );

        it(
          "maps INSTALLATION_NOT_FOUND to the choose-a-valid-installation message",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "INSTALLATION_NOT_FOUND" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Choose a valid installation.",
              },
            );
          },
        );

        it(
          "maps CAPABILITY_NOT_HELD to the not-a-producer message",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Your organization is not set up as a CBAM producer/operator.",
              },
            );
          },
        );

        it(
          "falls back to the generic error message for an unmapped REJECTED reason",
          async () => {
            primeAllowedOrgContext();

            recordEmissionDataMock.mockResolvedValueOnce(
              { status: "REJECTED", reason: "SOME_UNMAPPED_REASON" },
            );

            const result =
              await recordEmissionDataAction(
                { status: "idle" },
                formData(
                  validAnnualFields(),
                ),
              );

            expect(result).toEqual(
              {
                status: "error",
                message: "Something went wrong. Please try again.",
              },
            );
          },
        );
      },
    );
  },
);

describe(
  "transitionEmissionDataAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 12_000 },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "ACTIVATE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 12 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(activateEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a generic invalid-request error for an unrecognized action value",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "BOGUS" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(submitForVerificationMock).not.toHaveBeenCalled();
        expect(activateEmissionDataMock).not.toHaveBeenCalled();
        expect(discardEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls submitForVerification for SUBMIT_FOR_VERIFICATION and returns idle",
      async () => {
        primeAllowedOrgContext();

        submitForVerificationMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "SUBMIT_FOR_VERIFICATION" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(submitForVerificationMock).toHaveBeenCalledTimes(1);
        expect(activateEmissionDataMock).not.toHaveBeenCalled();
        expect(discardEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls activateEmissionData for ACTIVATE and returns idle",
      async () => {
        primeAllowedOrgContext();

        activateEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "ACTIVATE" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(activateEmissionDataMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "calls discardEmissionData for DISCARD and returns idle",
      async () => {
        primeAllowedOrgContext();

        discardEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "DISCARD" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(discardEmissionDataMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      // Exact copy required by the owner's blocking-model directive
      // (2026-08-28, see actions.ts's own comment on this reason) --
      // this is the message shown when ACTIVATE is attempted before
      // the record's evidence is complete.
      "maps EVIDENCE_INCOMPLETE to the additional-evidence-required message",
      async () => {
        primeAllowedOrgContext();

        activateEmissionDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "EVIDENCE_INCOMPLETE" },
        );

        const result =
          await transitionEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", action: "ACTIVATE" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Additional evidence is required before these actual emissions " +
              "can be used as verified data.",
          },
        );
      },
    );
  },
);

describe(
  "removeEvidenceFileAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 20_000 },
        );

        const result =
          await removeEvidenceFileAction(
            { status: "idle" },
            formData(
              { evidenceFileId: "evidence-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 20 seconds.",
          },
        );

        expect(removeEvidenceFileMock).not.toHaveBeenCalled();
      },
    );

    it(
      "calls removeEvidenceFile and returns idle when the limiter allows",
      async () => {
        primeAllowedOrgContext();

        removeEvidenceFileMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await removeEvidenceFileAction(
            { status: "idle" },
            formData(
              { evidenceFileId: "evidence-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(removeEvidenceFileMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "maps NOT_FOUND to the file-could-not-be-found message",
      async () => {
        primeAllowedOrgContext();

        removeEvidenceFileMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );

        const result =
          await removeEvidenceFileAction(
            { status: "idle" },
            formData(
              { evidenceFileId: "evidence-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "That evidence file could not be found.",
          },
        );
      },
    );
  },
);

describe(
  "verifyEmissionDataAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 30_000 },
        );

        const result =
          await verifyEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 30 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(verifyEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a generic invalid-request error when emissionDataId is empty",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await verifyEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Invalid request.",
          },
        );

        expect(verifyEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      // This is the ADMIN+-only compliance gate this file's own
      // comments call the PRIMARY enforcement layer
      // (manage-emission-data.ts's hasAdminAccess check, with a DB
      // trigger as only a backstop) -- a non-ADMIN+ caller must be
      // rejected here.
      "returns the admin-or-owner message when a non-ADMIN+ caller is rejected with PERMISSION_DENIED",
      async () => {
        primeAllowedOrgContext();

        verifyEmissionDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        const result =
          await verifyEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only an admin or owner can verify or reject emission data.",
          },
        );
      },
    );

    it(
      "maps EVIDENCE_INCOMPLETE to the additional-evidence-required message",
      async () => {
        primeAllowedOrgContext();

        verifyEmissionDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "EVIDENCE_INCOMPLETE" },
        );

        const result =
          await verifyEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message:
              "Additional evidence is required before these actual emissions " +
              "can be used as verified data.",
          },
        );
      },
    );

    it(
      "calls verifyEmissionData with the org context and emissionDataId, and returns idle, on the happy path",
      async () => {
        primeAllowedOrgContext();

        verifyEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await verifyEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1" },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(verifyEmissionDataMock).toHaveBeenCalledTimes(1);
        expect(verifyEmissionDataMock).toHaveBeenCalledWith(
          expect.anything(),
          { org_id: "org-1" },
          "emission-1",
        );
      },
    );
  },
);

describe(
  "rejectEmissionDataAction",
  () => {
    it(
      "returns a too-many-requests error, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 18_000 },
        );

        const result =
          await rejectEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", reason: "Missing evidence." },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Too many requests. Try again in 18 seconds.",
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(rejectEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the schema's reason-required message when reason is empty, without calling rejectEmissionData",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        const result =
          await rejectEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", reason: "" },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a reason for rejecting this record.",
          },
        );

        expect(rejectEmissionDataMock).not.toHaveBeenCalled();
      },
    );

    it(
      // A whitespace-only reason ("   ") passes the schema's min(1)
      // check (it has length), so this exercises the application
      // layer's own REJECTION_REASON_REQUIRED REJECTED reason on the
      // post-trim value -- a distinct path from the zod-level test
      // above, through transitionMessageFor's REJECTION_REASON_REQUIRED
      // case rather than the schema's own custom message.
      "maps REJECTION_REASON_REQUIRED from rejectEmissionData to the same reason-required message",
      async () => {
        primeAllowedOrgContext();

        rejectEmissionDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "REJECTION_REASON_REQUIRED" },
        );

        const result =
          await rejectEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", reason: "   " },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Enter a reason for rejecting this record.",
          },
        );

        expect(rejectEmissionDataMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          "emission-1",
          "",
        );
      },
    );

    it(
      // Same ADMIN+-only compliance gate as verifyEmissionDataAction
      // above -- a non-ADMIN+ caller rejecting a record must also be
      // denied.
      "returns the admin-or-owner message when a non-ADMIN+ caller is rejected with PERMISSION_DENIED",
      async () => {
        primeAllowedOrgContext();

        rejectEmissionDataMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "PERMISSION_DENIED" },
        );

        const result =
          await rejectEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", reason: "Missing evidence." },
            ),
          );

        expect(result).toEqual(
          {
            status: "error",
            message: "Only an admin or owner can verify or reject emission data.",
          },
        );
      },
    );

    it(
      "calls rejectEmissionData with the trimmed reason, and returns idle, on the happy path",
      async () => {
        primeAllowedOrgContext();

        rejectEmissionDataMock.mockResolvedValueOnce(
          { status: "OK" },
        );

        const result =
          await rejectEmissionDataAction(
            { status: "idle" },
            formData(
              { emissionDataId: "emission-1", reason: "  Missing evidence.  " },
            ),
          );

        expect(result).toEqual(
          { status: "idle" },
        );

        expect(rejectEmissionDataMock).toHaveBeenCalledTimes(1);
        expect(rejectEmissionDataMock).toHaveBeenCalledWith(
          expect.anything(),
          { org_id: "org-1" },
          "emission-1",
          "Missing evidence.",
        );
      },
    );
  },
);
