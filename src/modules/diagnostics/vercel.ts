import { unstable_cache } from "next/cache";
import type { Env } from "@/shared/config/env";

/**
 * What the hosting did this month, read from Vercel (`DECISIONS.md` §101; BR-REQ-090-07).
 *
 * The owner asked for "Vercel usage" next to the database's month. On 2026-09-19 the public REST
 * API looked to have no usage endpoint; on 2026-10-16 its billing charges (`GET
 * /v1/billing/charges`, FOCUS) turned out to carry exactly the Usage page's lines, and
 * `vercel-usage.ts` reads them. What this file reads is the list of deployments, and from it the
 * Hobby ceiling a small club can meet — the deployments a day (100), which a busy evening of pushes
 * spends — and, since §803, how many of the deployments built, by branch: a build is what Vercel
 * meters.
 */

/**
 * Hobby, from vercel.com/docs/limits on 2026-09-19. The 6,000 build minutes a month are **not
 * confirmed**: Vercel's current pages (read 2026-10-16) list no monthly build-minute allowance for
 * Hobby — a build is metered as Build CPU Minutes, which Hobby does not bill. `/devs` no longer reads
 * the month against it (§803); «Costuri» still does, until a later lane re-reads the figure there.
 */
export const VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH = 6_000;
export const VERCEL_HOBBY_DEPLOYMENTS_PER_DAY = 100;
export const VERCEL_LIMITS_CHECKED_ON = "2026-09-19";

/**
 * Hobby's included Active CPU, in CPU-hours a month — the allowance the club's functions come
 * closest to: Vercel's Hobby page (vercel.com/docs/plans/hobby, last updated 2026-09-14, read
 * 2026-10-16) lists «Active CPU: 4 CPU-hrs», and a Hobby team that exceeds an included allowance cannot
 * use that feature for about thirty days, and Vercel may pause the team. Read against `readVercelUsage`'s Fluid Active CPU line (§803).
 */
export const VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH = 4;

export type VercelMonth = {
  /** Deployments created since the first of the month, UTC, on this project. */
  deployments: number;
  /** The same, for today. */
  deploymentsToday: number;
  /** Minutes spent building this month, summed from each deployment's `buildingAt` → `ready`. */
  buildMinutes: number;
  /** Deployments that ended in ERROR this month — a build that failed still spent its minutes. */
  errored: number;
  /** When the newest READY deployment finished, or null when none did this month. */
  lastReadyAt: Date | null;
  periodStart: Date;
  /**
   * Deployments that actually built this month — one that never reached the build (cancelled in the
   * queue, or skipped by an ignored build step) costs nothing and is not counted (§803: builds are the cost).
   */
  builds: number;
  /** The same builds by the branch that caused them, most first; a deployment with no branch is "?". */
  buildsByBranch: { branch: string; count: number }[];
};

type DeploymentRow = {
  uid?: string;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  readyState?: string;
  state?: string;
  /** The Git metadata Vercel keeps on a deployment made from a push. */
  meta?: { githubCommitRef?: string };
};

type ListAnswer = {
  deployments?: DeploymentRow[];
  pagination?: { next?: number | null };
};

/** At most this many pages of a hundred: a club that deploys past that in a month has other news. */
const MAX_PAGES = 10;

