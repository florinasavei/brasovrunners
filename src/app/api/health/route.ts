import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { checkSchemaVersion } from "@/db/schema-version";
import { checkJobHealth } from "@/modules/jobs/health";
import { buildInfo } from "@/shared/config/build-info";

/**
 * `/api/health` (deployment readiness). Reports the database, its schema version, and the two
 * scheduled jobs.
 *
 * "Degraded" for a stale or never-run job — not "down" — because §16.2 is explicit that the
 * job is a liveness mechanism, not a correctness one: a stalled scheduler delays a
 * notification, it does not put the site in a broken state.
 *
 * It also names the build itself. That is not decoration: an environment can be broken by
 * running code that is perfectly healthy and simply *old* — a deployment that never reached the
 * alias, so the hostname everyone uses serves a commit from last week. Nothing in the database
 * or the jobs can see that, and it presents exactly like a schema problem from the outside
 * (`DECISIONS.md` §31). `yarn smoke --expect-commit` is what turns it into an answer.
 *
 * A schema *behind* the build is the opposite, and is reported as down. That is not a judgement
 * call: the code in this deployment selects columns the database does not have, so the public
 * pages are already returning 500. Until this check existed, that state reported
 * `database: ok` — `select 1` succeeds perfectly well against a stale schema — and the only
 * symptom was a broken landing page with nothing to point at (`DECISIONS.md` §31).
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

  // Only worth asking once the connection itself answered.
  const schema = database === "ok" ? await checkSchemaVersion(db) : null;

  const jobs = await Promise.all(
    ["registration-maintenance", "email-outbox"].map((jobName) => checkJobHealth(db, jobName, now)),
  );

  const anyJobStale = jobs.some((job) => job.status !== "ok");
  /**
   * `ahead` is degraded rather than down: it is what a rollback looks like — a database migrated
   * by a newer deployment than the one now serving — and whether that breaks anything depends
   * entirely on what the migration did. Reporting it is the point; deciding it is not this
   * endpoint's job.
   */
  const schemaDown = schema?.status === "behind";
  const schemaDegraded = schema?.status === "ahead";

  const status =
    database === "down" || schemaDown ? "down" : anyJobStale || schemaDegraded ? "degraded" : "ok";

  return NextResponse.json(
    {
      status,
      // Which code is answering. `buildInfo` is inlined at build time, so this is the commit
      // that was compiled, not the branch a deployment claims to track.
      build: {
        baseline: buildInfo.baseline || null,
        commit: buildInfo.commit || null,
        committedAt: buildInfo.committedAt || null,
      },
      database,
      schema,
      jobs,
      checkedAt: now.toISOString(),
    },
    { status: status === "down" ? 503 : 200 },
  );
}
