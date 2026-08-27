import {
  ChevronRight,
} from "lucide-react";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export function Breadcrumbs(
  {
    items,
  }: {
    items: Breadcrumb[];
  },
) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]"
    >
      {items.map(
        (item, index) => {
          const isLast =
            index ===
            items.length - 1;

          return (
            <span
              key={item.label}
              className="flex items-center gap-1.5"
            >
              {index > 0 ? (
                <ChevronRight
                  className="size-3.5 text-[var(--text-tertiary)]"
                  aria-hidden="true"
                />
              ) : null}

              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="hover:text-[var(--text-primary)]"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  className={
                    isLast
                      ? "font-medium text-[var(--text-primary)]"
                      : undefined
                  }
                  aria-current={
                    isLast
                      ? "page"
                      : undefined
                  }
                >
                  {item.label}
                </span>
              )}
            </span>
          );
        },
      )}
    </nav>
  );
}
