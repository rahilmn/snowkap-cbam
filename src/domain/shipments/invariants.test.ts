import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ShipmentLine,
} from "./types";

import {
  hasDenseUniqueLineNumbers,
  isLineComplete,
  isLineQuantityValid,
} from "./invariants";

function line(
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
    net_mass_tonnes: "10.5" as ShipmentLine["net_mass_tonnes"],
    quantity_mwh: null,
    production_route: null,
    emission_determination: null,
    ...overrides,
  };
}

describe(
  "isLineQuantityValid",
  () => {
    it(
      "accepts a line with only net_mass_tonnes set",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: "10" as ShipmentLine["net_mass_tonnes"],
                quantity_mwh: null,
              },
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "accepts a line with only quantity_mwh set",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: null,
                quantity_mwh: "500" as ShipmentLine["quantity_mwh"],
              },
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects a line with neither quantity set",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: null,
                quantity_mwh: null,
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a line with both quantities set",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: "10" as ShipmentLine["net_mass_tonnes"],
                quantity_mwh: "500" as ShipmentLine["quantity_mwh"],
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a zero quantity",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: "0" as ShipmentLine["net_mass_tonnes"],
                quantity_mwh: null,
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a negative quantity",
      () => {
        expect(
          isLineQuantityValid(
            line(
              {
                net_mass_tonnes: "-1" as ShipmentLine["net_mass_tonnes"],
                quantity_mwh: null,
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "isLineComplete",
  () => {
    it(
      "is false when there is no emission determination yet",
      () => {
        expect(
          isLineComplete(
            line(
              {
                emission_determination: null,
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is true once code, origin, a valid quantity, and a determination are all present",
      () => {
        expect(
          isLineComplete(
            line(
              {
                emission_determination: {
                  method: "DEFAULT",
                  resolution: {} as never,
                },
              },
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is false when cn_code is empty",
      () => {
        expect(
          isLineComplete(
            line(
              {
                cn_code: "",

                emission_determination: {
                  method: "DEFAULT",
                  resolution: {} as never,
                },
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is false when the quantity is invalid",
      () => {
        expect(
          isLineComplete(
            line(
              {
                net_mass_tonnes: null,
                quantity_mwh: null,

                emission_determination: {
                  method: "DEFAULT",
                  resolution: {} as never,
                },
              },
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "hasDenseUniqueLineNumbers",
  () => {
    it(
      "is true for 1, 2, 3 in any order",
      () => {
        expect(
          hasDenseUniqueLineNumbers(
            [
              line({ line_number: 2 }),
              line({ line_number: 1 }),
              line({ line_number: 3 }),
            ],
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is true for zero lines",
      () => {
        expect(
          hasDenseUniqueLineNumbers(
            [],
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "is false when a number repeats",
      () => {
        expect(
          hasDenseUniqueLineNumbers(
            [
              line({ line_number: 1 }),
              line({ line_number: 1 }),
            ],
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is false when there is a gap",
      () => {
        expect(
          hasDenseUniqueLineNumbers(
            [
              line({ line_number: 1 }),
              line({ line_number: 3 }),
            ],
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "is false when numbering does not start at 1",
      () => {
        expect(
          hasDenseUniqueLineNumbers(
            [
              line({ line_number: 2 }),
              line({ line_number: 3 }),
            ],
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);
