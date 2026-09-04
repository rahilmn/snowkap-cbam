/**
 * The default route-level loading skeleton (Next.js App Router
 * convention -- automatically wraps every page under app/ in a
 * &lt;Suspense fallback={&lt;Loading /&gt;}&gt;). Deliberately minimal: a plain
 * text status, not a layout-shaped skeleton per route -- this fires
 * for every navigation regardless of which screen is loading, so
 * anything more specific would be wrong for most of them. A screen
 * that wants a closer-fitting skeleton can still define its own
 * loading.tsx alongside its page.tsx (SME plan §7.5).
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-dvh items-center justify-center bg-[var(--surface-page)] text-sm text-[var(--text-secondary)]"
    >
      Loading…
    </div>
  );
}
