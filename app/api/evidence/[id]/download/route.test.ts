import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { vi } from "vitest";

// Same mock-at-the-module-boundary shape as
// app/api/evidence/upload/route.test.ts -- this route lives one
// directory deeper (app/api/evidence/[id]/download/), so every
// relative import below has one extra "../" compared to that
// sibling file, matching route.ts's own imports exactly.
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
  "../../../../../src/infrastructure/supabase/server-client",
  () => (
    {
      getServerSupabaseClient: () => getServerSupabaseClientMock(),
    }
  ),
);

const checkMock =
  vi.fn();

vi.mock(
  "../../../../../src/infrastructure/rate-limit/rate-limiter",
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
  "../../../../../components/shell/get-client-ip",
  () => (
    {
      getClientIp: async () => "203.0.113.1",
    }
  ),
);

const getCurrentOrgSummaryMock =
  vi.fn();

vi.mock(
  "../../../../../src/application/organizations/get-current-org-context",
  () => (
    {
      getCurrentOrgSummary: (...args: unknown[]) => getCurrentOrgSummaryMock(...args),
    }
  ),
);

vi.mock(
  "../../../../../components/shell/get-preferred-org-id",
  () => (
    { getPreferredOrgId: async () => "preferred-org-id" }
  ),
);

const getEvidenceDownloadUrlMock =
  vi.fn();

vi.mock(
  "../../../../../src/application/evidence/upload-evidence",
  () => (
    {
      getEvidenceDownloadUrl: (...args: unknown[]) => getEvidenceDownloadUrlMock(...args),
    }
  ),
);

const { GET } =
  await import(
    "./route"
  );

/**
 * Authenticated-and-org-scoped happy-path setup, reused by every test
 * that needs to reach past the rate-limit/auth/org gates down to the
 * getEvidenceDownloadUrl call itself.
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

function downloadRequest(
  id = "evidence-1",
): {
  request: Request;
  context: { params: Promise<{ id: string }> };
} {
  return {
    request: new Request(
      `http://localhost/api/evidence/${id}/download`,
    ),
    context: { params: Promise.resolve({ id }) },
  };
}

async function jsonBodyOf(
  response: Response,
) {
  return {
    httpStatus: response.status,
    body: await response.json(),
  };
}

describe(
  "GET /api/evidence/[id]/download",
  () => {
    it(
      "returns 429 with a whole-seconds retryAfterSeconds, without ever calling Supabase, when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const { request, context } =
          downloadRequest();

        const {
          httpStatus,
          body,
        } = await jsonBodyOf(
          await GET(request, context),
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
      "returns 401 UNAUTHENTICATED when supabase.auth.getUser() resolves no user",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: true, retryAfterMs: 0 },
        );

        getUserMock.mockResolvedValueOnce(
          { data: { user: null } },
        );

        const { request, context } =
          downloadRequest();

        const {
          httpStatus,
          body,
        } = await jsonBodyOf(
          await GET(request, context),
        );

        expect(httpStatus).toBe(401);
        expect(body).toEqual(
          { success: false, reason: "UNAUTHENTICATED" },
        );
        expect(getCurrentOrgSummaryMock).not.toHaveBeenCalled();
        expect(getEvidenceDownloadUrlMock).not.toHaveBeenCalled();
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

        const { request, context } =
          downloadRequest();

        const {
          httpStatus,
          body,
        } = await jsonBodyOf(
          await GET(request, context),
        );

        expect(httpStatus).toBe(403);
        expect(body).toEqual(
          { success: false, reason: "NO_ORGANIZATION" },
        );
        expect(getEvidenceDownloadUrlMock).not.toHaveBeenCalled();
      },
    );

    it(
      // route.ts's own doc comment: ownership is checked BEFORE any
      // URL is generated, so a cross-org caller (or any other
      // ownership miss) gets 404, never a signed URL for someone
      // else's file. fetchOwnedEvidenceFile (upload-evidence.ts)
      // collapses both "row doesn't exist" and "row belongs to a
      // different org" into this same NOT_FOUND reason -- this test
      // proves the route maps it to 404, not that it distinguishes
      // the two underlying causes (it deliberately can't, by design).
      "returns 404 when getEvidenceDownloadUrl rejects with NOT_FOUND (cross-org / nonexistent file)",
      async () => {
        primeAuthenticatedOrgContext();

        getEvidenceDownloadUrlMock.mockResolvedValueOnce(
          { status: "REJECTED", reason: "NOT_FOUND" },
        );

        const { request, context } =
          downloadRequest("someone-elses-file");

        const {
          httpStatus,
          body,
        } = await jsonBodyOf(
          await GET(request, context),
        );

        expect(httpStatus).toBe(404);
        expect(body).toEqual(
          { success: false, reason: "NOT_FOUND" },
        );

        expect(getEvidenceDownloadUrlMock).toHaveBeenCalledWith(
          expect.anything(),
          "org-1",
          "someone-elses-file",
        );
      },
    );

    it.each(
      [
        "FETCH_FAILED",
        "SIGNING_FAILED",
      ] as const,
    )(
      "returns 500 when getEvidenceDownloadUrl rejects with %s",
      async (reason) => {
        primeAuthenticatedOrgContext();

        getEvidenceDownloadUrlMock.mockResolvedValueOnce(
          { status: "REJECTED", reason },
        );

        const { request, context } =
          downloadRequest();

        const {
          httpStatus,
          body,
        } = await jsonBodyOf(
          await GET(request, context),
        );

        expect(httpStatus).toBe(500);
        expect(body).toEqual(
          { success: false, reason },
        );
      },
    );

    it(
      "redirects (307) to the signed URL on success",
      async () => {
        primeAuthenticatedOrgContext();

        const signedUrl =
          "https://storage.example.test/signed/evidence-1?token=abc123";

        getEvidenceDownloadUrlMock.mockResolvedValueOnce(
          {
            status: "OK",
            signedUrl,
            originalFilename: "invoice.pdf",
          },
        );

        const { request, context } =
          downloadRequest();

        const response =
          await GET(request, context);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(signedUrl);
      },
    );
  },
);
