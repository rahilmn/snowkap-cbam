import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same mock-at-the-module-boundary shape as
// app/(auth)/actions.test.ts -- these tests only exercise the
// rate-limit short-circuit at the top of POST(), so
// getServerSupabaseClient is mocked purely to prove it's never
// CALLED on the rejected path.
const getUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      {
        auth: { getUser: getUserMock },
      }
    ),
  );

vi.mock(
  "../../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const checkMock =
  vi.fn();

vi.mock(
  "../../../../src/infrastructure/rate-limit/rate-limiter",
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
  "../../../../components/shell/get-client-ip",
  () => (
    {
      getClientIp: async () => "203.0.113.1",
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

vi.mock(
  "../../../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

const uploadEvidenceFileMock =
  vi.fn();

vi.mock(
  "../../../../src/application/evidence/upload-evidence",
  () => (
    {
      uploadEvidenceFile: (...args: unknown[]) => uploadEvidenceFileMock(...args),
    }
  ),
);

vi.mock(
  "next/cache",
  () => (
    { revalidatePath: () => undefined }
  ),
);

const { POST } =
  await import(
    "./route"
  );

/**
 * Authenticated-and-org-scoped happy-path setup, reused by every test
 * that needs to reach past the auth/org gates -- P11 finding #13's
 * own tests (Content-Length pre-check) need this, unlike the two
 * original tests above which deliberately never reach that far.
 */
function primeAuthenticatedOrgContext(): void {
  checkMock.mockReturnValueOnce(
    { allowed: true, retryAfterMs: 0 },
  );

  getUserMock.mockResolvedValueOnce(
    { data: { user: { id: "user-1" } } },
  );

  getCurrentOrgSummaryMock.mockResolvedValueOnce(
    { context: { org_id: "org-1" } },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

async function bodyOf(
  response: Awaited<ReturnType<typeof POST>>,
) {
  return {
    httpStatus: response.status,
    body: await response.json(),
  };
}

function uploadRequest(
  contentLengthOverride?: number,
): Request {
  const formData =
    new FormData();

  formData.set(
    "emissionDataId",
    "emission-data-1",
  );

  formData.set(
    "file",
    new File(
      ["contents"],
      "evidence.pdf",
      { type: "application/pdf" },
    ),
  );

  return new Request(
    "http://localhost/api/evidence/upload",
    {
      method: "POST",
      // undici's Request does NOT recompute content-length when one
      // is explicitly supplied (verified empirically before writing
      // this test) -- lets P11 finding #13's tests below exercise the
      // pre-buffer Content-Length check with a claimed size, without
      // actually constructing a multi-hundred-MB request body.
      headers:
        contentLengthOverride !== undefined
          ? { "content-length": String(contentLengthOverride) }
          : undefined,
      body: formData,
    },
  );
}

describe(
  "POST /api/evidence/upload",
  () => {
    it(
      "returns 429 with a whole-seconds retryAfterSeconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            uploadRequest(),
          ),
        );

        expect(httpStatus).toBe(429);

        expect(body).toEqual(
          {
            success: false,
            reason: "RATE_LIMITED",
            retryAfterSeconds: 61,
          },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
        expect(getUserMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds to Supabase when the limiter allows the attempt",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            uploadRequest(),
          ),
        );

        expect(httpStatus).toBe(401);
        expect(body.reason).toBe("UNAUTHENTICATED");
        expect(getUserMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      // 2026-08-29 (P11 mandatory security review, finding #13,
      // live-reproduced: a 2 GB POST body was fully buffered into
      // memory before this handler ever returned 413). Asserts the
      // rejection happens WITHOUT ever calling uploadEvidenceFile --
      // the whole point being that request.formData() (which would
      // have to fully drain the body first) is never reached either.
      "returns 413 FILE_TOO_LARGE from the Content-Length header alone, before ever calling uploadEvidenceFile",
      async () => {
        primeAuthenticatedOrgContext();

        const oversizedContentLength =
          2 * 1024 * 1024 * 1024; // 2 GB, matching the live repro

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            uploadRequest(oversizedContentLength),
          ),
        );

        expect(httpStatus).toBe(413);
        expect(body).toEqual(
          { success: false, reason: "FILE_TOO_LARGE" },
        );

        expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
      },
    );

    it(
      "proceeds past the Content-Length check for a request with no oversized claim (regression)",
      async () => {
        primeAuthenticatedOrgContext();

        uploadEvidenceFileMock.mockResolvedValueOnce(
          { status: "OK", file: { id: "evidence-1" } },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            uploadRequest(),
          ),
        );

        expect(httpStatus).toBe(200);
        expect(body).toEqual(
          { success: true, fileId: "evidence-1" },
        );

        expect(uploadEvidenceFileMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "proceeds past the Content-Length check when the claimed size is within the allowed cap",
      async () => {
        primeAuthenticatedOrgContext();

        uploadEvidenceFileMock.mockResolvedValueOnce(
          { status: "OK", file: { id: "evidence-2" } },
        );

        const withinCap =
          10 * 1024 * 1024; // 10 MB, well under the 20 MB + overhead cap

        const {
          httpStatus,
        } = await bodyOf(
          await POST(
            uploadRequest(withinCap),
          ),
        );

        expect(httpStatus).toBe(200);
        expect(uploadEvidenceFileMock).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns 403 NO_ORGANIZATION when the caller has no active org",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: { id: "user-1" } } },
        );

        getCurrentOrgSummaryMock.mockResolvedValueOnce(
          null,
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            uploadRequest(),
          ),
        );

        expect(httpStatus).toBe(403);
        expect(body).toEqual(
          { success: false, reason: "NO_ORGANIZATION" },
        );
        expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
      },
    );

    it(
      // Simulates request.formData() throwing (e.g. a client that
      // aborts mid-upload, or malformed multipart framing) -- only
      // request.headers.get(...) and request.formData() are used by
      // the route before this point, so a minimal object exposing just
      // those two is enough to stand in for a real Request here.
      "returns 400 INVALID_REQUEST when request.formData() itself throws",
      async () => {
        primeAuthenticatedOrgContext();

        const throwingRequest =
          {
            headers: new Headers(),
            formData: () => Promise.reject(new Error("stream error")),
          } as unknown as Request;

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await POST(
            throwingRequest,
          ),
        );

        expect(httpStatus).toBe(400);
        expect(body).toEqual(
          { success: false, reason: "INVALID_REQUEST" },
        );
        expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
      },
    );

    describe(
      "malformed FormData -> INVALID_REQUEST",
      () => {
        function formDataRequest(
          formData: FormData,
        ): Request {
          return new Request(
            "http://localhost/api/evidence/upload",
            {
              method: "POST",
              body: formData,
            },
          );
        }

        it(
          "returns 400 when emissionDataId is missing",
          async () => {
            primeAuthenticatedOrgContext();

            const formData =
              new FormData();

            formData.set(
              "file",
              new File(
                ["contents"],
                "evidence.pdf",
                { type: "application/pdf" },
              ),
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                formDataRequest(formData),
              ),
            );

            expect(httpStatus).toBe(400);
            expect(body).toEqual(
              { success: false, reason: "INVALID_REQUEST" },
            );
            expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
          },
        );

        it(
          "returns 400 when emissionDataId is an empty string",
          async () => {
            primeAuthenticatedOrgContext();

            const formData =
              new FormData();

            formData.set(
              "emissionDataId",
              "",
            );

            formData.set(
              "file",
              new File(
                ["contents"],
                "evidence.pdf",
                { type: "application/pdf" },
              ),
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                formDataRequest(formData),
              ),
            );

            expect(httpStatus).toBe(400);
            expect(body).toEqual(
              { success: false, reason: "INVALID_REQUEST" },
            );
            expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
          },
        );

        it(
          "returns 400 when emissionDataId is not a string (e.g. a File under that field name)",
          async () => {
            primeAuthenticatedOrgContext();

            const formData =
              new FormData();

            formData.set(
              "emissionDataId",
              new File(
                ["not-a-string"],
                "id.txt",
              ),
            );

            formData.set(
              "file",
              new File(
                ["contents"],
                "evidence.pdf",
                { type: "application/pdf" },
              ),
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                formDataRequest(formData),
              ),
            );

            expect(httpStatus).toBe(400);
            expect(body).toEqual(
              { success: false, reason: "INVALID_REQUEST" },
            );
            expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
          },
        );

        it(
          "returns 400 when the file field is missing",
          async () => {
            primeAuthenticatedOrgContext();

            const formData =
              new FormData();

            formData.set(
              "emissionDataId",
              "emission-data-1",
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                formDataRequest(formData),
              ),
            );

            expect(httpStatus).toBe(400);
            expect(body).toEqual(
              { success: false, reason: "INVALID_REQUEST" },
            );
            expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
          },
        );

        it(
          "returns 400 when the file field is not a File (e.g. a plain string)",
          async () => {
            primeAuthenticatedOrgContext();

            const formData =
              new FormData();

            formData.set(
              "emissionDataId",
              "emission-data-1",
            );

            formData.set(
              "file",
              "not-a-file",
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                formDataRequest(formData),
              ),
            );

            expect(httpStatus).toBe(400);
            expect(body).toEqual(
              { success: false, reason: "INVALID_REQUEST" },
            );
            expect(uploadEvidenceFileMock).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      // Every existing test above mocks uploadEvidenceFile to resolve
      // OK, so statusForUploadRejection's own switch (route.ts) has
      // never been exercised for any of ITS cases until now -- these
      // drive every REJECTED reason uploadEvidenceFile (and its own
      // validateEvidenceUpload) can actually return, per
      // src/application/evidence/upload-evidence.ts's UploadEvidenceResult
      // and src/domain/evidence/validate-evidence-upload.ts's
      // EvidenceUploadRejectionReason.
      "statusForUploadRejection mapping for uploadEvidenceFile's REJECTED reasons",
      () => {
        it.each(
          [
            ["EMISSION_DATA_NOT_FOUND", 404],
            ["CAPABILITY_NOT_HELD", 403],
            ["FILE_TOO_LARGE", 413],
            ["DISALLOWED_MIME_TYPE", 415],
            ["DISALLOWED_EXTENSION", 415],
            ["MIME_EXTENSION_MISMATCH", 415],
            ["EXECUTABLE_EXTENSION", 415],
            ["EMPTY_FILE", 400],
            // Not handled by an explicit case in statusForUploadRejection
            // -- both fall through to its `default: return 500` branch,
            // which is itself a real case of that function worth
            // covering, not just the named cases above it.
            ["UPLOAD_FAILED", 500],
            ["PERSIST_FAILED", 500],
          ] as const,
        )(
          "maps REJECTED reason %s to HTTP %i",
          async (reason, expectedStatus) => {
            primeAuthenticatedOrgContext();

            uploadEvidenceFileMock.mockResolvedValueOnce(
              { status: "REJECTED", reason },
            );

            const {
              httpStatus,
              body,
            } = await bodyOf(
              await POST(
                uploadRequest(),
              ),
            );

            expect(httpStatus).toBe(expectedStatus);
            expect(body).toEqual(
              { success: false, reason },
            );
          },
        );
      },
    );
  },
);
