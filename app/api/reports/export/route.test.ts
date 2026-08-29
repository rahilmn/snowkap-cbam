import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 2026-08-29 (P11 mandatory security review, N4): this file previously
// did not exist. Same mock-at-the-module-boundary shape as
// app/api/evidence/upload/route.test.ts -- these tests exercise only
// the rate-limit short-circuit now at the top of GET(), never real
// Supabase I/O or a real exceljs workbook build.
const getUserMock =
  vi.fn();

const getServerSupabaseClientMock =
  vi.fn(
    () => (
      { auth: { getUser: getUserMock } }
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
    { getClientIp: async () => "203.0.113.1" }
  ),
);

const { GET } =
  await import(
    "./route"
  );

afterEach(() => {
  vi.clearAllMocks();
});

function exportRequest(): Request {
  return new Request(
    "http://localhost/api/reports/export?year=2026&quarter=1",
  );
}

describe(
  "GET /api/reports/export",
  () => {
    it(
      "returns 429 without ever calling Supabase when the limiter rejects",
      async () => {
        checkMock.mockReturnValueOnce(
          { allowed: false, retryAfterMs: 61_000 },
        );

        const response =
          await GET(
            exportRequest(),
          );

        expect(response.status).toBe(429);

        const body =
          await (response as Response).json();

        expect(body).toEqual(
          { success: false, reason: "RATE_LIMITED" },
        );

        expect(getServerSupabaseClientMock).not.toHaveBeenCalled();
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

        const response =
          await GET(
            exportRequest(),
          );

        expect(response.status).toBe(401);
        expect(getUserMock).toHaveBeenCalledTimes(1);
      },
    );
  },
);
