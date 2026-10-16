import { unstable_cache } from "next/cache";
import type { Env } from "@/shared/config/env";

/**
 * The lines of Vercel's Usage page, read from Vercel (§NNN; the owner, 2026-10-16: «mă interesează
 * să țin Vercel free după decembrie»).
 *
 * `vercel.ts` says Vercel's REST API has no usage endpoint (checked 2026-09-19). Read again on
 * 2026-10-16 in the API's own reference (`GET /v1/billing/charges`, «List FOCUS billing charges»,
 * Vercel API on Context7): the charges **are** exposed — one JSON object per line, per day, per
 * service and per project, with `ServiceName`, `ConsumedQuantity`, `ConsumedUnit`, `EffectiveCost`
 * and `Tags.ProjectName` — for a role of Owner, Member, Developer, Security or Billing on the team.
 * It was tried against the club's team that day and answered the same lines as the dashboard (build
 * CPU minutes first, then Fluid Active CPU, observability events, function storage, ISR writes).
 * Whether the token this deployment holds is allowed to call it is the token's own business, so the
 * reader tries and, when Vercel refuses, says so with Vercel's status — the page then links the
 * Usage page instead (never a guessed figure, §1.2).
 *
 * The month is the calendar month in UTC to date: the endpoint takes a date range and knows nothing
 * of the account's billing cycle, which is what the dashboard's Usage page follows; the two differ
 * by the days between the first and the cycle's day.
 */

/** One service's month: what it consumed and what it cost at list price (`EffectiveCost`), USD. */
export type VercelUsageLine = {
  service: string;
  /** `ConsumedUnit` as Vercel names it («minute», «Events», «gigabyte»); null for a charge with no meter. */
  unit: string | null;
  quantity: number;
  usd: number;
};

export type VercelUsage = {
  /** Every service that cost something, the dearest first. A subscription (no unit) is not here. */
  lines: VercelUsageLine[];
  /** The sum of `lines`: the usage the plan's included credit is spent on. */
  usageUsd: number;
  /** What the plan's subscription itself charged to date, from the unmetered lines («Pro»); 0 on Hobby. */
  subscriptionUsd: number;
  /** «Build CPU Minutes» by project, the minutes and their list price — builds are the cost. */
  buildsByProject: { project: string; minutes: number; usd: number }[];
  /** Fluid Active CPU, in CPU-hours: Hobby includes four a month, and this is the figure that decides whether it fits. */
  activeCpuHours: number;
  periodStart: Date;
  /** The day after the last charge asked for. */
  periodEnd: Date;
};

type FocusRow = {
  ServiceName?: string;
  ConsumedQuantity?: number | null;
  ConsumedUnit?: string | null;
  EffectiveCost?: number | null;
  Tags?: { ProjectName?: string };
};

const BUILD_SERVICE = "Build CPU Minutes";
const ACTIVE_CPU_SERVICE = "Fluid Active CPU";

/** A cost under this is a rounding of a service that cost nothing: it is not a line. */
const NEGLIGIBLE_USD = 0.005;

/**
 * Folds a JSONL body into the month. Pure: a line that does not parse is skipped (a half line at the
 * end of a truncated body), and a service's days and projects are summed.
 */
