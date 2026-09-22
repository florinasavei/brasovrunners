import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { checkSchemaVersion } from "@/db/schema-version";
import { checkJobHealth, type JobHealth } from "@/modules/jobs/health";
import { checkEmailHealth } from "@/modules/notifications/health";
import { buildInfo } from "@/shared/config/build-info";

/**
 * `/api/health` (deployment readiness). Reports the database, its schema version, and the two
 * scheduled jobs.
 *
 * "Degraded" for a stale or never-run job — not "down" — because §16.2 is explicit that the
 * job is a liveness mechanism, not a correctness one: a stalled scheduler delays a
 * notification, it does not put the site in a broken state. The word is kept; the HTTP code
 * is not: since `DECISIONS.md` §98 every answer but `ok` is a 503, because a monitor that
 * emails on a non-2xx is the only way the owner hears that email itself has stopped — the
 * platform cannot send that message through the channel that is down. `yarn smoke` reads the
 * body, so `--allow-degraded` still means what it says.
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
/**
 * Everything this endpoint asks the database, once the connection itself has answered.
 *
 * One function, and one `try`, because the guarantee is about the whole group: the route's job
 * is to *report* that the database is unusable, and a report that throws is the one failure it
 * cannot recover from. Before this, only the schema and the email checks were guarded by the
 * probe — the two job checks ran whatever it said, so a database that was actually away made
 * `checkJobHealth` throw and the route answered Next's generic server error instead of the 503
 * the monitors are waiting for (`DECISIONS.md` §98: the monitor's alarm *is* the non-2xx).
 *
 * `null` is "we could not ask", which is what the caller turns into `down`. It is never an
 * empty list or a cheerful default: a monitor that reads "no stale jobs" from a database nobody
 * could reach is worse than one that reads nothing.
 */
async function askTheDatabase(
  db: ReturnType<typeof getDb>,
  now: Date,
): Promise<{ schema: SchemaCheck; jobs: JobHealth[]; email: EmailCheck } | null> {
  try {
    const [schema, jobs, email] = await Promise.all([
      checkSchemaVersion(db),
      Promise.all(JOB_NAMES.map((jobName) => checkJobHealth(db, jobName, now))),
      // Whether the club can still send email (§98): deferred by the allowance, overdue, or failed.
      checkEmailHealth(db, now),
    ]);
    return { schema, jobs, email };
  } catch (error) {
    // The message is logged, never returned: a driver's error carries the SQL it was running and
    // sometimes the connection string, and this body is readable by anyone (§14.3).
    console.error("[health] a database-backed check failed", error);
    return null;
  }
}

const JOB_NAMES = ["registration-maintenance", "email-outbox"] as const;

type SchemaCheck = Awaited<ReturnType<typeof checkSchemaVersion>>;
type EmailCheck = Awaited<ReturnType<typeof checkEmailHealth>>;

export async function GET(): Promise<Response> {
  const db = getDb();
  const now = new Date();

  let reachable = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    reachable = false;
  }

  // Nothing else is asked once the probe has failed: every check below needs the connection the
  // probe just proved is not there.
  const checks = reachable ? await askTheDatabase(db, now) : null;

  /*
    A probe that answered and a check that then failed is still a database this deployment
    cannot work against — the public pages are throwing on the same connection — so it is
    reported as `down` rather than as an `ok` database with mysteriously absent figures.
  */
  const database: "ok" | "down" = checks ? "ok" : "down";
  const schema = checks?.schema ?? null;
  const jobs = checks?.jobs ?? null;
  const email = checks?.email ?? null;

  const anyJobStale = (jobs ?? []).some((job) => job.status !== "ok");
  /**
   * `ahead` is degraded rather than down: it is what a rollback looks like — a database migrated
   * by a newer deployment than the one now serving — and whether that breaks anything depends
   * entirely on what the migration did. Reporting it is the point; deciding it is not this
   * endpoint's job.
   */
  const schemaDown = schema?.status === "behind";
  const schemaDegraded = schema?.status === "ahead";

  const status =
    database === "down" || schemaDown
      ? "down"
      : anyJobStale || schemaDegraded || email?.status === "stalled"
        ? "degraded"
        : "ok";

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
      email,
      checkedAt: now.toISOString(),
    },
    { status: status === "ok" ? 200 : 503 },
  );
}
