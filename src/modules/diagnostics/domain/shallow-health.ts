import type { DomainRenewal } from "./domain-renewal";

/**
 * `/api/health` without `?deep=1` (§NNN): the build and the configuration, and nothing a call
 * has to ask anybody for — no database, no Neon, no Cloudflare, no DeepL.
 *
 * The owner, 2026-09-29: «dacă site-ul stă în idle nu vreau să consum nimic!». Every `/api/health`
 * used to open the database (the schema, the two jobs, the outbox, the bot-check counts), and on
 * Neon Launch each wake bills five minutes: the hourly production monitor alone was 24 wakes a day
 * on a platform nobody visited. So the monitors call this shallow answer, which proves the thing an
 * hourly monitor exists for — the deployment serves, its functions start, its configuration parses
 * (`env.ts` refuses a bad one at import, and the answer is then a 500) — and names the build that
 * answered, which is all `scripts/ship.mjs` waits for. The deep answer (`?deep=1`, the route's full
 * report) is what a person, `yarn smoke`, the migration workflow and the once-a-day monitor at the
 * maintenance window ask (`SETUP.md` §40).
 *
 * Pure, so every rule is a test: the route passes presence booleans, never a value.
 */

/** The query that asks for the full report: `?deep=1` (also `true`, `yes`). */
export const DEEP_HEALTH_PARAM = "deep";

/** Whether this request asked for the full report. A request without a URL (a direct call) is shallow. */
export function asksForDeepHealth(url: string | undefined | null): boolean {
  if (!url) return false;
  let value: string | null;
  try {
    value = new URL(url, "http://localhost").searchParams.get(DEEP_HEALTH_PARAM);
  } catch {
    return false;
  }
  return value !== null && ["1", "true", "yes", ""].includes(value.trim().toLowerCase());
}

export type ShallowHealthInput = {
  build: { baseline: string; commit: string; committedAt: string };
  /** The migration this build expects (`db/schema-version.ts#EXPECTED_MIGRATION`), from the build — never asked of the database. */
  expectedMigration: string | null;
  appEnv: "local" | "test" | "qa" | "production";
  /** Presence only, never a value. */
  present: { DATABASE_URL: boolean; JOB_SECRET: boolean };
  domain: DomainRenewal;
  now: Date;
};

export type ShallowHealth = {
  status: "ok" | "degraded";
  depth: "shallow";
  build: { baseline: string | null; commit: string | null; committedAt: string | null };
  schema: { expectedTag: string | null };
  configuration: { status: "ok" | "incomplete"; missing: string[] };
  domain: { status: DomainRenewal["status"]; expiresOn?: string; daysLeft?: number };
  /** Where the full report is, for whoever reads this in a browser. */
  deep: string;
  checkedAt: string;
};

/**
 * The variables a deployed environment cannot work without and `env.ts` does not already refuse
 * at startup: the database, and the jobs' secret (a deployment without it runs no job, and nothing
 * else would say so until an email failed to leave). Locally and under test neither is required.
 */
function missingEssentials(input: ShallowHealthInput): string[] {
  if (input.appEnv === "local" || input.appEnv === "test") return [];
  const missing: string[] = [];
  if (!input.present.DATABASE_URL) missing.push("DATABASE_URL");
  if (!input.present.JOB_SECRET) missing.push("JOB_SECRET");
  return missing;
}

export function shallowHealth(input: ShallowHealthInput): ShallowHealth {
  const missing = missingEssentials(input);
  const domainDue = input.domain.status === "urgent" || input.domain.status === "expired";
  return {
    status: missing.length > 0 || domainDue ? "degraded" : "ok",
    depth: "shallow",
    build: {
      baseline: input.build.baseline || null,
      commit: input.build.commit || null,
      committedAt: input.build.committedAt || null,
    },
    schema: { expectedTag: input.expectedMigration },
    configuration: { status: missing.length > 0 ? "incomplete" : "ok", missing },
    // The expiry is public at any registrar (§435); the name is the host this answer came from.
    domain:
      input.domain.status === "unknown"
        ? { status: input.domain.status }
        : { status: input.domain.status, expiresOn: input.domain.expiresOn, daysLeft: input.domain.daysLeft },
    deep: `/api/health?${DEEP_HEALTH_PARAM}=1`,
    checkedAt: input.now.toISOString(),
  };
}
