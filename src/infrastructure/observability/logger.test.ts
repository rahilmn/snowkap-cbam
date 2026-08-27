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
