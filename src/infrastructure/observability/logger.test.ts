import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRequestId,
  log,
} from "./logger";

describe(
  "log",
  () => {
    let writes: string[];

    beforeEach(() => {
      writes =
        [];

      vi.spyOn(
        console,
        "log",
      ).mockImplementation(
        (line: string) => {
          writes.push(
            line,
          );
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(
      "writes a single-line JSON object with level, message, and time",
      () => {
        log(
          "info",
          "server started",
        );

        expect(
          writes,
        ).toHaveLength(
          1,
        );

        const parsed =
          JSON.parse(
            writes[0] ??
              "{}",
          );

        expect(
          parsed.level,
        ).toBe(
          "info",
        );

        expect(
          parsed.message,
        ).toBe(
          "server started",
        );

        expect(
          typeof parsed.time,
        ).toBe(
          "string",
        );
      },
    );

    it(
      "includes arbitrary structured fields alongside the message",
      () => {
        log(
          "warn",
          "unresolved regulatory resolution",
          {
            request_id:
              "req-123",

            origin_country_name:
              "Kiribati",
          },
        );

        const parsed =
          JSON.parse(
            writes[0] ??
              "{}",
          );

        expect(
          parsed.request_id,
        ).toBe(
          "req-123",
        );

        expect(
          parsed.origin_country_name,
        ).toBe(
          "Kiribati",
        );
      },
    );

    it(
      // 2026-08-29 (P11 mandatory security review, N6): live-probed
      // before this fix -- log("error", "...", {supabase_key,
      // submitted_password, authorization}) emitted all three
      // verbatim. This is the regression test for that gap.
      "redacts fields whose NAME matches a sensitive-keyword deny-list, by key name alone",
      () => {
        log(
          "error",
          "auth failure",
          {
            supabase_key: "sb_secret_abc123",
            submitted_password: "hunter2",
            authorization: "Bearer eyJ...",
            api_key: "live_key_xyz",
            refresh_token: "rt_abc",
            user_email: "user@example.com",
          },
        );

        const parsed =
          JSON.parse(
            writes[0] ??
              "{}",
          );

        expect(parsed.supabase_key).toBe("[REDACTED]");
        expect(parsed.submitted_password).toBe("[REDACTED]");
        expect(parsed.authorization).toBe("[REDACTED]");
        expect(parsed.api_key).toBe("[REDACTED]");
        expect(parsed.refresh_token).toBe("[REDACTED]");

        // A field whose name is NOT sensitive-shaped passes through
        // unredacted -- this is a name-based deny-list, not a
        // blanket "hide everything" mode.
        expect(parsed.user_email).toBe("user@example.com");
      },
    );

    it(
      "leaves ordinary, non-secret-shaped field names untouched (no false-positive redaction of everyday fields)",
      () => {
        log(
          "warn",
          "unresolved regulatory resolution",
          {
            request_id: "req-123",
            origin_country_name: "Kiribati",
            org_id: "a0000000-0000-0000-0000-00000000000a",
          },
        );

        const parsed =
          JSON.parse(
            writes[0] ??
              "{}",
          );

        expect(parsed.request_id).toBe("req-123");
        expect(parsed.origin_country_name).toBe("Kiribati");
        expect(parsed.org_id).toBe("a0000000-0000-0000-0000-00000000000a");
      },
    );

    it(
      "never lets a field named level/message/time in the payload override the reserved ones",
      () => {
        log(
          "error",
          "boom",
          {
            level:
              "spoofed",

            message:
              "spoofed",

            time:
              "spoofed",
          },
        );

        const parsed =
          JSON.parse(
            writes[0] ??
              "{}",
          );

        expect(
          parsed.level,
        ).toBe(
          "error",
        );

        expect(
          parsed.message,
        ).toBe(
          "boom",
        );

        expect(
          parsed.time,
        ).not.toBe(
          "spoofed",
        );
      },
    );
  },
);

describe(
  "createRequestId",
  () => {
    it(
      "returns a non-empty string",
      () => {
        expect(
          createRequestId().length,
        ).toBeGreaterThan(
          0,
        );
      },
    );

    it(
      "returns a different value on each call",
      () => {
        expect(
          createRequestId(),
        ).not.toBe(
          createRequestId(),
        );
      },
    );
  },
);
