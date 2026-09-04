import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedJobRequest } from "@/modules/jobs/auth";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";

/**
 * The registration maintenance job (AGENTS.md §16.2). External watchdog layer: an in-process
 * interval calling `runRegistrationMaintenance` directly is the primary invocation and is not
 * built here (deployment-readiness item, WEEKEND.md/CLAUDE.md's remaining blockers) — this
 * endpoint is what an external scheduler posts to roughly every five minutes so the job still
 * runs if the application process itself has no long-lived interval, or has just restarted.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const result = await runRegistrationMaintenance(getDb(), new Date());
  return NextResponse.json(result);
}
