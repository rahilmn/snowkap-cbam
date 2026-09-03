import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  SupabaseRegulatoryRepository,
} from "../../src/infrastructure/regulatory/supabase-regulatory-repository";

import {
  createShipment,
} from "../../src/application/shipments/create-shipment";

import {
  addLine,
} from "../../src/application/shipments/manage-lines";

import {
  determineLineEmissions,
} from "../../src/application/emissions/resolve-line-emissions";

import {
  getCalculationResultWriter,
} from "../../src/infrastructure/calculations/get-calculation-result-writer";

import {
  calculateLine,
} from "../../src/application/calculations/calculate-line";

import {
  reproduceCalculationResult,
} from "../../src/application/calculations/reproduce-calculation-result";

import type {
  OrgContext,
} from "../../src/application/organizations/org-context";

/**
 * The CI half of the reproduction-proof contract.
 *
 * The master plan's P8 contract is a PAIR: "reproduction proof (CI test
 * + on-demand admin check recomputing stored results from their
 * snapshots with the recorded engine_version, asserting byte-equality)".
 * Only the on-demand half existed. reproduce-calculation-result.ts's own
 * doc comment claimed "a CI-side reproduction test covers the other
 * half", and it did not -- the only coverage was a fully mocked unit
 * test, and tests/golden/foundation.test.ts was a seven-line stub
 * asserting true === true. This file is that missing half, and the
 * comment is now true.
 *
 * What makes it different from the unit test: nothing is mocked. A real
 * shipment line is classified against the real regulatory dataset in
 * local Postgres, determined through the real resolver, calculated
 * through the real engine, and persisted through the real RLS policy as
 * the real owner. Only then is it reproduced. A mocked reproduction can
 * only prove that the comparator compares; this proves that a value
 * this system actually stored can actually be recomputed from what it
 * stored beside it.
 */

const LOCAL_API_URL =
  process.env.SUPABASE_LOCAL_API_URL ?? "http://127.0.0.1:54321";

