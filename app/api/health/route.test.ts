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

// 2026-08-30: the route now also probes the product schema
// (src/application/health/check-product-schema.ts, added after a real
// production incident -- see that file's doc comment). That check uses a
// SHORTER call chain than the dataset check: `.select("id").limit(1)`
// with no `.eq()` in between. This mock therefore has to answer BOTH
// shapes off the same `select()` return value:
//
//   dataset check -> .select().eq().eq().limit()  -> selectMock
//   schema  check -> .select().limit()            -> productSchemaLimitMock
//
// Defaults to "table exists" so every pre-existing test in this file
// keeps asserting exactly what it asserted before this route gained a
// third check.
const productSchemaLimitMock =
  vi.fn(
    () =>
      Promise.resolve(
        { error: null },
      ),
  );

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
                          limit:
                            productSchemaLimitMock,

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
        expect(body.checks.product_schema).toBe("ok");
      },
    );

    it(
      "reports degraded/503 when the regulatory foundation is healthy but the PRODUCT SCHEMA is absent",
      async () => {
        // THE REGRESSION TEST FOR A REAL PRODUCTION INCIDENT
        // (docs/plans/P13_RELEASE_READINESS_REPORT.md §16.11/§32).
        //
        // The live Railway deployment reported {"status":"ok"} against a
        // Supabase project with 4 of 57 migrations applied and ZERO
        // product tables: database reachable (true), exactly one ACTIVE
        // dataset (true) -- both satisfied by the regulatory foundation
        // alone, which was all that had been migrated. A completely
        // unusable application read as fully healthy, and the gap was
        // found only by a human driving the UI.
        //
        // This test reproduces exactly that state: dataset check passes,
        // product tables missing. It must now fail the health check.
        selectMock.mockResolvedValueOnce(
          {
            data: [{ id: "dataset-1" }],
            error: null,
          },
        );

        productSchemaLimitMock.mockResolvedValue(
          {
            error: {
              code: "42P01",
              message: 'relation "public.organizations" does not exist',
            },
          } as never,
        );

        const {
          httpStatus,
          body,
        } = await bodyOf(
          await GET(),
        );

        expect(httpStatus).toBe(503);
        expect(body.status).toBe("degraded");

        // The regulatory foundation genuinely IS fine -- reporting it as
        // broken would send an operator down the wrong path entirely.
        expect(body.checks.database).toBe("ok");
        expect(body.checks.active_regulatory_dataset).toBe("ok");

        // ...but the application cannot serve a single product request.
        expect(body.checks.product_schema).toBe("missing");
        expect(body.missing_tables).toContain("organizations");

        productSchemaLimitMock.mockResolvedValue(
          { error: null } as never,
        );
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
