import Link from "next/link";

import {
  buttonVariants,
} from "../../components/ui/button";

import {
  cn,
} from "../../lib/utils";

import type {
  AuthLinkErrorCopy,
} from "./auth-link-errors";

/**
 * Hook-free on purpose: rendered both from the client component that owns
 * /auth/confirm's form state and from server components, so it must not
 * carry any hook of its own.
 */
export function AuthLinkErrorPanel(
  {
    copy,
    signedInEmail,
    continueHref,
  }: {
    copy: AuthLinkErrorCopy;

    /**
     * Set when the browser already holds a session despite the link
     * failing. Naming the identity is the point: silently continuing as
     * whoever happens to be signed in is how a user ends up entering data
     * into the wrong organization.
     */
    signedInEmail?: string | null;
    continueHref?: string;
  },
) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">
        {copy.title}
      </h1>

      <p className="text-sm text-[var(--text-secondary)]">
        {copy.body}
      </p>

      {signedInEmail && continueHref ? (
        <p className="text-sm text-[var(--text-secondary)]">
          You are already signed in as{" "}
          <span className="font-medium text-[var(--text-primary)]">
            {signedInEmail}
          </span>
          .
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap gap-2">
        {signedInEmail && continueHref ? (
          <Link
            href={continueHref}
            className={cn(
              buttonVariants({ variant: "primary", size: "sm" }),
            )}
          >
            Continue as {signedInEmail}
          </Link>
        ) : null}

        {copy.ctas.map(
          (cta) => (
            <Link
              key={cta.href}
              href={cta.href}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
              )}
            >
              {cta.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