export async function readVercelMonth(
  env: Pick<Env, "VERCEL_API_TOKEN" | "VERCEL_PROJECT_ID" | "VERCEL_TEAM_ID">,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; month: VercelMonth } | { ok: false; reason: "unconfigured" | string }> {
  if (!env.VERCEL_API_TOKEN || !env.VERCEL_PROJECT_ID) return { ok: false, reason: "unconfigured" };

  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows: DeploymentRow[] = [];

  try {
    let until: number | null | undefined = undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL("https://api.vercel.com/v6/deployments");
      url.searchParams.set("projectId", env.VERCEL_PROJECT_ID);
      url.searchParams.set("since", String(periodStart.getTime()));
      url.searchParams.set("limit", "100");
      if (env.VERCEL_TEAM_ID) url.searchParams.set("teamId", env.VERCEL_TEAM_ID);
      if (until) url.searchParams.set("until", String(until));

      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${env.VERCEL_API_TOKEN}`, accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      const body = (await response.json()) as ListAnswer;
      if (!Array.isArray(body.deployments)) return { ok: false, reason: "unexpected answer" };
      rows.push(...body.deployments);
      // Vercel pages backwards in time: `next` is the `until` for the older page, null at the end.
      if (!body.pagination?.next || body.deployments.length === 0) break;
      until = body.pagination.next;
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : String(error) };
  }

  // One row per deployment even if a page boundary repeated one.
  const seen = new Set<string>();
  let buildMinutes = 0;
  let errored = 0;
  let deploymentsToday = 0;
  let lastReadyAt: Date | null = null;
  let deployments = 0;
  let builds = 0;
  const branches = new Map<string, number>();
  for (const row of rows) {
    const id = row.uid ?? `${row.createdAt ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if ((row.createdAt ?? 0) < periodStart.getTime()) continue;
    deployments += 1;
    if ((row.createdAt ?? 0) >= dayStart) deploymentsToday += 1;
    const state = row.readyState ?? row.state;
    if (state === "ERROR") errored += 1;
    if (row.buildingAt && row.ready && row.ready > row.buildingAt) {
      buildMinutes += (row.ready - row.buildingAt) / 60_000;
    }
    if (row.buildingAt) {
      builds += 1;
      const branch = row.meta?.githubCommitRef || "?";
      branches.set(branch, (branches.get(branch) ?? 0) + 1);
    }
    if (state === "READY" && row.ready && (!lastReadyAt || row.ready > lastReadyAt.getTime())) {
      lastReadyAt = new Date(row.ready);
    }
  }

  return {
    ok: true,
    month: {
      deployments,
      deploymentsToday,
      buildMinutes: Math.round(buildMinutes * 10) / 10,
      errored,
      lastReadyAt,
      periodStart,
      builds,
      buildsByBranch: [...branches]
        .map(([branch, count]) => ({ branch, count }))
        .sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch)),
    },
  };
}

/** What Costuri's «Luna aceasta» needs of the month (§479): two numbers, which survive a cache's JSON. */
export type VercelMonthFigures = { deployments: number; buildMinutes: number };

/** An hour, like the weather's (§402): the figures move with a deploy, and nobody decides on the minute. */
export const VERCEL_COSTS_CACHE_SECONDS = 3_600;

class VercelNotRead extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * The month's deployments and build minutes for Costuri, from Next's data cache for an hour (§479).
 *
 * `readVercelMonth` walks up to ten pages of a hundred, five seconds each, and a render of Costuri
 * must not wait on that every time it opens; `/devs` keeps the live read, because that page is
 * where somebody goes to see the deployment that just finished. The key names the project and the
 * month — never the token — and a failure is never kept: it throws inside the cached function,
 * which stores nothing, so the next open asks again. Outside a Next server (a test, a script) the
 * cache is not there and the read is made directly, once.
 */
export async function readVercelMonthForCosts(
  env: Pick<Env, "VERCEL_API_TOKEN" | "VERCEL_PROJECT_ID" | "VERCEL_TEAM_ID">,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; month: VercelMonthFigures } | { ok: false; reason: "unconfigured" | string }> {
  if (!env.VERCEL_API_TOKEN || !env.VERCEL_PROJECT_ID) return { ok: false, reason: "unconfigured" };
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
  const load = async (): Promise<VercelMonthFigures> => {
    const read = await readVercelMonth(env, now, fetchImpl);
    if (!read.ok) throw new VercelNotRead(read.reason);
    return { deployments: read.month.deployments, buildMinutes: read.month.buildMinutes };
  };
  try {
    const month = await unstable_cache(load, ["br-vercel-month", env.VERCEL_PROJECT_ID, env.VERCEL_TEAM_ID ?? "", monthKey], {
      revalidate: VERCEL_COSTS_CACHE_SECONDS,
    })();
    return { ok: true, month };
  } catch (error) {
    if (error instanceof VercelNotRead) return { ok: false, reason: error.reason };
    // No data cache here (outside a request): ask once, directly.
    try {
      return { ok: true, month: await load() };
    } catch (again) {
      return { ok: false, reason: again instanceof VercelNotRead ? again.reason : "unexpected answer" };
    }
  }
}
