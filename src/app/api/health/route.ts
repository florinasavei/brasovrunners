import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { checkJobHealth } from "@/modules/jobs/health";

/**
 * `/api/health` (deployment readiness). Reports the database and the two scheduled jobs.
 * "Degraded" for a stale or never-run job — not "down" — because §16.2 is explicit that the
 * job is a liveness mechanism, not a correctness one: a stalled scheduler delays a
 * notification, it does not put the site in a broken state.
 */
export async function GET(): Promise<Response> {
  const db = getDb();
  const now = new Date();

  let database: "ok" | "down" = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "down";
  }

  const jobs = await Promise.all(
    ["registration-maintenance", "email-outbox"].map((jobName) => checkJobHealth(db, jobName, now)),
  );

  const anyJobStale = jobs.some((job) => job.status !== "ok");
  const status = database === "down" ? "down" : anyJobStale ? "degraded" : "ok";

  return NextResponse.json(
    { status, database, jobs, checkedAt: now.toISOString() },
    { status: database === "down" ? 503 : 200 },
  );
}
