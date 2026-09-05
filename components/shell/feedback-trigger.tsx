"use client";

import {
  MessageSquare,
} from "lucide-react";

import Link from "next/link";

import {
  usePathname,
} from "next/navigation";

/**
 * SME Experience v2.1.1, S2. Captures the CURRENT pathname at render
 * time (client-side -- app/feedback/page.tsx is a Server Component
 * with no other way to know which screen a topbar click originated
 * from) and carries it as ?from=, so product_feedback.page records the
 * screen the submitter was actually looking at, not merely wherever
 * the form itself happens to live.
 */
export function FeedbackTrigger() {
  const pathname =
    usePathname();

  return (
    <Link
      href={`/feedback?from=${encodeURIComponent(pathname)}`}
      aria-label="Send feedback"
      title="Send feedback"
      className="flex size-11 md:size-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--color-brand-100)] hover:text-[var(--color-brand-800)] focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <MessageSquare
        className="size-4"
        aria-hidden="true"
      />
    </Link>
  );
}
