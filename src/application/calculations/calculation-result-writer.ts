import type {
  CalculationQuantityUnit,
} from "../../domain/calculations/types";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  OrganizationId,
  ShipmentLineId,
  UserId,
} from "../../domain/shared/ids";

/**
 * The port through which a computed calculation reaches the database.
 *
 * WHY THIS EXISTS AS A PORT AT ALL. Until 2026-09-03 `calculateLine`
 * simply INSERTed into `calculation_results` with the caller's own
 * session client, and the row-level security policy
 * `calculation_results_insert_own_org_as_self` decided whether that was
 * allowed. That policy pinned scope -- the org, the acting user, the
 * line/shipment linkage, an editable shipment -- and pinned nothing
 * about the numbers. A member posting raw PostgREST could therefore
 * write a row carrying the line's real determination and real quantity
 * beside a fabricated `embedded_emissions_tco2e`, and it was summed
 * verbatim into an immutable filed declaration snapshot. Reproduced
 * live at 0.001 against a true 139.
 *
 * The database cannot fix that by recomputing: the engine is
 * TypeScript, and a plpgsql reimplementation of RULE-EE-001/EE-009,
 * the Annex II direct-only rule and decimal.js semantics would be a
 * second, silently diverging copy of regulatory behaviour. So
 * `20260903190000` took the other route -- direct INSERT was revoked
 * from `anon` and `authenticated` entirely, and the only remaining
 * write channel is a SECURITY DEFINER RPC granted to `service_role`
 * alone.
 *
 * That makes the write privileged, which is exactly why it is a port
 * rather than another `supabase.from(...)` call inside this service.
 * `src/application/**` must not reach `src/infrastructure/**`, and this
 * service must not be handed a service-role client it could use for
 * anything else. The implementation lives in
 * `src/infrastructure/calculations/`, is `server-only`, can perform
 * precisely one operation, and is injected from the Server Action that
 * already owns that composition step.
 */
export interface RecordCalculationResultInput {
  readonly org_id: OrganizationId;
  readonly line_id: ShipmentLineId;
  readonly calculated_by_user_id: UserId;
  readonly engine_version: string;
  readonly parameter_datasets: readonly unknown[];
  readonly quantity: DecimalString;
  readonly quantity_unit: CalculationQuantityUnit;
  readonly determination: EmissionDetermination;
  readonly steps: readonly unknown[];
  readonly embedded_emissions_tco2e: DecimalString;
  readonly correlation_id: string;
}

/**
 * Mirrors the RPC's own `result_status` values one-for-one, so a new
 * refusal added in SQL surfaces here as a type error rather than as a
 * silent success.
 *
 * `DETERMINATION_MISMATCH`, `QUANTITY_MISMATCH` and
 * `ACTOR_NOT_A_MEMBER` are the three bindings the old RLS policy never
 * had. In normal operation none of them can fire -- this service reads
 * the line, computes from that line, and writes back the same values in
 * the same request -- so any of them arriving means either a concurrent
 * edit landed between the read and the write, or something is calling
 * the RPC with values it did not derive from the line. Both are worth
 * failing loudly on rather than absorbing.
 */
export type RecordCalculationResultOutcome =
  | { status: "OK"; calculation_id: string }
  | {
      status: "REJECTED";
      reason:
        | "LINE_NOT_FOUND"
        | "SHIPMENT_NOT_EDITABLE"
        | "ACTOR_NOT_A_MEMBER"
        | "DETERMINATION_MISMATCH"
        | "QUANTITY_MISMATCH"
        | "LINE_HAS_NO_QUANTITY"
        // Re-checked by the RPC even though calculateLine refuses
        // without it first: under the service role RLS is not standing
        // behind the write, so an application-layer gate is the only
        // thing enforcing the capability -- and the premise of this
        // whole change is that a compliance record should not rest on
        // an application-layer gate.
        | "CAPABILITY_NOT_HELD";
    }
  | { status: "FAILED"; message: string };

export interface CalculationResultWriter {
  recordCalculationResult(
    input: RecordCalculationResultInput,
  ): Promise<RecordCalculationResultOutcome>;
}
