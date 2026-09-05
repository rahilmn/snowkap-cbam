import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  resolveDefaultValue,
} from "../../domain/regulatory/resolve-default-value";

import {
  describeDefaultReference,
  type DefaultReferenceDisplay,
} from "../../domain/emissions/default-reference";

import type {
  RegulatoryCountryMapper,
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  resolutionCountryName,
} from "./resolve-line-emissions";

import {
  resolveGoodSectorForActualLine,
} from "../calculations/calculate-line";

/**
 * S3 (importer experience), v2.1.1 "default reference display" (§9).
 *
 * READ-ONLY. Never writes anything, never gates on capability or rate
 * limit (a display helper, not a mutating action), and -- critically
 * -- never a second calculation: it runs the SAME protected resolver
 * (resolveDefaultValue) the real DEFAULT-path determination
 * (resolve-line-emissions.ts) already runs, over the SAME input shape
 * (resolutionCountryName, reused rather than re-derived), so a
 * REFERENCE value shown here can never disagree with what an actual
 * DEFAULT determination for this exact line would produce.
 *
 * Meant for a line whose determination is ACTUAL (not DEFAULT) --
 * showing "what the regulatory default would say" for the same
 * classification/origin/route as pure context, per v2.1.1's own "no
 * arithmetic comparator" instruction (describeDefaultReference does
 * not compare this against the actual figures; it only decides
 * whether the resolver's own values are internally consistent enough
 * to show).
 *
 * `orgId` is passed through to resolveGoodSectorForActualLine (not
 * consulted directly here): `line.shipmentId` arrives as a bare
 * parameter with no proof of ownership attached, so it is the callee's
 * job -- not this function's -- to re-derive that the shipment
 * actually belongs to orgId before its release_date is used, same
 * "re-authorized rather than believed" posture as calculateLine's own
 * org_id check (calculate-line.ts). Found missing in this function's
 * first cut: its only caller at the time (the shipment detail page)
 * happened to already pass an org-verified shipmentId, which masked
 * the gap -- see resolveGoodSectorForActualLine's own doc comment.
 */
export async function getDefaultReferenceForLine(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  mapper: RegulatoryCountryMapper,
  orgId: string,
  line: {
    shipmentId: string;
    cnCode: string;
    originCountry: string;
    productionRouteIndicator: string | null;
  },
): Promise<DefaultReferenceDisplay> {
  const countryMapping =
    await mapper.mapCountry(
      line.originCountry,
    );

  const input =
    {
      origin_country_name: resolutionCountryName(
        countryMapping,
        line.originCountry,
      ),
      trade_code: line.cnCode,
      production_route: line.productionRouteIndicator,
    };

  const candidates =
    await repository.findActiveDefaultEmissionCandidates(
      input,
    );

  const resolution =
    resolveDefaultValue(
      candidates,
      input,
    );

  if (!resolution.record) {
    return {
      status: "UNAVAILABLE",
    };
  }

  // The Annex-II proxy treatment rule is keyed on the LINE's own
  // classified good's sector -- the same lookup the calculation
  // engine's own Annex-II gate already performs for an ACTUAL
  // determination (calculate-line.ts), reused rather than
  // re-implemented. `null` (shipment/good not found -- an
  // unexpected-data-drift case per that function's own doc comment)
  // means the treatment rule cannot be evaluated at all, so the
  // reference is not shown rather than guessed at.
  const sector =
    await resolveGoodSectorForActualLine(
      supabase,
      repository,
      orgId,
      line.shipmentId,
      line.cnCode,
    );

  if (sector === null) {
    return {
      status: "UNAVAILABLE",
    };
  }

  return describeDefaultReference(
    resolution.record,
    sector,
  );
}
