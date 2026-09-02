/**
 * Reads the email `supabase start` actually delivered, from the Mailpit
 * instance the CLI runs alongside the stack.
 *
 * No repository test has ever read a delivered email before. That is
 * precisely why an entire class of defect survived to production: every
 * assertion about auth email stopped at "the send was requested", and the
 * shape of the link a real recipient receives -- the thing that broke on
 * 2026-09-02, when a mail-security scanner consumed an invitation token
 * before the invitee clicked it -- was never checked anywhere.
 */

const MAILPIT_URL =
  process.env.SUPABASE_LOCAL_MAILPIT_URL ??
  "http://127.0.0.1:54324";

export interface CapturedEmail {
  id: string;
  subject: string;
  to: string[];
  text: string;
  html: string;
  createdAt: string;
}

interface MailpitSearchMessage {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
  Text: string;
  HTML: string;
}

async function getJson<T>(
  path: string,
): Promise<T> {
  const response =
    await fetch(
      `${MAILPIT_URL}${path}`,
      {
        signal:
          AbortSignal.timeout(
            5_000,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `Mailpit ${path} responded ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export async function isMailpitReachable(): Promise<boolean> {
  try {
    await getJson(
      "/api/v1/info",
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for the newest email delivered to one address.
 *
 * Filters by recipient rather than clearing the mailbox between tests:
 * Playwright runs three workers against one Mailpit, so a global delete
 * would make suites destroy each other's fixtures intermittently. Every
 * caller uses a run-unique address instead.
 */
export async function waitForEmailTo(
  address: string,
  options: {
    subjectIncludes?: string;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<CapturedEmail> {
  const timeoutMs =
    options.timeoutMs ?? 20_000;

  const pollMs =
    options.pollMs ?? 300;

  const deadline =
    Date.now() + timeoutMs;

  let lastError: unknown =
    null;

  while (Date.now() < deadline) {
    try {
      const search =
        await getJson<{ messages: MailpitSearchMessage[] }>(
          `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
        );

      const match =
        (search.messages ?? []).find(
          (message) =>
            !options.subjectIncludes ||
            message.Subject.includes(options.subjectIncludes),
        );

      if (match) {
        const full =
          await getJson<MailpitMessage>(
            `/api/v1/message/${match.ID}`,
          );

        return {
          id: full.ID,
          subject: full.Subject,
          to: (full.To ?? []).map((recipient) => recipient.Address),
          text: full.Text ?? "",
          html: full.HTML ?? "",
          createdAt: full.Created,
        };
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise(
      (resolve) => setTimeout(resolve, pollMs),
    );
  }

  throw new Error(
    `No email for ${address}${
      options.subjectIncludes ? ` with subject containing "${options.subjectIncludes}"` : ""
    } within ${timeoutMs}ms${lastError ? ` (last error: ${String(lastError)})` : ""}`,
  );
}

/**
 * Pulls the application link out of a delivered email.
 *
 * Reads the text part first and falls back to the HTML, decoding the
 * `&amp;` an HTML template necessarily produces. Deliberately asserts
 * nothing about the URL beyond its pathname -- the caller checks the
 * query, because the query is the thing under test.
 */
export function extractAppLink(
  email: CapturedEmail,
  pathname: "/auth/confirm" | "/auth/callback",
): URL {
  const haystack =
    `${email.text}\n${email.html}`.replace(
      /&amp;/g,
      "&",
    );

  const matches =
    haystack.match(
      /https?:\/\/[^\s"'<>)]+/g,
    ) ?? [];

  const found =
    matches
      .map((raw) => {
        try {
          return new URL(raw);
        } catch {
          return null;
        }
      })
      .find(
        (url): url is URL => url !== null && url.pathname === pathname,
      );

  if (!found) {
    throw new Error(
      `No ${pathname} link in email "${email.subject}". Links found: ${matches.join(", ")}`,
    );
  }

  return found;
}

/**
 * Rewrites a link's origin while keeping its path and query.
 *
 * supabase/config.toml's site_url is 127.0.0.1:3000 and Playwright drives
 * localhost:3000. Same server, but separate cookie jars in a browser, so
 * a link followed at the wrong host silently loses the session it just
 * established. The port is pinned by
 * tests/architecture/local-auth-fixture-invariants.test.ts; only the host
 * is rebased here.
 */
export function rebaseOrigin(
  link: URL,
  origin: string,
): URL {
  const rebased =
    new URL(
      origin,
    );

  rebased.pathname = link.pathname;
  rebased.search = link.search;
  rebased.hash = link.hash;

  return rebased;
}
