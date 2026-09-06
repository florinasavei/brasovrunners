import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedJobRequest } from "@/modules/jobs/auth";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";

/**
 * The registration maintenance job (AGENTS.md §16.2). External watchdog layer: an in-process
 * interval calling `runRegistrationMaintenance` directly is the primary invocation and is not
 * built here (deployment-readiness item, WEEKEND.md/CLAUDE.md's remaining blockers) — this
 * endpoint is what an external scheduler posts to roughly every five minutes so the job still
 * runs if the application process itself has no long-lived interval, or has just restarted.
 *
 * Throttled as well as authenticated (§19.4), and in its own bucket rather than one shared
 * with the outbox: a maintenance run that is being hammered must not stop confirmations going
 * out, and the two endpoints have no reason to spend each other's allowance.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();

  // After the secret check, never before it — see the outbox route for why.
  const verdict = await consumeRateLimit(db, "job-invoke", "registration-maintenance", now);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfter) } },
    );
  }

  const result = await runRegistrationMaintenance(db, now);
  return NextResponse.json(result);
}
