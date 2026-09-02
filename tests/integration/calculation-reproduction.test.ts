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
        // immutable. An owner attempting to edit their own row must
        // affect zero rows -- append-only is enforced by the absence of
        // an UPDATE policy, not by convention.
        const { data, error } =
          await ownerClient
            .from("calculation_results")
            .update(
              { embedded_emissions_tco2e: "999" },
            )
            .eq("id", calculationResultId)
            .select("id");

        expect(error).toBeNull();

        expect(data).toEqual(
          [],
        );

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
  },
);
