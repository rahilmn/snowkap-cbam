import type {
  HTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

export function Card(
  {
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>,
) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border-default)] " +
          "bg-[var(--surface-raised)] shadow-[var(--shadow-raised)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader(
  {
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>,
) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-[var(--border-default)] p-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle(
  {
    className,
    ...props
  }: HTMLAttributes<HTMLHeadingElement>,
) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription(
  {
    className,
    ...props
  }: HTMLAttributes<HTMLParagraphElement>,
) {
  return (
    <p
      className={cn(
        "text-sm text-[var(--text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent(
  {
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>,
) {
  return (
    <div
      className={cn(
        "p-4",
        className,
      )}
      {...props}
    />
  );
}
