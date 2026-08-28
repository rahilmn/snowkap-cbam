import {
  cn,
} from "../../lib/utils";

/**
 * The official Snowkap wordmark (public/brand/snowkap-wordmark.svg,
 * fetched and verified against snowkap.com -- see
 * docs/plans/MASTER_PLAN.md §24's logo rule). The asset's paths are
 * `fill="white"`/`fill="#DF5900"` -- a dark-surface-only variant, no
 * light-surface (dark-colored) counterpart exists on the official site
 * -- so it is always rendered on its own fixed dark chip
 * (`--color-neutral-900`, which does not change with `data-theme`)
 * rather than directly on the surrounding page background, which may
 * be light. The SVG file itself is never recolored, redrawn, or
 * approximated; only the chip around it is this product's own choice.
 *
 * `className` behaves the same as it did on the previous text
 * placeholder: it sets the font-size (and any spacing/margin utility)
 * from the call site, and every dimension below is defined in `em` so
 * it scales with that inherited font-size. The " CBAM" label stays
 * next to the mark -- the wordmark asset itself only spells "Snowkap",
 * and this surface is specifically the CBAM product (master plan §24:
 * "CBAM is already a named platform capability -- this product must
 * read as a sibling of MEASURE/COMPUTE/REPORT").
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
        "inline-flex shrink-0 items-center gap-[0.4em] font-semibold tracking-tight",
        className,
      )}
    >
      <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] bg-[var(--color-neutral-900)] px-[0.5em] py-[0.3em]">
        {/* Intrinsic 214x34 (~6.29:1) preserved via height-only sizing
            + width:auto. `shrink-0` on this span and the root span above
            stops an ancestor flex container (e.g. the topbar's) from
            compressing the lockup below the image's natural width --
            without it, Tailwind's `img { max-width: 100% }` preflight
            rule caps the image's width to whatever a squeezed flex
            item leaves while height stays fixed, stretching the mark
            off its aspect ratio. Verified against the topbar at
            375px and 640px viewport widths. */}
        <img
          src="/brand/snowkap-wordmark.svg"
          alt="Snowkap"
          width={214}
          height={34}
          className="h-[1.3em] w-auto shrink-0"
        />
      </span>

      <span className="text-[var(--text-tertiary)]">CBAM</span>
    </span>
  );
}
