import {
  cn,
} from "../../lib/utils";

/**
 * Neutral text placeholder for the Snowkap wordmark, per
 * docs/plans/MASTER_PLAN.md §24 ("if the authoritative asset cannot be
 * obtained reliably, request the asset from the owner rather than
 * inventing a substitute ... until then a neutral text placeholder
 * stands in"). This is deliberately plain typography, not a redrawn or
 * approximated logo mark -- swap this component's contents for the
 * real SVG wordmark (light + dark variants) once the owner supplies
 * it; every call site of <Wordmark /> stays unchanged.
 */
export function Wordmark(
  {
    className,
  }: {
    className?: string;
  },
) {
  return (
    <span
      className={cn(
        "font-semibold tracking-tight text-[var(--text-primary)]",
        className,
      )}
    >
      Snowkap
      <span className="text-[var(--text-tertiary)]"> CBAM</span>
    </span>
  );
}