const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function isLocalSupabaseReachable(): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${LOCAL_API_URL}/rest/v1/`,
        {
          headers: { apikey: LOCAL_ANON_KEY },
          signal: AbortSignal.timeout(2000),
        },
      );

    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * The regulatory tables are deliberately NOT part of seed.sql -- they
 * are loaded by the offline Python pipeline. Without them this suite
 * would fail for a reason that has nothing to do with reproduction, so
 * it skips honestly instead. Same probe
 * regulatory-authenticated-read.test.ts uses.
 */
async function isLocalRegulatoryDataSeeded(): Promise<boolean> {
  try {
    const probeClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    const { data, error } =
      await probeClient
        .from("default_emission_values")
        .select("id")
        .limit(1);

    return !error && !!data && data.length > 0;
  } catch {
    return false;
  }
}

const localSupabaseReachable =
  await isLocalSupabaseReachable();

const localRegulatoryDataSeeded =
  localSupabaseReachable &&
  (await isLocalRegulatoryDataSeeded());

describe.skipIf(!localRegulatoryDataSeeded)(
  "calculation reproduction against real Postgres and the real regulatory dataset",
  () => {
    const runId =
      crypto.randomUUID().slice(0, 8);

    const password =
      `reproduction-password-${runId}!`;

    const ownerEmail =
      `reproduction-owner-${runId}@example.com`;

    const strangerEmail =
      `reproduction-stranger-${runId}@example.com`;

    const serviceClient: SupabaseClient =
      createClient(
        LOCAL_API_URL,
        LOCAL_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

    const repository =
      new SupabaseRegulatoryRepository();

    const createdOrgIds: string[] =
      [];

    const createdUserIds: string[] =
      [];

    let ownerClient: SupabaseClient;
    let ownerContext: OrgContext;
    let strangerContext: OrgContext;

    let calculationResultId: string;
    let lineId: string;

    // The repository reads its connection from the environment
    // (src/infrastructure/supabase/client.ts re-keys on it), and the
    // whole point of this suite is that it reads the LOCAL dataset.
    // Captured and restored so the rest of the run is unaffected.
    const previousUrl =
      process.env.SUPABASE_URL;

    const previousServiceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    async function createUser(
      email: string,
    ): Promise<string> {
      const { data, error } =
        await serviceClient.auth.admin.createUser(
          {
            email,
            password,
            email_confirm: true,
          },
        );

      if (error || !data.user) {
        throw new Error(
          `Failed to create ${email}: ${error?.message}`,
        );
      }

      createdUserIds.push(data.user.id);

      return data.user.id;
    }

    async function createOrgWithOwner(
      label: string,
      userId: string,
    ): Promise<string> {
      const { data, error } =
        await serviceClient
          .from("organizations")
          .insert(
            {
              name: `Reproduction ${label} ${runId}`,
              slug: `reproduction-${label}-${runId}`,
              capabilities: ["IMPORTER_DECLARANT"],
            },
          )
          .select("id")
          .single();

      if (error || !data) {
        throw new Error(
          `Failed to create org ${label}: ${error?.message}`,
        );
      }

      createdOrgIds.push(data.id);

      const { error: membershipError } =
        await serviceClient
          .from("memberships")
          .insert(
            {
              org_id: data.id,
              user_id: userId,
              role: "OWNER",
            },
          );

      if (membershipError) {
        throw new Error(
          `Failed to add owner to ${label}: ${membershipError.message}`,
        );
      }

      return data.id;
    }

    async function signIn(
      email: string,
    ): Promise<SupabaseClient> {
      const client =
        createClient(
          LOCAL_API_URL,
          LOCAL_ANON_KEY,
          { auth: { persistSession: false } },
        );

      const { error } =
        await client.auth.signInWithPassword(
          { email, password },
        );

      if (error) {
        throw new Error(
          `Failed to sign in ${email}: ${error.message}`,
        );
      }

      return client;
    }

    beforeAll(async () => {
      process.env.SUPABASE_URL = LOCAL_API_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;

      const ownerUserId =
        await createUser(ownerEmail);

      const strangerUserId =
        await createUser(strangerEmail);

      const ownerOrgId =
        await createOrgWithOwner("owner", ownerUserId);

      const strangerOrgId =
        await createOrgWithOwner("stranger", strangerUserId);

      ownerClient =
        await signIn(ownerEmail);

      ownerContext =
        {
          org_id: ownerOrgId as never,
          user_id: ownerUserId as never,
          role: "OWNER",
          capabilities: ["IMPORTER_DECLARANT"],
        };

      strangerContext =
        {
          org_id: strangerOrgId as never,
          user_id: strangerUserId as never,
          role: "OWNER",
          capabilities: ["IMPORTER_DECLARANT"],
        };

      // --- A real shipment, a real line, a real resolution, a real
      // calculation. Nothing here is fabricated or inserted directly:
      // every write goes through the application service and lands
      // under the owner's own RLS.
      const shipmentResult =
        await createShipment(
          ownerClient,
          ownerContext,
          {
            reference: `REPRO-${runId}`,
            releaseDate: "2026-08-29",
            customsMrn: `MRN-${runId}`,
            customsProcedure: "RELEASE_FOR_FREE_CIRCULATION",
          },
        );

      if (shipmentResult.status !== "OK") {
        throw new Error(
          `Failed to create shipment: ${JSON.stringify(shipmentResult)}`,
        );
      }

      // China, CN8 2523 21 00 (white Portland cement) -- a row this
      // dataset genuinely holds, and the same one production's
      // IMP-TEST-001 resolved through.
      const lineResult =
        await addLine(
          ownerClient,
          repository,
          ownerContext,
          shipmentResult.shipment.id,
          {
            cnCode: "25232100",
            goodsDescription: "White Portland cement",
            originCountry: "CN",
            quantity: { kind: "MASS", value: "2" },
            productionRouteName: null,
          },
        );

      if (lineResult.status !== "OK") {
        throw new Error(
          `Failed to add line: ${JSON.stringify(lineResult)}`,
        );
      }

      lineId = lineResult.line.id;

      const determinationResult =
        await determineLineEmissions(
          ownerClient,
          repository,
          repository,
          ownerContext,
          lineResult.line.id,
        );

      if (determinationResult.status !== "DETERMINED") {
        throw new Error(
          `Failed to determine line: ${JSON.stringify(determinationResult)}`,
        );
      }

      const calculationResult =
        await calculateLine(
          ownerClient,
          repository,
          // The real writer, not a stub. calculation_results is no
          // longer insertable by `authenticated` (20260903190000), so
          // exercising the genuine privileged channel is the only way
          // this test still proves the whole path -- and it means a
          // regression in the RPC's own bindings fails here too.
          getCalculationResultWriter(),
          ownerContext,
          lineResult.line.id,
        );

      if (calculationResult.status !== "OK") {
        throw new Error(
          `Failed to calculate line: ${JSON.stringify(calculationResult)}`,
        );
      }

      if (calculationResult.calculation.status !== "COMPUTED") {
        throw new Error(
          `Line did not compute: ${JSON.stringify(calculationResult.calculation)}`,
        );
      }

      // calculateLine returns the pure engine's result, not the row it
      // persisted, so the row is read back by its line -- there is
      // exactly one, this line having been calculated exactly once.
      const { data: persisted, error: persistedError } =
        await ownerClient
          .from("calculation_results")
          .select("id")
          .eq("line_id", lineResult.line.id)
          .single();

      if (persistedError || !persisted) {
        throw new Error(
          `No calculation_results row was persisted: ${persistedError?.message}`,
        );
      }

      calculationResultId =
        (persisted as { id: string }).id;
    });

    afterAll(async () => {
      for (const orgId of createdOrgIds) {
        await serviceClient
          .from("audit_events")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("calculation_results")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("shipment_lines")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("shipments")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("memberships")
          .delete()
          .eq("org_id", orgId);

        await serviceClient
          .from("organizations")
          .delete()
          .eq("id", orgId);
      }

      for (const userId of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(userId);
      }

      if (previousUrl === undefined) {
        delete process.env.SUPABASE_URL;
      } else {
        process.env.SUPABASE_URL = previousUrl;
      }

      if (previousServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
      }
    });

    it(
      "reproduces a genuinely persisted calculation byte-for-byte",
      async () => {
        const outcome =
          await reproduceCalculationResult(
            ownerClient,
            repository,
            ownerContext.org_id,
            calculationResultId as never,
          );

        expect(outcome).toEqual(
          { status: "REPRODUCIBLE" },
        );
      },
    );

    it(
      "stored the value hand-arithmetic says it should have, as a byte-exact string",
      async () => {
        // 2 t x 1.390 tCO2e/t = 2.780, and toFixed() with no argument
        // drops the trailing zero. Derived by hand from the dataset row
        // (sheet "China", row 7), not read back from the engine -- the
        // same discipline the golden fixtures use, applied here to a
        // value that actually made the round trip through Postgres.
        const { data } =
          await ownerClient
            .from("calculation_results")
            .select("embedded_emissions_tco2e, engine_version")
            .eq("id", calculationResultId)
            .single();

        expect(
          (data as { embedded_emissions_tco2e: string })
            .embedded_emissions_tco2e,
        ).toBe(
          "2.78",
        );

        expect(
          (data as { engine_version: string }).engine_version,
        ).toBe(
          "1.3.0",
        );
      },
    );

    it(
      "cannot be quietly rewritten: there is no UPDATE policy on calculation_results",
      async () => {
        // Reproduction only means anything if the stored row is
        // immutable.
        //
        // 2026-09-03 (P14.1). This assertion got STRONGER, not weaker.
        // Append-only used to rest on the absence of an UPDATE policy,
        // so an owner's edit silently affected zero rows while
        // `authenticated` still held the table-level UPDATE grant --
        // one permissive policy away from being mutable. 20260903190000
        // revoked UPDATE and DELETE outright, so the attempt is now
        // refused at the privilege level and never reaches RLS at all.
        const { data, error } =
          await ownerClient
            .from("calculation_results")
            .update(
              { embedded_emissions_tco2e: "999" },
            )
            .eq("id", calculationResultId)
            .select("id");

        expect(error).not.toBeNull();

        expect(error?.message).toContain(
          "permission denied",
        );

        expect(data).toBeNull();

        // And the value is genuinely untouched.
        const { data: unchanged } =
          await serviceClient
            .from("calculation_results")
            .select("embedded_emissions_tco2e")
            .eq("id", calculationResultId)
            .single();

        expect(
          (unchanged as { embedded_emissions_tco2e: string })
            .embedded_emissions_tco2e,
        ).toBe(
          "2.78",
        );
      },
    );

    it(
      "detects a tampered stored value as MISMATCH",
      async () => {
        // Written to a THROWAWAY row, never to the row the other tests
        // depend on, and via the service role because no UPDATE policy
        // exists at all (the test above proves that). The forged value
        // is chosen to satisfy calculation_results_numeric_format_ck --
        // the CHECK pins the FORM of a decimal string, never its
        // magnitude, which is exactly the gap this test demonstrates the
        // reproduction check closing.
        const { data: source } =
          await serviceClient
            .from("calculation_results")
            .select("*")
            .eq("id", calculationResultId)
            .single();

        const row =
          source as Record<string, unknown>;

        const { data: forged, error: forgeError } =
          await serviceClient
            .from("calculation_results")
            .insert(
              {
                ...row,
                id: undefined,
                embedded_emissions_tco2e: "0.01",
              },
            )
            .select("id")
            .single();

        expect(forgeError).toBeNull();

        const outcome =
          await reproduceCalculationResult(
            ownerClient,
            repository,
            ownerContext.org_id,
            (forged as { id: string }).id as never,
          );

        expect(outcome.status).toBe(
          "MISMATCH",
        );

        await serviceClient
          .from("calculation_results")
          .delete()
          .eq("id", (forged as { id: string }).id);
      },
    );

    it(
      "refuses to silently reproduce a row a different engine version produced",
      async () => {
        // A calculation computed by an older engine must not be
        // reported as reproducible by a newer one -- byte-equality
        // against a different implementation is meaningless even when
        // it happens to hold.
        const { data: source } =
          await serviceClient
            .from("calculation_results")
            .select("*")
            .eq("id", calculationResultId)
            .single();

        const row =
          source as Record<string, unknown>;

        const { data: older } =
          await serviceClient
            .from("calculation_results")
            .insert(
              {
                ...row,
                id: undefined,
                engine_version: "1.1.0",
              },
            )
            .select("id")
            .single();

        const outcome =
          await reproduceCalculationResult(
            ownerClient,
            repository,
            ownerContext.org_id,
            (older as { id: string }).id as never,
          );

        expect(outcome.status).toBe(
          "ENGINE_VERSION_CHANGED",
        );

        await serviceClient
          .from("calculation_results")
          .delete()
          .eq("id", (older as { id: string }).id);
      },
    );

    it(
      "does not tell another organization whether the row exists",
      async () => {
        // NOT_FOUND, not FORBIDDEN: the same not-found-not-forbidden
        // posture the rest of this codebase uses, so a caller cannot
        // sweep for valid ids by reading the difference.
        const outcome =
          await reproduceCalculationResult(
            ownerClient,
            repository,
            strangerContext.org_id,
            calculationResultId as never,
          );

        expect(outcome).toEqual(
          { status: "NOT_FOUND" },
        );
      },
    );

    it(
      "recomputes from the FROZEN determination, not from whatever the line says now",
      async () => {
        // What reproduction actually means here, stated as a test: the
        // stored row carries its own inputs, and the recompute uses
        // those. Editing the line afterwards must not change whether a
        // past calculation reproduces -- otherwise "reproducible" would
        // be a statement about the present, which is the opposite of
        // what an audit trail is for.
        //
        // (The one input NOT frozen on the row is good_sector, which is
        // re-derived from the line's current cn_code and consulted only
        // for an ACTUAL determination's Annex II gate. That is the
        // INPUTS_DRIFTED path, and it is unreachable for the DEFAULT
        // determination this suite builds -- covered by the unit test
        // rather than claimed here.)
        const { error: driftError } =
          await serviceClient
            .from("shipment_lines")
            .update(
              { goods_description: "Edited after the fact" },
            )
            .eq("id", lineId);

        expect(driftError).toBeNull();

        const outcome =
          await reproduceCalculationResult(
            ownerClient,
            repository,
            ownerContext.org_id,
            calculationResultId as never,
          );

        expect(outcome).toEqual(
          { status: "REPRODUCIBLE" },
        );
      },
    );

    describe(
      "P14.1 -- the calculation-result write boundary",
      () => {
        /**
         * The invariant these tests exist to hold:
         *
         *   A user cannot create or cause a persisted calculation result
         *   containing an emissions value that was not produced from the
         *   authoritative frozen inputs by the trusted calculation path.
         *
         * It was FALSE until 2026-09-03. `calculation_results` carried an
         * INSERT policy for `authenticated` that pinned the org, the
         * acting user and the line/shipment linkage -- all scope, no
         * numbers -- so a member posting raw PostgREST could write this
         * line's real determination and real quantity beside a
         * fabricated `embedded_emissions_tco2e`, and
         * `record_declaration_filed` froze it verbatim into an immutable
         * snapshot. Reproduced live at 0.001 against a true 139.
         *
         * The database cannot fix that by recomputing: the engine is
         * TypeScript, and a plpgsql copy of RULE-EE-001/EE-009, the
         * Annex II direct-only rule and decimal.js semantics would be a
         * second, silently diverging implementation of regulatory
         * behaviour. So `20260903190000` made the number UNFORGEABLE
         * instead of verified -- INSERT/UPDATE/DELETE revoked from
         * `anon` and `authenticated`, and one SECURITY DEFINER RPC
         * granted to `service_role` alone.
         *
         * Every test below drives real PostgREST against real local
         * Postgres. None of them mocks the boundary they are about.
         */
        let shipmentId: string;

        beforeAll(async () => {
          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("shipment_id")
              .eq("id", lineId)
              .single();

          shipmentId =
            (data as { shipment_id: string }).shipment_id;
        });

        async function currentDetermination(): Promise<unknown> {
          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("emission_determination")
              .eq("id", lineId)
              .single();

          return (data as { emission_determination: unknown })
            .emission_determination;
        }

        async function currentQuantity(): Promise<string> {
          const { data } =
            await serviceClient
              .from("shipment_lines")
              .select("net_mass_tonnes")
              .eq("id", lineId)
              .single();

          return (data as { net_mass_tonnes: string }).net_mass_tonnes;
        }

        it(
          "(1) refuses a member INSERT carrying a forged emissions value beside the line's OWN correct quantity -- the exact reported exploit",
          async () => {
            const { error } =
              await ownerClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: ownerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "1.3.0",
                    quantity: await currentQuantity(),
                    quantity_unit: "TONNES",
                    determination: await currentDetermination(),
                    steps: [],
                    // The forgery. Everything around it is honest, which
                    // is precisely what defeated every earlier wall.
                    embedded_emissions_tco2e: "0.001",
                    calculated_by_user_id: ownerContext.user_id,
                  },
                );

            expect(error).not.toBeNull();

            expect(error?.message).toContain(
              "permission denied",
            );
          },
        );

        it(
          "(2) refuses a member INSERT carrying a forged emissions value AND a forged quantity",
          async () => {
            const { error } =
              await ownerClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: ownerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "1.3.0",
                    quantity: "1",
                    quantity_unit: "TONNES",
                    determination: await currentDetermination(),
                    steps: [],
                    embedded_emissions_tco2e: "0.5",
                    calculated_by_user_id: ownerContext.user_id,
                  },
                );

            expect(error).not.toBeNull();

            expect(error?.message).toContain(
              "permission denied",
            );
          },
        );

        it(
          "(3) refuses a member INSERT whose determination and steps are fabricated wholesale",
          async () => {
            // The trail a forged row leaves used to be forged too:
            // `steps` is what the "Why this number?" panel renders as the
            // derivation, and it was entirely client-supplied.
            const { error } =
              await ownerClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: ownerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "99.99.99",
                    quantity: "10",
                    quantity_unit: "TONNES",
                    determination: { method: "DEFAULT", invented: true },
                    steps: [
                      { step: "NOT_A_REAL_STEP", value: "0.001" },
                    ],
                    embedded_emissions_tco2e: "0.001",
                    calculated_by_user_id: ownerContext.user_id,
                  },
                );

            expect(error).not.toBeNull();

            expect(error?.message).toContain(
              "permission denied",
            );
          },
        );

        it(
          "(4) grants no INSERT, UPDATE or DELETE on calculation_results to anon or authenticated at all",
          async () => {
            // The property behind tests 1-3, asserted directly rather
            // than inferred from three refusals: no privilege, so no
            // policy can accidentally re-open the surface later.
            const { data } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "1",
                  p_correlation_id: null,
                });

            // The trusted channel works for service_role...
            expect(
              (data as { result_status: string }[] | null)?.[0]?.result_status,
            ).toBe(
              "OK",
            );

            // ...and is not reachable by the member at all.
            const { error: rpcError } =
              await ownerClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "0.001",
                  p_correlation_id: null,
                });

            expect(rpcError).not.toBeNull();

            expect(rpcError?.message.toLowerCase()).toContain(
              "permission denied",
            );
          },
        );

        it(
          "(5) refuses a cross-org forged result -- a stranger cannot write against another org's line",
          async () => {
            const strangerClient =
              await signIn(strangerEmail);

            const { error } =
              await strangerClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: strangerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "1.3.0",
                    quantity: "10",
                    quantity_unit: "TONNES",
                    determination: await currentDetermination(),
                    steps: [],
                    embedded_emissions_tco2e: "0.001",
                    calculated_by_user_id: strangerContext.user_id,
                  },
                );

            expect(error).not.toBeNull();

            // And the trusted channel refuses it too, on the org
            // binding rather than on privilege -- so the cross-org wall
            // does not depend on the privilege wall alone.
            const { data } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: strangerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: strangerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: "10",
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "0.001",
                  p_correlation_id: null,
                });

            expect(
              (data as { result_status: string }[] | null)?.[0]?.result_status,
            ).toBe(
              "LINE_NOT_FOUND",
            );
          },
        );

        it(
          "(6) the trusted channel refuses a result recorded against inputs the line does not carry",
          async () => {
            // The filing-gate half of this pair lives in
            // declarations-isolation.test.ts, which plants a bad row with
            // the service role and asserts record_declaration_filed
            // returns INCOMPLETE. This is the half that stops such a row
            // being created through the product's own channel in the
            // first place.
            const { data: forgedDetermination } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: { method: "DEFAULT", invented: true },
                  p_steps: [],
                  p_embedded_emissions_tco2e: "0.001",
                  p_correlation_id: null,
                });

            expect(
              (forgedDetermination as { result_status: string }[] | null)?.[0]
                ?.result_status,
            ).toBe(
              "DETERMINATION_MISMATCH",
            );

            const { data: forgedQuantity } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: "1",
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "0.5",
                  p_correlation_id: null,
                });

            expect(
              (forgedQuantity as { result_status: string }[] | null)?.[0]
                ?.result_status,
            ).toBe(
              "QUANTITY_MISMATCH",
            );

            const { data: strangerActor } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: strangerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "1",
                  p_correlation_id: null,
                });

            expect(
              (strangerActor as { result_status: string }[] | null)?.[0]
                ?.result_status,
            ).toBe(
              "ACTOR_NOT_A_MEMBER",
            );
          },
        );

        it(
          "(7) accepts a legitimate calculation result, and derives shipment_id and calculated_at itself",
          async () => {
            const before =
              new Date().toISOString();

            const { data } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [{ step: "LINE_EMBEDDED_EMISSIONS" }],
                  p_embedded_emissions_tco2e: "2.78",
                  p_correlation_id: null,
                });

            const row =
              (data as {
                result_status: string;
                result_calculation_id: string;
              }[] | null)?.[0];

            expect(row?.result_status).toBe(
              "OK",
            );

            const { data: written } =
              await serviceClient
                .from("calculation_results")
                .select("shipment_id, calculated_at, embedded_emissions_tco2e")
                .eq("id", row?.result_calculation_id as string)
                .single();

            const stored =
              written as {
                shipment_id: string;
                calculated_at: string;
                embedded_emissions_tco2e: string;
              };

            // Derived, not accepted: the caller never sent a shipment_id.
            expect(stored.shipment_id).toBe(
              shipmentId,
            );

            // Set by the function from clock_timestamp(), so the field
            // that says WHEN a calculation happened cannot be dictated.
            expect(
              stored.calculated_at >= before,
            ).toBe(
              true,
            );

            expect(stored.embedded_emissions_tco2e).toBe(
              "2.78",
            );
          },
        );

        it(
          "(8) a recalculation APPENDS -- the previous result is never overwritten",
          async () => {
            const { count: before } =
              await serviceClient
                .from("calculation_results")
                .select("id", { count: "exact", head: true })
                .eq("line_id", lineId);

            const { data } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: [],
                  p_embedded_emissions_tco2e: "2.78",
                  p_correlation_id: null,
                });

            expect(
              (data as { result_status: string }[] | null)?.[0]?.result_status,
            ).toBe(
              "OK",
            );

            const { count: after } =
              await serviceClient
                .from("calculation_results")
                .select("id", { count: "exact", head: true })
                .eq("line_id", lineId);

            expect(after).toBe(
              (before ?? 0) + 1,
            );

            // The original row is still there, untouched.
            const { data: original } =
              await serviceClient
                .from("calculation_results")
                .select("embedded_emissions_tco2e")
                .eq("id", calculationResultId)
                .single();

            expect(
              (original as { embedded_emissions_tco2e: string })
                .embedded_emissions_tco2e,
            ).toBe(
              "2.78",
            );
          },
        );

        it(
          "(9) a result written through the trusted channel is byte-reproducible",
          async () => {
            // The engine's own ordered trace, taken from the row this
            // suite already proved REPRODUCIBLE. Reproduction compares
            // steps index-wise as well as comparing the number, so
            // passing an empty array here would report MISMATCH on the
            // trace while the figure itself matched -- which is the
            // check working, not a defect.
            const { data: reference } =
              await serviceClient
                .from("calculation_results")
                .select("steps")
                .eq("id", calculationResultId)
                .single();

            const { data } =
              await serviceClient
                .rpc("record_calculation_result", {
                  p_org_id: ownerContext.org_id,
                  p_line_id: lineId,
                  p_calculated_by_user_id: ownerContext.user_id,
                  p_engine_version: "1.3.0",
                  p_parameter_datasets: [],
                  p_quantity: await currentQuantity(),
                  p_quantity_unit: "TONNES",
                  p_determination: await currentDetermination(),
                  p_steps: (reference as { steps: unknown }).steps,
                  p_embedded_emissions_tco2e: "2.78",
                  p_correlation_id: null,
                });

            const writtenId =
              (data as { result_calculation_id: string }[] | null)?.[0]
                ?.result_calculation_id as string;

            const outcome =
              await reproduceCalculationResult(
                ownerClient,
                repository,
                ownerContext.org_id,
                writtenId as never,
              );

            expect(outcome).toEqual(
              { status: "REPRODUCIBLE" },
            );
          },
        );

        it(
          "(10) rejects a negative emissions figure -- a value that would SUBTRACT from a declaration total",
          async () => {
            // Found alongside the forgery blocker: the numeric format
            // CHECK reused the DecimalString regex, whose optional
            // leading '-' is correct for a general decimal and wrong for
            // an emissions figure. A member-planted '-500000' filed
            // successfully. 20260903180000 removed that branch.
            const { error } =
              await serviceClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: ownerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "1.3.0",
                    quantity: "10",
                    quantity_unit: "TONNES",
                    determination: await currentDetermination(),
                    steps: [],
                    embedded_emissions_tco2e: "-500000",
                    calculated_by_user_id: ownerContext.user_id,
                  },
                );

            expect(error).not.toBeNull();

            expect(error?.message).toContain(
              "calculation_results_numeric_format_ck",
            );

            // Zero stays legal: a genuinely zero-emissions line is a
            // real regulatory outcome, and a `> 0` guard would have
            // refused it.
            const { error: zeroError } =
              await serviceClient
                .from("calculation_results")
                .insert(
                  {
                    org_id: ownerContext.org_id,
                    line_id: lineId,
                    shipment_id: shipmentId,
                    engine_version: "1.3.0",
                    quantity: "10",
                    quantity_unit: "TONNES",
                    determination: await currentDetermination(),
                    steps: [],
                    embedded_emissions_tco2e: "0",
                    calculated_by_user_id: ownerContext.user_id,
                  },
                );

            expect(zeroError).toBeNull();
          },
        );
      },
    );
  },
);
