import "server-only";

import type {
  RegulatoryCountryMapper,
  RegulatoryRepository,
} from "./regulatory-repository";

import {
  SupabaseRegulatoryRepository,
} from "./supabase-regulatory-repository";

/**
 * The one sanctioned way UI code (Server Actions/Components) reaches
 * the regulatory adapter -- mirroring
 * src/infrastructure/supabase/admin-client.ts's narrow-factory
 * pattern. The layering rule's grandfathered exception
 * (tests/architecture/layering-rules.ts) only covers importing the
 * RegulatoryRepository *port* from regulatory-repository.ts as a
 * type; something still has to construct the concrete
 * SupabaseRegulatoryRepository, and until now nothing in real
 * (non-test) code ever did -- P4's classification validation is the
 * first product-code consumer. This file, not
 * supabase-regulatory-repository.ts itself, is what gets added to
 * UI_ALLOWED_INFRASTRUCTURE_IMPORTS, keeping that exception as narrow
 * as admin-client.ts's.
 */
export function getRegulatoryRepository(): RegulatoryRepository {
  return new SupabaseRegulatoryRepository();
}

/**
 * Same sanctioned-factory reasoning as getRegulatoryRepository above,
 * for the separate RegulatoryCountryMapper port (P5) --
 * SupabaseRegulatoryRepository implements both, but callers depend on
 * the narrower port type they actually need.
 */
export function getRegulatoryCountryMapper(): RegulatoryCountryMapper {
  return new SupabaseRegulatoryRepository();
}
