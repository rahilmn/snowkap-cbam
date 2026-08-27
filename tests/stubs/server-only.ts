// Vitest runs infrastructure modules directly through Vite/esbuild, not
// through Next.js's webpack/Turbopack compiler -- the only place that
// special-cases the literal "server-only" package name to enforce the
// client/server boundary at build time. Outside that pipeline the real
// package unconditionally throws on import (see
// node_modules/server-only/index.js), which would break every test that
// imports a guarded infrastructure module, including the module-load
// safety tests infrastructure/supabase/client.ts exists to satisfy.
//
// This alias (see vitest.config.ts) swaps the real package for this
// no-op stub in the test environment only. It has no effect on the
// actual Next.js build, which still enforces the guard for real.
export {};
