/**
 * Visually hidden until focused (keyboard Tab from page load), then
 * jumps straight to <main id="main"> -- lets a keyboard/screen-reader
 * user skip the topbar/sidebar on every page load instead of tabbing
 * through the whole nav first. Native anchor + native focus styles
 * before ARIA, matching this design system's own stated preference
 * (SME plan §7.5).
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--text-primary)] focus:shadow-lg focus:outline-2 focus:outline-[var(--accent-interactive)] focus:outline-offset-2"
    >
      Skip to content
    </a>
  );
}
