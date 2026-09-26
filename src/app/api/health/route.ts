import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { checkSchemaVersion } from "@/db/schema-version";
import { checkJobHealth, type JobHealth } from "@/modules/jobs/health";
import { checkEmailHealth } from "@/modules/notifications/health";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { cachedBudgetThresholds } from "@/modules/diagnostics/budget-thresholds";
import { checkNeonQuotaHealth, type NeonQuotaHealth, QUOTA_NOT_READ } from "@/modules/diagnostics/neon";
import { domainRenewal } from "@/modules/diagnostics/domain/domain-renewal";
import { isQuotaRefusalError } from "@/modules/resilience/domain/database-away";
import { probeTurnstileSecret } from "@/modules/registrations/turnstile";
import { buildInfo } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";

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
 *
 * It also carries the Neon project's own early warning (§335): once this billing period's
 * compute turns the month's budget red (85% of the monthly quota by default, §447), this answers `degraded` before
 * Neon suspends the database at 100% — a suspension that is total, and the one the club cannot
 * be emailed about once it has happened. `checkNeonQuotaHealth` is cached for fifteen minutes and
 * never fails this endpoint on its own account, so a missing key or an unreachable Neon reads as
 * nothing having been asked, never as the site being down.
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
  governorFloorMinutes: number,
): Promise<DatabaseHalf | null> {
  try {
    const [schema, jobs, email] = await Promise.all([
      checkSchemaVersion(db),
      // The budget governor's floor widens what a real run is allowed, as the Administrator's own
      // interval always has (§447): the platform's own throttle must never page the owner.
      Promise.all(JOB_NAMES.map((jobName) => checkJobHealth(db, jobName, now, governorFloorMinutes))),
      // Whether the club can still send email (§98): deferred by the allowance, overdue, or failed.
      checkEmailHealth(db, now, governorFloorMinutes),
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

/**
 * Asked afresh on every call, whatever else in the application is cached.
 *
 * Three branches of one batch put Next's data cache to work — the public pages' rows (§333,
 * public pages from cache), the jobs' "nothing due until" slots (§334, jobs sleep when nothing is
 * due), and this route's own fifteen-minute reading of the Neon quota (§335, Neon limits). None of
 * that may reach the answer itself: a monitor that is told `ok` from a cached response while the
 * database is down is the one failure this endpoint exists to prevent (§98). Route handlers are
 * dynamic by default in this Next, and a `fetch` with `next.revalidate` inside one caches that
 * fetch, not the route; saying it here means nobody has to know that to read this file, and a
 * future default cannot turn the probe below into a prerendered constant.
 */
export const dynamic = "force-dynamic";

type SchemaCheck = Awaited<ReturnType<typeof checkSchemaVersion>>;
type EmailCheck = Awaited<ReturnType<typeof checkEmailHealth>>;
type DatabaseHalf = { schema: SchemaCheck; jobs: JobHealth[]; email: EmailCheck };

class NotStored extends Error {}

/**
 * The database half of the answer, from an answer at most `minutes` old — only while the month's
 * budget is `red` (§447, `GOVERNOR_EFFECTS.healthReuseMinutes`).
 *
 * The endpoint is public, and the re-measure of 2026-09-26 counted stray wakes it could not name,
 * `/api/health` from something other than the monitor among the suspects. Each one that reaches
 * the database costs five billed minutes, and in the last fifth of the month that is the budget
 * the site runs on. So a call inside the same window of `minutes` gets the answer the first call
 * in it got. The hourly monitor still gets a fresh one almost every time; the quota part of the
 * answer (above) is never reused past its own fifteen minutes.
 *
 * Write-once, like the job slots (`jobs/schedule-cache.ts`): the window's start is in the key,
 * and the build is too — the schema check is this deployment's. **Only an answer that reached the
 * database is kept**: a failure throws inside the producer, which stores nothing, and the next
 * call asks again — a monitor is never told "down" from a cache, nor "ok" after a failure. Any
 * trouble with the cache itself (outside a request, an unreachable store) answers fresh, exactly
 * once: the producer's own result is kept in `fresh` so a failed store never asks twice.
 */
async function reuseDatabaseHalf(
  minutes: number,
  now: Date,
  ask: () => Promise<DatabaseHalf | null>,
): Promise<{ checks: DatabaseHalf | null; askedAt: Date }> {
  const windowMs = minutes * 60_000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  let fresh: DatabaseHalf | null | undefined;
  try {
    const kept = (await unstable_cache(
      async () => {
        fresh = await ask();
        if (!fresh) throw new NotStored();
        return { checks: fresh, askedAt: now.toISOString() };
      },
      ["br-health", buildInfo.id || buildInfo.commit || "local", String(minutes), windowStart.toISOString()],
      { revalidate: minutes * 60 },
    )()) as { checks: DatabaseHalf; askedAt: string };
    return { checks: kept.checks, askedAt: new Date(kept.askedAt) };
  } catch {
    return { checks: fresh === undefined ? await ask() : fresh, askedAt: now };
  }
}

const share = (part: number | null, whole: number | null) => (part === null || !whole ? null : Math.round((part / whole) * 100));

/** What the governor is doing, in a line a monitor's log can show (§447). */
const BUDGET_NOTE: Record<NeonQuotaHealth["level"], string | null> = {
  unknown: null,
  green: null,
  amber: "ahead of the month's line: the jobs run at most hourly, the public cache lives twice as long",
  red: "near the quota: the jobs run at most every two hours, health reuses a ten-minute answer, public pages are served from the cache only",
};

/** How long the route waits for the month's budget before probing without it (§447). */
const HEALTH_BUDGET_WAIT_MS = 2_500;


function withinWait<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const now = new Date();

  // The quota reading is independent of this connection — Neon's console API, never a query —
  // so it runs beside the probe rather than after it, and answers the same whether the probe
  // below succeeds or not.
  // Same reasoning as the Neon quota reading: a call to a third party (Cloudflare), cached for
  // fifteen minutes, independent of this connection, answered whether the probe below succeeds
  // or not — and never failing this endpoint on its own account (§420, finding (10)'s health
  // half). `not_configured` and `unreachable` are silently `ok`-shaped; only `misconfigured` is
  // something a human needs to act on.
  //
  // The quota reading comes first since §447 because it also says the month's budget level, and
  // the level decides whether the database half may be a recent answer rather than a fresh one.
  //
  // The quota reading waits `HEALTH_BUDGET_WAIT_MS` at most before the probe goes ahead without
  // it (the level `unknown`: no reuse, the ordinary floor). On a cache miss it is several of
  // Neon's requests in a row, and a monitor that times out on this endpoint must not be kept
  // waiting on a third party before `select 1` is even asked.
  const [neonQuota, turnstile] = await Promise.all([
    withinWait(
      cachedBudgetThresholds().then((thresholds) => checkNeonQuotaHealth(env, fetch, now, thresholds)),
      HEALTH_BUDGET_WAIT_MS,
      QUOTA_NOT_READ,
    ),
    probeTurnstileSecret(),
  ]);
  const effects = governorEffects(neonQuota.level);

  // Nothing else is asked once the probe has failed: every check below needs the connection the
  // probe just proved is not there. The probe's own error is kept: it is what says whether Neon
  // refused on its quota (`suspended`) rather than the database merely being away (`down`).
  let probeError: unknown = null;
  const probeAndAsk = async () => {
    const reachable = await db.execute(sql`select 1`).then(
      () => true,
      (error: unknown) => {
        probeError = error;
        return false;
      },
    );
    return reachable ? await askTheDatabase(db, now, effects.jobFloorMinutes) : null;
  };
  const answer =
    effects.healthReuseMinutes > 0
      ? await reuseDatabaseHalf(effects.healthReuseMinutes, now, probeAndAsk)
      : { checks: await probeAndAsk(), askedAt: now };
  const checks = answer.checks;

  /*
    A probe that answered and a check that then failed is still a database this deployment
    cannot work against — the public pages are throwing on the same connection — so it is
    reported as `down` rather than as an `ok` database with mysteriously absent figures.
  */
  /*
    `suspended` (§447): Neon has cut the project off for the rest of its billing period — its
    refusal says so ("exceeded the compute time quota"), or the governor reads the quota spent.
    Nothing is broken that a deploy could fix, the public pages serve their last good copies with
    the date the site is whole again, and the jobs answer 200 when refused; so the status is
    `degraded` (still a 503 — the monitor must hear it) rather than `down`.
  */
  const database: "ok" | "down" | "suspended" = checks
    ? "ok"
    : isQuotaRefusalError(probeError) || (neonQuota.percent ?? 0) >= 100
      ? "suspended"
      : "down";
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

  /*
    The domain's renewal (§435): thirty days or fewer before the expiry — or past it — is
    `degraded`, so the monitor's 503 reaches the owner while there is still a month to renew.
    Configuration and the clock only, never a query or a registrar's WHOIS; unset dates are
    `unknown` and change nothing.
  */
  const domain = domainRenewal(env.DOMAIN_REGISTERED_ON, env.DOMAIN_RENEWAL_YEARS, now);
  const domainDue = domain.status === "urgent" || domain.status === "expired";

  const status =
    database === "down" || schemaDown
      ? "down"
      : database === "suspended" ||
          anyJobStale ||
          schemaDegraded ||
          email?.status === "stalled" ||
          neonQuota.status === "near-limit" ||
          turnstile === "misconfigured" ||
          domainDue
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
      // With its `gmail` block since §443: recipients against the cap and the last failure, no status of its own.
      email,
      // The monthly compute quota's early warning (§335): `percent: null` means nothing was
      // asked (no key, or Neon did not answer within the timeout) rather than "there is no
      // quota". The figures themselves — the exact quota and this period's CU-hours — are the
      // club's own billing numbers; this endpoint is public and unauthenticated, so only what
      // the 503 and a monitor need (the status and the share of the quota spent) is published
      // here. `/admin/tasks` and `/devs` are where the full figures belong.
      neon: { status: neonQuota.status, percent: neonQuota.percent },
      // The month's budget as the governor reads it (§447): `green`, `amber`, `red` or `unknown`,
      // the metered spend and the pro-rated line as whole percents of the quota — shares, not
      // CU-hours, for the reason §335 gives above — and a note saying what is throttled. Only
      // `red` degrades the status (it is `neon.status: near-limit`); `amber` stays `ok` with the
      // note, because the platform slowing itself down is its own business.
      budget: {
        level: neonQuota.level,
        meteredPercent: neonQuota.percent,
        linePercent: share(neonQuota.lineCuHours, neonQuota.quotaCuHours),
        note: BUDGET_NOTE[neonQuota.level],
      },
      // The bot check's secret, probed rather than merely read as set (§420, finding (10)): a
      // wrong `TURNSTILE_SECRET_KEY` fails registration open (§205) and used to announce itself
      // nowhere but a server log. `not_configured` and `unreachable` are not problems this
      // endpoint reports; only `misconfigured` is.
      turnstile: { status: turnstile },
      // The domain's expiry (§435) is public at any registrar, so the day and the days left are
      // published; the domain's name is not repeated — it is the host this answer came from.
      domain:
        domain.status === "unknown"
          ? { status: domain.status }
          : { status: domain.status, expiresOn: domain.expiresOn, daysLeft: domain.daysLeft },
      checkedAt: now.toISOString(),
      // When the database half was asked: `checkedAt` itself, or the start of the window whose
      // answer this one reuses while the budget is red (§447).
      databaseCheckedAt: answer.askedAt.toISOString(),
    },
    { status: status === "ok" ? 200 : 503 },
  );
}
