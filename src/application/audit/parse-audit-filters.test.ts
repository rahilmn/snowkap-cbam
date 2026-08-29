import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AUDIT_AGGREGATE_TYPES,
  hasAnyAuditFilterParam,
  parseAuditFilterParams,
} from "./parse-audit-filters";

describe(
  "parseAuditFilterParams",
  () => {
    it(
      "returns an empty filter set for no params",
      () => {
        expect(
          parseAuditFilterParams(
            {},
          ),
        ).toEqual(
          {},
        );
      },
    );

    it(
      "trims and passes through a non-blank eventTypePrefix",
      () => {
        expect(
          parseAuditFilterParams(
            {
              eventTypePrefix: "  sharing_grant.  ",
            },
          ),
        ).toEqual(
          {
            eventTypePrefix: "sharing_grant.",
          },
        );
      },
    );

    it(
      "drops a blank (whitespace-only) eventTypePrefix",
      () => {
        expect(
          parseAuditFilterParams(
            {
              eventTypePrefix: "   ",
            },
          ),
        ).toEqual(
          {},
        );
      },
    );

    it(
      "accepts every known AuditAggregateType value",
      () => {
        for (
          const aggregateType of AUDIT_AGGREGATE_TYPES
        ) {
          expect(
            parseAuditFilterParams(
              {
                aggregateType,
              },
            ),
          ).toEqual(
            {
              aggregateType,
            },
          );
        }
      },
    );

    it(
      "drops an unrecognized aggregateType instead of passing it through",
      () => {
        expect(
          parseAuditFilterParams(
            {
              aggregateType: "NOT_A_REAL_TYPE",
            },
          ),
        ).toEqual(
          {},
        );
      },
    );

    it(
      "widens occurredFrom to the inclusive start of that UTC day",
      () => {
        expect(
          parseAuditFilterParams(
            {
              occurredFrom: "2026-02-01",
            },
          ),
        ).toEqual(
          {
            occurredFrom: "2026-02-01T00:00:00.000Z",
          },
        );
      },
    );

    it(
      "widens occurredTo to the inclusive end of that UTC day",
      () => {
        expect(
          parseAuditFilterParams(
            {
              occurredTo: "2026-02-01",
            },
          ),
        ).toEqual(
          {
            occurredTo: "2026-02-01T23:59:59.999Z",
          },
        );
      },
    );

    it(
      "drops a calendar-impossible date (2026-02-30) rather than passing it through",
      () => {
        expect(
          parseAuditFilterParams(
            {
              occurredFrom: "2026-02-30",
            },
          ),
        ).toEqual(
          {},
        );
      },
    );

    it(
      "drops a malformed date string rather than passing it through",
      () => {
        expect(
          parseAuditFilterParams(
            {
              occurredTo: "not-a-date",
            },
          ),
        ).toEqual(
          {},
        );
      },
    );

    it(
      "takes the first value when a param repeats (string[] from a repeated query key)",
      () => {
        expect(
          parseAuditFilterParams(
            {
              eventTypePrefix: [
                "shipment.",
                "supplier.",
              ],
            },
          ),
        ).toEqual(
          {
            eventTypePrefix: "shipment.",
          },
        );
      },
    );

    it(
      "combines all four filters when every param is present",
      () => {
        expect(
          parseAuditFilterParams(
            {
              eventTypePrefix: "emission_data.",
              aggregateType: "EMISSION_DATA",
              occurredFrom: "2026-01-01",
              occurredTo: "2026-01-31",
            },
          ),
        ).toEqual(
          {
            eventTypePrefix: "emission_data.",
            aggregateType: "EMISSION_DATA",
            occurredFrom: "2026-01-01T00:00:00.000Z",
            occurredTo: "2026-01-31T23:59:59.999Z",
          },
        );
      },
    );
  },
);

describe(
  "hasAnyAuditFilterParam",
  () => {
    it(
      "is false for no params",
      () => {
        expect(
          hasAnyAuditFilterParam(
            {},
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is false for a whitespace-only eventTypePrefix",
      () => {
        expect(
          hasAnyAuditFilterParam(
            {
              eventTypePrefix: "   ",
            },
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is true for an unrecognized aggregateType",
      () => {
        // Deliberately different from parseAuditFilterParams, which
        // drops this value -- the user still typed/chose something,
        // even though it doesn't resolve to a real filter, so the
        // empty-state decision (see this file's own doc comment) must
        // still read "no matches", not "no events yet".
        expect(
          hasAnyAuditFilterParam(
            {
              aggregateType: "NOT_A_REAL_TYPE",
            },
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is true for an unparseable date",
      () => {
        expect(
          hasAnyAuditFilterParam(
            {
              occurredFrom: "not-a-date",
            },
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is true when only one of the four params is set",
      () => {
        expect(
          hasAnyAuditFilterParam(
            {
              occurredTo: "2026-01-31",
            },
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);
