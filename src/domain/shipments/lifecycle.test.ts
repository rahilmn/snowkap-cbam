import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  Shipment,
  ShipmentLine,
} from "./types";

import {
  transitionShipment,
} from "./lifecycle";

function completeLine(
  overrides: Partial<ShipmentLine> = {},
): ShipmentLine {
  return {
    id: "line-1" as ShipmentLine["id"],
    shipment_id: "shipment-1" as ShipmentLine["shipment_id"],
    org_id: "org-1" as ShipmentLine["org_id"],
    line_number: 1,
    cn_code: "72061000",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "IN" as ShipmentLine["origin_country"],
    net_mass_tonnes: "10" as ShipmentLine["net_mass_tonnes"],
    quantity_mwh: null,
    production_route: null,

    emission_determination: {
      method: "DEFAULT",
      resolution: {} as never,
    },

    ...overrides,
  };
}

function shipment(
  overrides: Partial<Shipment> = {},
): Shipment {
  return {
    id: "shipment-1" as Shipment["id"],
    org_id: "org-1" as Shipment["org_id"],
    reference: "REF-001",
    release_date: "2026-01-15" as Shipment["release_date"],

    reporting_period: {
      kind: "ANNUAL",
      year: 2026,
    },

    customs_mrn: null,
    customs_procedure: null,
    status: "DRAFT",
    lines: [completeLine()],

    created_at: "2026-01-15T00:00:00.000Z" as Shipment["created_at"],
    updated_at: "2026-01-15T00:00:00.000Z" as Shipment["updated_at"],
    ...overrides,
  };
}

describe(
  "transitionShipment MARK_READY",
  () => {
    it(
      "moves a DRAFT shipment with complete lines to READY",
      () => {
        const result =
          transitionShipment(
            shipment(),
            "MARK_READY",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.shipment.status,
          ).toBe(
            "READY",
          );
        }
      },
    );

    it(
      "rejects a shipment with zero lines",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                lines: [],
              },
            ),
            "MARK_READY",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "NO_LINES",
          },
        );
      },
    );

    it(
      "rejects a shipment with an incomplete line",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                lines: [
                  completeLine(
                    {
                      emission_determination: null,
                    },
                  ),
                ],
              },
            ),
            "MARK_READY",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "LINE_INCOMPLETE",
          },
        );
      },
    );

    it(
      "rejects a shipment that is not DRAFT",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "READY",
              },
            ),
            "MARK_READY",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_NOT_DRAFT",
          },
        );
      },
    );
  },
);

describe(
  "transitionShipment REOPEN",
  () => {
    it(
      "moves a READY shipment back to DRAFT",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "READY",
              },
            ),
            "REOPEN",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.shipment.status,
          ).toBe(
            "DRAFT",
          );
        }
      },
    );

    it(
      "rejects reopening a DRAFT shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "DRAFT",
              },
            ),
            "REOPEN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_NOT_READY",
          },
        );
      },
    );

    it(
      "rejects reopening a LOCKED shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "LOCKED",
              },
            ),
            "REOPEN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_NOT_READY",
          },
        );
      },
    );
  },
);

describe(
  "transitionShipment LOCK",
  () => {
    it(
      "moves a READY shipment to LOCKED",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "READY",
              },
            ),
            "LOCK",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.shipment.status,
          ).toBe(
            "LOCKED",
          );
        }
      },
    );

    it(
      "rejects locking a DRAFT shipment",
      () => {
        const result =
          transitionShipment(
            shipment(),
            "LOCK",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_NOT_READY",
          },
        );
      },
    );

    it(
      "rejects locking an already-LOCKED shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "LOCKED",
              },
            ),
            "LOCK",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_NOT_READY",
          },
        );
      },
    );
  },
);

describe(
  "transitionShipment VOID",
  () => {
    it(
      "voids a DRAFT shipment",
      () => {
        const result =
          transitionShipment(
            shipment(),
            "VOID",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.shipment.status,
          ).toBe(
            "VOID",
          );
        }
      },
    );

    it(
      "voids a READY shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "READY",
              },
            ),
            "VOID",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects voiding a LOCKED shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "LOCKED",
              },
            ),
            "VOID",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_ALREADY_LOCKED",
          },
        );
      },
    );

    it(
      "rejects voiding an already-VOID shipment",
      () => {
        const result =
          transitionShipment(
            shipment(
              {
                status: "VOID",
              },
            ),
            "VOID",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "REJECTED",
            reason: "SHIPMENT_ALREADY_VOID",
          },
        );
      },
    );
  },
);
