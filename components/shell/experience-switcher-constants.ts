// See app/(auth)/action-state.ts for why constants shared with a
// "use server" file live in a separate, non-directive file.
//
// Scope is deliberately narrow: this constant is referenced from
// components/shell/** and app/page.tsx only -- enforced by
// tests/architecture/experience-cookie-scope.test.ts. It is a
// PRESENTATION preference (which nav set/dashboard section order to
// show for a dual-capability org), never an authorization input --
// see get-preferred-experience.ts's own doc comment for why a forged
// value is harmless.
export const ACTIVE_EXPERIENCE_COOKIE = "snowkap-active-experience";
