import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Same mock-at-the-module-boundary shape as app/(auth)/actions.test.ts
// and get-preferred-org-id.test.ts (the sibling test in this
// directory) -- a fake cookie jar exposing only the `set()` method this
// action actually calls.
const cookieSetMock =
  vi.fn();

vi.mock(
  "next/headers",
  () => (
    {
      cookies: async () => (
        { set: cookieSetMock }
      ),
    }
  ),
);

// next/navigation's redirect() throws a Next-internal signal outside a
// real request context -- same sentinel-throw idiom as
// app/(auth)/actions.test.ts and app/accept-invitation/actions.test.ts,
// letting the tests below assert redirect() was actually reached, and
// with which path, without needing a real Next request/response cycle.
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

const { switchOrganizationAction } =
  await import(
    "./switch-org-action"
  );

afterEach(
  () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  },
);

function formDataWithOrgId(
  value: string | undefined,
): FormData {
  const data =
    new FormData();

  if (value !== undefined) {
    data.set(
      "orgId",
      value,
    );
  }

  return data;
}

describe(
  "switchOrganizationAction",
  () => {
    it(
      "does nothing and does not redirect when orgId is missing from the form data",
      async () => {
        await switchOrganizationAction(
          formDataWithOrgId(undefined),
        );

        expect(cookieSetMock).not.toHaveBeenCalled();
        expect(redirectMock).not.toHaveBeenCalled();
      },
    );

    it(
      "does nothing and does not redirect when orgId is an empty string",
      async () => {
        await switchOrganizationAction(
          formDataWithOrgId(""),
        );

        expect(cookieSetMock).not.toHaveBeenCalled();
        expect(redirectMock).not.toHaveBeenCalled();
      },
    );

    it(
      "does nothing and does not redirect when orgId is not a string (e.g. a File)",
      async () => {
        const data =
          new FormData();

        data.set(
          "orgId",
          new File(["org-123"], "orgId"),
        );

        await switchOrganizationAction(data);

        expect(cookieSetMock).not.toHaveBeenCalled();
        expect(redirectMock).not.toHaveBeenCalled();
      },
    );

    it(
      "sets the active-org cookie with the expected options and redirects to / when orgId is valid",
      async () => {
        vi.stubEnv(
          "NODE_ENV",
          "development",
        );

        await expect(
          switchOrganizationAction(
            formDataWithOrgId("org-456"),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(cookieSetMock).toHaveBeenCalledTimes(1);
        expect(cookieSetMock).toHaveBeenCalledWith(
          "snowkap-active-org",
          "org-456",
          {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            secure: false,
          },
        );

        expect(redirectMock).toHaveBeenCalledWith(
          "/",
        );
      },
    );

    it(
      "sets secure: true only when NODE_ENV is production",
      async () => {
        vi.stubEnv(
          "NODE_ENV",
          "production",
        );

        await expect(
          switchOrganizationAction(
            formDataWithOrgId("org-789"),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(cookieSetMock).toHaveBeenCalledWith(
          "snowkap-active-org",
          "org-789",
          expect.objectContaining(
            { secure: true },
          ),
        );
      },
    );

    it(
      "sets secure: false for any NODE_ENV other than production",
      async () => {
        vi.stubEnv(
          "NODE_ENV",
          "test",
        );

        await expect(
          switchOrganizationAction(
            formDataWithOrgId("org-000"),
          ),
        ).rejects.toBe(
          REDIRECT_SENTINEL,
        );

        expect(cookieSetMock).toHaveBeenCalledWith(
          "snowkap-active-org",
          "org-000",
          expect.objectContaining(
            { secure: false },
          ),
        );
      },
    );
  },
);
