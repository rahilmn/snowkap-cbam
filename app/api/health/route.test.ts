import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mocked before importing the route so GET() never touches a real
// Supabase client -- this is a pure unit test of the route's own
// status-mapping logic, not an integration test (see tests/e2e/shell.spec.ts
// for the credentialed, real-database happy-path check).
const selectMock =
  vi.fn();

vi.mock(
  "../../../src/infrastructure/supabase/client",
  () => (
    {
      getSupabaseClient:
        vi.fn(
          () => (
            {
              from:
                () => (
                  {
                    select:
                      () => (
                        {
                          eq:
                            () => (
                              {
                                eq:
                                  () => (
                                    {
                                      limit:
                                        selectMock,
                                    }
                                  ),
                              }
                            ),
                        }
                      ),
                  }
                ),
            }
          ),
        ),
    }
  ),
);

vi.mock(
  "../../../src/infrastructure/observability/logger",
  () => (
    {
      log:
        vi.fn(),
    }
  ),
);

const { GET } =
  await import(
    "./route"
  );

afterEach(() => {
  vi.clearAllMocks();
});

async function bodyOf(
  response: Awaited<ReturnType<typeof GET>>,
) {
  return {
    httpStatus:
      response.status,

    body:
      await response.json(),
  };
}

describe(
  "GET /api/health",
  () => {
    it(
      "reports ok when exactly one ACTIVE dataset is found",
      async () => {
        selectMock.mockResolvedValueOnce(
          {
            data: [{ id: "dataset-1" }],
            error: null,
          },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(200);
        expect(body.status).toBe("ok");
        expect(body.checks.database).toBe("ok");
        expect(body.checks.active_regulatory_dataset).toBe("ok");
      },
    );

    it(
      "marks active_regulatory_dataset as error (not ok) when the query itself errors",
      async () => {
        selectMock.mockResolvedValueOnce(
          {
            data: null,
            error: { message: "connection reset" },
          },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.checks.database).toBe("error");
        // Regression: this field previously stayed "ok" even though the
        // dataset invariant was never actually checked on this branch.
        expect(body.checks.active_regulatory_dataset).toBe("error");
      },
    );

    it(
      "marks active_regulatory_dataset as error (not ok) when the query throws",
      async () => {
        selectMock.mockRejectedValueOnce(
          new Error("network unreachable"),
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.checks.database).toBe("error");
        // Regression: this field previously stayed "ok" even though the
        // dataset invariant was never actually checked on this branch.
        expect(body.checks.active_regulatory_dataset).toBe("error");
      },
    );

    it(
      "reports missing when zero ACTIVE datasets are found",
      async () => {
        selectMock.mockResolvedValueOnce(
          {
            data: [],
            error: null,
          },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.checks.database).toBe("ok");
        expect(body.checks.active_regulatory_dataset).toBe("missing");
      },
    );

    it(
      "reports duplicate when more than one ACTIVE dataset is found",
      async () => {
        selectMock.mockResolvedValueOnce(
          {
            data: [{ id: "dataset-1" }, { id: "dataset-2" }],
            error: null,
          },
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.checks.database).toBe("ok");
        expect(body.checks.active_regulatory_dataset).toBe("duplicate");
      },
    );
  },
);