export function summariseVercelCharges(body: string, periodStart: Date, periodEnd: Date): VercelUsage {
  const services = new Map<string, VercelUsageLine>();
  const builds = new Map<string, { minutes: number; usd: number }>();
  let subscriptionUsd = 0;
  let activeCpuHours = 0;

  for (const text of body.split("\n")) {
    if (!text.trim()) continue;
    let row: FocusRow;
    try {
      row = JSON.parse(text) as FocusRow;
    } catch {
      continue;
    }
    const service = row.ServiceName;
    if (!service) continue;
    const usd = Number(row.EffectiveCost ?? 0) || 0;
    const quantity = Number(row.ConsumedQuantity ?? 0) || 0;
    const unit = row.ConsumedUnit ?? null;
    if (unit === null) {
      subscriptionUsd += usd;
      continue;
    }
    const line = services.get(service) ?? { service, unit, quantity: 0, usd: 0 };
    line.quantity += quantity;
    line.usd += usd;
    services.set(service, line);
    if (service === ACTIVE_CPU_SERVICE) activeCpuHours += quantity;
    if (service === BUILD_SERVICE) {
      const project = row.Tags?.ProjectName || "?";
      const build = builds.get(project) ?? { minutes: 0, usd: 0 };
      build.minutes += quantity;
      build.usd += usd;
      builds.set(project, build);
    }
  }

  const lines = [...services.values()].filter((line) => line.usd >= NEGLIGIBLE_USD).sort((a, b) => b.usd - a.usd);
  return {
    lines,
    usageUsd: lines.reduce((sum, line) => sum + line.usd, 0),
    subscriptionUsd,
    buildsByProject: [...builds].map(([project, value]) => ({ project, ...value })).sort((a, b) => b.minutes - a.minutes || a.project.localeCompare(b.project)),
    activeCpuHours,
    periodStart,
    periodEnd,
  };
}

export type VercelUsageRead = { ok: true; usage: VercelUsage } | { ok: false; reason: "unconfigured" | string };

/** The call and its fetch, five times a deployments list's patience: the body is megabytes of mostly zero lines. */
const TIMEOUT_MS = 20_000;

export async function readVercelUsage(
  env: Pick<Env, "VERCEL_API_TOKEN" | "VERCEL_TEAM_ID">,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<VercelUsageRead> {
  if (!env.VERCEL_API_TOKEN) return { ok: false, reason: "unconfigured" };
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const url = new URL("https://api.vercel.com/v1/billing/charges");
  url.searchParams.set("from", periodStart.toISOString());
  url.searchParams.set("to", periodEnd.toISOString());
  if (env.VERCEL_TEAM_ID) url.searchParams.set("teamId", env.VERCEL_TEAM_ID);
  try {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${env.VERCEL_API_TOKEN}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, usage: summariseVercelCharges(await response.text(), periodStart, periodEnd) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : String(error) };
  }
}

/** An hour, like the deployments' read for Costuri (`VERCEL_COSTS_CACHE_SECONDS`): a month's usage moves slowly. */
export const VERCEL_USAGE_CACHE_SECONDS = 3_600;

class UsageNotRead extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * The month's usage for `/devs`, from Next's data cache for an hour: the body is megabytes, and
 * the page must not download them at every open. The key names the team and the month — never the
 * token — and a failure is never kept (it throws inside the cached function, which stores
 * nothing). Dates cross the cache as ISO strings and come back as dates. Outside a Next server (a
 * test, a script) the cache is not there and the read is made once, directly.
 */
export async function readVercelUsageCached(
  env: Pick<Env, "VERCEL_API_TOKEN" | "VERCEL_TEAM_ID">,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<VercelUsageRead> {
  if (!env.VERCEL_API_TOKEN) return { ok: false, reason: "unconfigured" };
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
  const load = async () => {
    const read = await readVercelUsage(env, now, fetchImpl);
    if (!read.ok) throw new UsageNotRead(read.reason);
    return read.usage;
  };
  const revive = (usage: VercelUsage): VercelUsage => ({ ...usage, periodStart: new Date(usage.periodStart), periodEnd: new Date(usage.periodEnd) });
  try {
    const usage = await unstable_cache(load, ["br-vercel-usage", env.VERCEL_TEAM_ID ?? "", monthKey], { revalidate: VERCEL_USAGE_CACHE_SECONDS })();
    return { ok: true, usage: revive(usage) };
  } catch (error) {
    if (error instanceof UsageNotRead) return { ok: false, reason: error.reason };
    try {
      return { ok: true, usage: await load() };
    } catch (again) {
      return { ok: false, reason: again instanceof UsageNotRead ? again.reason : "unexpected answer" };
    }
  }
}
