import { cookies } from "next/headers";

import { ACTIVE_EXPERIENCE_COOKIE } from "./experience-switcher-constants";

import type {
  Experience,
} from "./sidebar";

/**
 * The caller's active-experience preference, if any and if it is one
 * of the two real values -- an unrecognized/forged cookie value is
 * treated exactly like no cookie at all (undefined), never trusted as
 * one of the two Experience literals. Read by AppShell/app/page.tsx
 * only (tests/architecture/experience-cookie-scope.test.ts).
 *
 * Presentation-only, same posture as get-preferred-org-id.ts's own
 * doc comment: this can only ever select which of the org's OWN,
 * already-authorized capability layouts to show first --
 * resolveExperience (app-shell.tsx) applies it only when the org
 * actually holds BOTH capabilities, and every route's own capability
 * gate (app/(importer)/layout.tsx, app/(producer)/layout.tsx) and
 * every service's hasCapability check are completely unaffected by
 * this cookie's value.
 */
export async function getPreferredExperience(): Promise<Experience | undefined> {
  const cookieStore =
    await cookies();

  const value =
    cookieStore.get(
      ACTIVE_EXPERIENCE_COOKIE,
    )?.value;

  return value === "importer" || value === "producer"
    ? value
    : undefined;
}
