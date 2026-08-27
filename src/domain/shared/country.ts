import type {
  Brand,
} from "./ids.js";

/**
 * An ISO 3166-1 alpha-2 country code, product-side. This is the identity
 * product data (organizations, shipment lines, installations, operators)
 * stores — distinct from the regulatory subsystem's origin_country_name,
 * which is a dataset-specific display name. Mapping between the two is
 * an infrastructure-layer concern (RegulatoryCountryMapper), not a
 * domain one; this module only validates the product-side shape.
 */
export type CountryCode =
  Brand<string, "CountryCode">;

export type ParseCountryCodeResult =
  | { status: "OK"; value: CountryCode }
  | { status: "INVALID" };

const ISO_3166_1_ALPHA_2_PATTERN =
  /^[A-Z]{2}$/;

export function parseCountryCode(
  raw: string,
): ParseCountryCodeResult {
  if (!ISO_3166_1_ALPHA_2_PATTERN.test(raw)) {
    return {
      status: "INVALID",
    };
  }

  return {
    status: "OK",
    value: raw as CountryCode,
  };
}
