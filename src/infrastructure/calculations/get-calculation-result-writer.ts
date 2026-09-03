import "server-only";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CalculationResultWriter,
  RecordCalculationResultInput,
  RecordCalculationResultOutcome,
} from "../../application/calculations/calculation-result-writer";

import {
  loadSupabaseEnv,
} from "../config/env";

/**
 * The one privileged operation `calculateLine` needs, and nothing else.
 *
 * `20260903190000` revoked INSERT on `calculation_results` from `anon`
 * and `authenticated`, because an RLS policy can pin who is writing and
 * which line they are writing about but cannot tell a real emissions
 * figure from a fabricated one -- the engine that produces it is
 * TypeScript. The only remaining write channel is
 * `public.record_calculation_result`, a SECURITY DEFINER function
 * granted to `service_role` alone.
 *
 * DELIBERATELY NOT `src/infrastructure/supabase/admin-client.ts`. That
 * client's own doc comment states its narrowness as load-bearing: it is
 * scoped by convention to the Auth admin API so that Server Actions can
 * send an invitation email "without opening a general RLS-bypass escape
 * hatch to the rest of the schema." Reusing it for a table write would
 * make that sentence false and hand every existing caller a general
 * write capability it does not need. This module keeps the same
 * discipline one level narrower: its client is private to this file,
 * never returned, and the only thing the exported object can do is call
 * that single RPC.
 *
 * Also deliberately not `src/infrastructure/supabase/client.ts` -- that
 * is the protected regulatory adapter's general-purpose service-role
 * client, and product writes have no business there.
 *
 * Memoized the same way, and rebuilt when the environment resolves
 * differently on a later call rather than cached unconditionally
 * forever -- the same live-reproduced defect and identical fix as
 * `getSupabaseClient()` and `getSupabaseAdminClient()`.
 */
let cachedClient:
  SupabaseClient | undefined;

let cachedEnvKey:
  string | undefined;

function getPrivilegedClient(): SupabaseClient {
  const env =
    loadSupabaseEnv();

  const envKey =
    `${env.SUPABASE_URL} ${env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!cachedClient || cachedEnvKey !== envKey) {
    cachedClient =
      createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      );

    cachedEnvKey =
      envKey;
  }

  return cachedClient;
}

/**
 * The RPC returns `table(result_status text, result_calculation_id
 * uuid)`, which PostgREST delivers as a one-element array -- the same
 * shape `record_declaration_filed` and `accept_sharing_grant_invitation`
 * return and their callers unwrap.
 */
type RecordCalculationResultRow = {
  result_status: string;
  result_calculation_id: string | null;
};

const REJECTION_REASONS =
  [
    "LINE_NOT_FOUND",
    "SHIPMENT_NOT_EDITABLE",
    "ACTOR_NOT_A_MEMBER",
    "DETERMINATION_MISMATCH",
    "QUANTITY_MISMATCH",
    "LINE_HAS_NO_QUANTITY",
    "CAPABILITY_NOT_HELD",
  ] as const;

type RejectionReason =
  (typeof REJECTION_REASONS)[number];

function isRejectionReason(
  value: string,
): value is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(
    value,
  );
}

export function getCalculationResultWriter(): CalculationResultWriter {
  return {
    async recordCalculationResult(
      input: RecordCalculationResultInput,
    ): Promise<RecordCalculationResultOutcome> {
      const { data, error } =
        await getPrivilegedClient().rpc(
          "record_calculation_result",
          {
            p_org_id: input.org_id,
            p_line_id: input.line_id,
            p_calculated_by_user_id: input.calculated_by_user_id,
            p_engine_version: input.engine_version,
            p_parameter_datasets: input.parameter_datasets,
            p_quantity: input.quantity,
            p_quantity_unit: input.quantity_unit,
            p_determination: input.determination,
            p_steps: input.steps,
            p_embedded_emissions_tco2e: input.embedded_emissions_tco2e,
            p_correlation_id: input.correlation_id,
          },
        );

      if (error) {
        return {
          status: "FAILED",
          message: error.message,
        };
      }

      const row =
        (data as RecordCalculationResultRow[] | null)?.[0];

      if (!row) {
        return {
          status: "FAILED",
          message: "record_calculation_result returned no row",
        };
      }

      if (row.result_status === "OK") {
        if (!row.result_calculation_id) {
          // OK without an id would mean the function's own contract
          // broke. Never silently treat that as a successful write.
          return {
            status: "FAILED",
            message: "record_calculation_result returned OK with no id",
          };
        }

        return {
          status: "OK",
          calculation_id: row.result_calculation_id,
        };
      }

      if (isRejectionReason(row.result_status)) {
        return {
          status: "REJECTED",
          reason: row.result_status,
        };
      }

      // A result_status this build does not know about. Treated as a
      // failure rather than mapped to the nearest known reason: a
      // refusal the application cannot name is exactly the thing that
      // must not be quietly absorbed.
      return {
        status: "FAILED",
        message: `record_calculation_result returned an unrecognized status: ${row.result_status}`,
      };
    },
  };
}
