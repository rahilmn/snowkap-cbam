import {
  NextResponse,
} from "next/server";

import {
  resolveGitSha,
} from "../../../src/application/health/resolve-git-sha";

export const dynamic =
  "force-dynamic";

interface LivenessResult {
  status: "alive";
  git_sha: string;
}

/**
 * LIVENESS — "is this process running and able to serve a request?"
 *
 * Deliberately touches nothing external: no database, no Supabase client,
 * no regulatory dataset. If the Node process can execute this handler, it
 * is alive, and this returns 200. It can never return 503.
 *
 * This is the counterpart to /api/health, which is a READINESS check
 * ("can this instance actually do useful work?") and DOES return 503 when
 * the database is unreachable, the ACTIVE regulatory dataset is wrong, or
 * the product schema is absent.
 *
 * Why both exist (docs/plans/P13_RELEASE_READINESS_REPORT.md §16.11/§32):
 * a real deployment reported `/api/health` -> "ok" against a database with
 * zero product tables, because that route only checked reachability and
 * the dataset invariant. Adding a product-schema probe to /api/health
 * closes that gap, but it also makes /api/health legitimately fail for
 * reasons that are NOT the process's fault -- so conflating the two
 * signals in a single endpoint would mean either under-reporting real
 * outages or restart-looping a healthy container because its database is
 * briefly unreachable.
 *
 * Intended use:
 * - Platform healthcheck / traffic gating -> `/api/health` (readiness).
 *   Railway is configured this way: a not-ready instance should not
 *   receive traffic.
 * - Process supervision / "should I restart this container?" -> this
 *   route. Restarting a container because Supabase is down does not fix
 *   Supabase; it just removes a instance that would otherwise recover on
 *   its own the moment the dependency returns.
 */
export function GET(): NextResponse<LivenessResult> {
  return NextResponse.json(
    {
      status:
        "alive",

      git_sha:
        resolveGitSha(),
    },
    {
      status:
        200,
    },
  );
}
