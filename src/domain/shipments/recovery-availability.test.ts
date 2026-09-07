import {
  describe,
  expect,
  it,
} from "vitest";

import {
  recalculateAvailability,
  redetermineAvailability,
} from "./recovery-availability";

describe(
  "redetermineAvailability",
  () => {
    it(
      "is AVAILABLE on DRAFT",
      () => {
        expect(redetermineAvailability("DRAFT")).toEqual(
          { status: "AVAILABLE" },
        );
      },
    );

    it(
      "REQUIRES_REOPEN on READY -- shipment_lines is DRAFT-only writable",
      () => {
        expect(redetermineAvailability("READY")).toEqual(
          { status: "REQUIRES_REOPEN" },
        );
      },
    );

    it(
      "is BLOCKED on LOCKED, naming LOCKED",
      () => {
        expect(redetermineAvailability("LOCKED")).toEqual(
          { status: "BLOCKED", blockedStatus: "LOCKED" },
        );
      },
    );

    it(
      "is BLOCKED on VOID, naming VOID",
      () => {
        expect(redetermineAvailability("VOID")).toEqual(
          { status: "BLOCKED", blockedStatus: "VOID" },
        );
      },
    );
  },
);

describe(
  "recalculateAvailability",
  () => {
    it(
      "is AVAILABLE on DRAFT regardless of calculationEngineIsCurrent",
      () => {
        expect(recalculateAvailability("DRAFT", true)).toEqual(
          { status: "AVAILABLE" },
        );

        expect(recalculateAvailability("DRAFT", false)).toEqual(
          { status: "AVAILABLE" },
        );
      },
    );

    it(
      // Mirrors record_calculation_result's own READY carve-out
      // (20260906210000_s5_calculation_result_refuses_ready.sql): a row
      // already exists at the current engine version, so the RPC
      // refuses regardless of determination staleness -- this is the
      // LINE_CALCULATION_STALE-on-READY case S5R13-A-1 live-reproduced
      // (calc at 1.4.0, redetermine, mark READY, resubmit at the still-
      // current 1.4.0 -> SHIPMENT_NOT_EDITABLE).
      "REQUIRES_REOPEN on READY when calculationEngineIsCurrent is true (a row already exists at the current engine version -- the redetermination-stale case)",
      () => {
        expect(recalculateAvailability("READY", true)).toEqual(
          { status: "REQUIRES_REOPEN" },
        );
      },
    );

    it(
      // No row exists yet at the current engine version, so the RPC's
      // exists(...) carve-out is false and the write proceeds straight
      // through to DETERMINATION_MISMATCH (which always passes, since
      // the caller submits the line's own current determination) --
      // this is the LINE_CALCULATION_ENGINE_OUTDATED-on-READY case
      // migration 20260906210000 was deliberately widened to support
      // (S5R7-A-B1).
      "AVAILABLE on READY when calculationEngineIsCurrent is false (no row yet at the current engine version -- the engine-outdated case)",
      () => {
        expect(recalculateAvailability("READY", false)).toEqual(
          { status: "AVAILABLE" },
        );
      },
    );

    it(
      "is BLOCKED on LOCKED regardless of calculationEngineIsCurrent, naming LOCKED",
      () => {
        expect(recalculateAvailability("LOCKED", true)).toEqual(
          { status: "BLOCKED", blockedStatus: "LOCKED" },
        );

        expect(recalculateAvailability("LOCKED", false)).toEqual(
          { status: "BLOCKED", blockedStatus: "LOCKED" },
        );
      },
    );

    it(
      "is BLOCKED on VOID regardless of calculationEngineIsCurrent, naming VOID",
      () => {
        expect(recalculateAvailability("VOID", true)).toEqual(
          { status: "BLOCKED", blockedStatus: "VOID" },
        );

        expect(recalculateAvailability("VOID", false)).toEqual(
          { status: "BLOCKED", blockedStatus: "VOID" },
        );
      },
    );
  },
);
