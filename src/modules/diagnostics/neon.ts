import type { Env } from "@/shared/config/env";
import {
  cuHoursToSeconds,
  isNeonQuotaNearLimit,
  NEON_MIN_CU,
  type NeonLimitsReading,
  neonQuotaRatio,
  secondsToCuHours,
} from "./domain/neon-limits";
import { type NeonBudgetLevel, neonBudget } from "./domain/neon-budget";
import {
  awakeSecondsFromOperations,
  meteredCuSeconds,
  type NeonMeterSource,
  type NeonOperation,
  pickMeterReading,
} from "./domain/neon-meter";
import { NEON_PLANS, type NeonPlanId, neonPlanFromSubscription } from "./domain/neon-plan";

/** Neon's API, the one third-party host this module talks to (`scripts/docs-check.mjs` lists it). */
const NEON_API = "https://console.neon.tech/api/v2";

/** Free's monthly compute allowance, from the one catalogue; kept under its old name for the callers that read it. */
export const NEON_FREE_CU_HOURS = NEON_PLANS.FREE.cuHoursPerMonth as number;

/**
 * Why a request to Neon gave nothing this code can use — each kind is one sentence on the card
 * and one refusal code on the form (§335), never a stack or Neon's own error text.
 *
 * `forbidden` is the one worth its own word: a key that reads the figures and may not change
 * them answers 401 or 403 to the write while every read above it worked, and the sentence has to
 * say which key is needed. Per Neon's key documentation (manage/api-keys, checked 2026-09-24) a
 * project-scoped key has Editor access to its project and an organization key is admin-level,
 * so both may write; a personal key carries its owner's own access, and one whose owner may only
 * view the project is the key that reads and cannot write.
 */
export type NeonFailure =
  | { kind: "unconfigured"; missing: Array<"NEON_API_KEY" | "NEON_PROJECT_ID"> }
  | { kind: "forbidden"; status: number }
  | { kind: "busy" }
  | { kind: "refused"; status: number }
  | { kind: "unavailable"; status: number }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "unexpected" };

export type NeonFailureKind = NeonFailure["kind"];
export const NEON_FAILURE_KINDS = [
  "unconfigured",
  "forbidden",
  "busy",
  "refused",
  "unavailable",
  "timeout",
  "network",
  "unexpected",
] as const satisfies readonly NeonFailureKind[];

/**
 * What the Neon functions can be handed instead of the real world: a fetch, a clock to wait on, a
 * shorter timeout — and `shared`, which files the reads in Next's data cache for
 * `NEON_SHARED_READ_SECONDS` instead of asking Neon afresh (see `readNeonMeter`).
 */
export type NeonDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  shared?: boolean;
};

/** A page that waits on a third party waits five seconds at most. */
export const NEON_TIMEOUT_MS = 5_000;

/**
 * How long a shared reading of Neon is kept in Next's data cache: fifteen minutes. Neon updates
 * its consumption figures about every fifteen minutes and recommends polling no more often
 * (neon.com/docs/guides/consumption-metrics, checked 2026-09-26); its consumption endpoints share
 * one bucket of about fifty requests a minute per account. `/api/health` is public, so a burst of
 * callers costs one Neon request per window rather than one each (§335).
 */
export const NEON_SHARED_READ_SECONDS = 900;

/**
 * How long to wait before asking again when Neon answers 423 Locked — "another operation is
 * running on this project", which the endpoint change itself starts. Neon's guidance is to retry
 * with a growing delay; three tries inside two and a half seconds keep a save well inside a
 * serverless request's budget.
 */
export const NEON_LOCKED_RETRY_MS = [300, 700, 1_500] as const;

type NeonEnv = Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">;
/** The two variables, once checked present. */
type ConfiguredNeonEnv = { NEON_API_KEY: string; NEON_PROJECT_ID: string };

function missingNeonVariables(env: NeonEnv): Array<"NEON_API_KEY" | "NEON_PROJECT_ID"> {
  return [...(env.NEON_API_KEY ? [] : ["NEON_API_KEY" as const]), ...(env.NEON_PROJECT_ID ? [] : ["NEON_PROJECT_ID" as const])];
}

function failureOfStatus(status: number): NeonFailure {
  if (status === 401 || status === 403) return { kind: "forbidden", status };
  if (status === 423) return { kind: "busy" };
  if (status >= 500) return { kind: "unavailable", status };
  return { kind: "refused", status };
}

/** `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`; read the name off whatever was thrown. */
function failureOfThrow(error: unknown): NeonFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  return name === "TimeoutError" || name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
}

/**
 * One request to Neon's API with the key, the timeout and a failure kind instead of a throw. A
 * write that meets 423 Locked is asked again after `NEON_LOCKED_RETRY_MS`; a read never is. A
 * write is never cached; a read is cached only when the caller asks for the shared reading.
 */
async function neonRequest(
  env: ConfiguredNeonEnv,
  path: string,
  init: { method: "GET" } | { method: "PATCH"; body: unknown },
  deps: NeonDeps,
): Promise<{ ok: true; body: unknown } | { ok: false; failure: NeonFailure }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays: readonly number[] = init.method === "PATCH" ? NEON_LOCKED_RETRY_MS : [];
  const cacheInit = init.method === "GET" && deps.shared ? { next: { revalidate: NEON_SHARED_READ_SECONDS } } : { cache: "no-store" as const };
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${NEON_API}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${env.NEON_API_KEY}`,
          accept: "application/json",
          ...(init.method === "PATCH" ? { "content-type": "application/json" } : {}),
        },
        ...(init.method === "PATCH" ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(deps.timeoutMs ?? NEON_TIMEOUT_MS),
        ...cacheInit,
      });
    } catch (error) {
      return { ok: false, failure: failureOfThrow(error) };
    }
    if (response.status === 423 && attempt < delays.length) {
      await sleep(delays[attempt]);
      continue;
    }
    if (!response.ok) return { ok: false, failure: failureOfStatus(response.status) };
    try {
      return { ok: true, body: await response.json() };
    } catch (error) {
      const failure = failureOfThrow(error);
      return { ok: false, failure: failure.kind === "timeout" ? failure : { kind: "unexpected" } };
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const cuOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// --- The one reader (§NNN) --------------------------------------------------------------------

/**
 * This billing period as Neon meters it — the one reading `/api/health`, `/devs`, Costuri, the
 * limits card and the governor all start from (§NNN, replacing the two copies §335 had already
 * merged into one request).
 *
 * `usedCuHours` is the figure every page prints and every rule compares: the largest of the three
 * sources that answered (`domain/neon-meter.ts` says why each is a lower bound, and why the
 * largest is the one to trust). The three are kept beside it, so `/devs` can show which one it
 * was and how far apart they are — the frozen counter's distance from the metered figure is how
 * the re-measure of 2026-09-26 found the problem in the first place.
 */
export type NeonMeter = {
  usedCuHours: number;
  source: NeonMeterSource;
  /** `compute_unit_seconds` from the consumption endpoint, in CU-hours, or null when the key may not read it. */
  meteredCuHours: number | null;
  /** Awake time from the operations log times the compute's floor, in CU-hours, or null when the log could not say. */
  operationsCuHours: number | null;
  /** The project row's `compute_time_seconds`, in CU-hours — a legacy counter that stopped on 2026-09-24. */
  legacyCuHours: number;
  /** Hours awake this period, from the operations log when it answered, else the row's legacy `active_time_seconds`. */
  awakeHours: number;
  /** The compute's own floor, the size the operations estimate is priced at. */
  floorCu: number;
  periodStart: Date;
  periodEnd: Date;
  /** The period's compute-time limit in CU-hours (§335), or null when there is none (absent or zero). */
  quotaCuHours: number | null;
  /** The plan Neon reports for the owning account (§326), or null for one this code does not know. */
  reportedPlan: NeonPlanId | null;
};

/** How many pages of a thousand operations the reader walks back at most — a month of forty wakes a day is three. */
export const NEON_OPERATIONS_MAX_PAGES = 8;
const NEON_OPERATIONS_PAGE = 1000;

/** The next midnight UTC: the consumption endpoint's `to`, stable for a day so a shared reading stays one cache entry. */
function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * The operations log back to the period's start, newest first, a page at a time. `reaches` is
 * whether it got there: the last page was short (the whole log has been read) or its oldest entry
 * is older than the period.
 */
async function readOperationsSince(
  env: ConfiguredNeonEnv,
  periodStart: Date,
  deps: NeonDeps,
): Promise<{ operations: NeonOperation[]; reaches: boolean } | null> {
  const project = encodeURIComponent(env.NEON_PROJECT_ID);
  const operations: NeonOperation[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < NEON_OPERATIONS_MAX_PAGES; page += 1) {
    const query = `limit=${NEON_OPERATIONS_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const answer = await neonRequest(env, `/projects/${project}/operations?${query}`, { method: "GET" }, deps);
    if (!answer.ok || !isRecord(answer.body) || !Array.isArray(answer.body.operations)) return null;
    const batch = answer.body.operations.filter(
      (op): op is NeonOperation =>
        isRecord(op) && typeof op.action === "string" && typeof op.status === "string" && typeof op.created_at === "string",
    );
    operations.push(...batch);
    const oldest = batch.length > 0 ? Date.parse(batch[batch.length - 1].created_at) : Number.NEGATIVE_INFINITY;
    if (answer.body.operations.length < NEON_OPERATIONS_PAGE || oldest < periodStart.getTime()) return { operations, reaches: true };
    const next = isRecord(answer.body.pagination) && typeof answer.body.pagination.cursor === "string" ? answer.body.pagination.cursor : null;
    if (!next || next === cursor) return { operations, reaches: false };
    cursor = next;
  }
  return { operations, reaches: false };
}

/**
 * The metered `compute_unit_seconds` for the period, or null when the key may not read the
 * organisation's consumption (a project-scoped key never may) or the row names no organisation.
 */
async function readMeteredSeconds(
  env: ConfiguredNeonEnv,
  orgId: string | null,
  periodStart: Date,
  now: Date,
  deps: NeonDeps,
): Promise<number | null> {
  if (!orgId) return null;
  const refusalKey = `${env.NEON_PROJECT_ID}:${orgId}`;
  const refusedAt = consumptionRefusals.get(refusalKey);
  if (deps.shared && refusedAt !== undefined && now.getTime() - refusedAt >= 0 && now.getTime() - refusedAt < NEON_CONSUMPTION_REFUSAL_MS) return null;
  const query = new URLSearchParams({
    org_id: orgId,
    project_ids: env.NEON_PROJECT_ID,
    from: periodStart.toISOString(),
    to: nextUtcMidnight(now).toISOString(),
    granularity: "daily",
    metrics: "compute_unit_seconds",
  });
  const answer = await neonRequest(env, `/consumption_history/v2/projects?${query.toString()}`, { method: "GET" }, deps);
  if (!answer.ok) {
    // A key scoped to one project is refused here every time (403/404); Next's fetch cache keeps
    // no refusal, so without this every shared reading would send Neon one more doomed request.
    if (answer.failure.kind === "forbidden" || answer.failure.kind === "refused") consumptionRefusals.set(refusalKey, now.getTime());
    return null;
  }
  consumptionRefusals.delete(refusalKey);
  return meteredCuSeconds(answer.body, env.NEON_PROJECT_ID, periodStart);
}

/**
 * How long this instance believes a refusal of the consumption endpoint before asking again: six
 * hours, so a key the owner swaps for an organisation's is noticed the same day, and a key that
 * cannot read it costs Neon four requests a day per instance rather than one per reading. Only
 * the shared reading (`deps.shared`) honours it; a direct read — the limits card's save, a test —
 * always asks.
 */
export const NEON_CONSUMPTION_REFUSAL_MS = 6 * 3_600_000;
const consumptionRefusals = new Map<string, number>();

/** For the tests, which must not see one case's refusal in the next. */
export function forgetNeonConsumptionRefusals(): void {
  consumptionRefusals.clear();
}

/** The read-write compute's floor, from the endpoints answer; the platform's own when none says. */
function floorOf(endpoints: unknown[] | null): number {
  const floors = (endpoints ?? []).flatMap((endpoint) =>
    isRecord(endpoint) && endpoint.type === "read_write" && cuOrNull(endpoint.autoscaling_limit_min_cu) !== null
      ? [endpoint.autoscaling_limit_min_cu as number]
      : [],
  );
  return floors.length > 0 ? Math.max(...floors) : NEON_MIN_CU;
}

/**
 * The meter, from a project row already in hand: the operations log and the consumption endpoint
 * are asked side by side, and either may fail without failing the reading — the row's own
 * counter is always there to fall back on. Null only when the row has no period.
 */
async function meterFromRow(
  env: ConfiguredNeonEnv,
  row: Record<string, unknown>,
  endpoints: unknown[] | null,
  deps: NeonDeps,
  now: Date,
): Promise<NeonMeter | null> {
  if (typeof row.consumption_period_start !== "string" || typeof row.consumption_period_end !== "string") return null;
  const periodStart = new Date(row.consumption_period_start);
  const periodEnd = new Date(row.consumption_period_end);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) return null;

  const [operations, metered] = await Promise.all([
    readOperationsSince(env, periodStart, deps),
    readMeteredSeconds(env, typeof row.org_id === "string" ? row.org_id : null, periodStart, now, deps),
  ]);
  const floorCu = floorOf(endpoints);
  const awakeSeconds = operations ? awakeSecondsFromOperations(operations.operations, periodStart, now, operations.reaches) : null;
  const legacyCuHours = (cuOrNull(row.compute_time_seconds) ?? 0) / 3600;
  const readings = {
    metered: metered === null ? null : metered / 3600,
    operations: awakeSeconds === null ? null : (awakeSeconds / 3600) * floorCu,
    legacy: legacyCuHours,
  };
  const { usedCuHours, source } = pickMeterReading(readings);
  const quota = isRecord(row.settings) && isRecord(row.settings.quota) ? row.settings.quota.compute_time_seconds : undefined;
  return {
    usedCuHours,
    source,
    meteredCuHours: readings.metered,
    operationsCuHours: readings.operations,
    legacyCuHours,
    awakeHours: awakeSeconds === null ? (cuOrNull(row.active_time_seconds) ?? 0) / 3600 : awakeSeconds / 3600,
    floorCu,
    periodStart,
    periodEnd,
    quotaCuHours: secondsToCuHours(quota),
    reportedPlan: neonPlanFromSubscription(isRecord(row.owner) ? row.owner.subscription_type : undefined),
  };
}

/**
 * The one reader: the project row (required), the compute's floor, the operations log and the
 * metered consumption, as one `NeonMeter` — or a failure kind when the row itself could not be
 * read.
 *
 * `shared: true` files every request in Next's data cache for fifteen minutes
 * (`NEON_SHARED_READ_SECONDS`), which is how `/api/health`, the governor, `/devs` and the task
 * board read it: several readers, one set of requests a quarter of an hour. The limits card's
 * save reads the row itself afresh (`readNeonLimits`), because a write must start from Neon's
 * current settings; the usage it compares a new limit against is the meter's, which may be a
 * quarter of an hour old — well inside the five CU-hours of margin a new limit must clear.
 *
 * None of this touches the database: Neon's API is a different host, and asking it neither wakes
 * a sleeping compute nor fails when the project is suspended — which is exactly when the governor
 * needs the answer.
 */
export async function readNeonMeter(
  env: NeonEnv,
  deps: NeonDeps = {},
  now: Date = new Date(),
): Promise<{ ok: true; meter: NeonMeter } | { ok: false; failure: NeonFailure }> {
  const missing = missingNeonVariables(env);
  if (missing.length > 0 || !env.NEON_API_KEY || !env.NEON_PROJECT_ID) return { ok: false, failure: { kind: "unconfigured", missing } };
  const configured = { NEON_API_KEY: env.NEON_API_KEY, NEON_PROJECT_ID: env.NEON_PROJECT_ID };
  const project = encodeURIComponent(env.NEON_PROJECT_ID);
  const [rowAnswer, endpointsAnswer] = await Promise.all([
    neonRequest(configured, `/projects/${project}`, { method: "GET" }, deps),
    neonRequest(configured, `/projects/${project}/endpoints`, { method: "GET" }, deps),
  ]);
  if (!rowAnswer.ok) return rowAnswer;
  const row = isRecord(rowAnswer.body) && isRecord(rowAnswer.body.project) ? rowAnswer.body.project : null;
  if (!row) return { ok: false, failure: { kind: "unexpected" } };
  const endpoints =
    endpointsAnswer.ok && isRecord(endpointsAnswer.body) && Array.isArray(endpointsAnswer.body.endpoints) ? endpointsAnswer.body.endpoints : null;
  const meter = await meterFromRow(configured, row, endpoints, deps, now);
  return meter ? { ok: true, meter } : { ok: false, failure: { kind: "unexpected" } };
}

/**
 * The database's consumption this billing period, as `/devs` and the task board have always read
 * it (BR-REQ-090-07) — now the meter's figure rather than the frozen counter (§NNN).
 *
 * What the figure means depends on the plan (`domain/neon-plan.ts`): on Free it is counted against
 * 100 CU-hours a month per project and the compute is *suspended* when they run out; on Launch
 * the same hours are billed at the catalogue rate. Optional: without the two variables the panel
 * says so and nothing else changes. A sentence on failure, never a throw — a diagnostics page that
 * hangs on a third party is worse than one that says "Neon did not answer".
 */
export type NeonConsumption = {
  cuHours: number;
  activeHours: number;
  periodStart: Date;
  periodEnd: Date;
  /** The plan Neon reports for the owning account, or null when it names one this code does not know. */
  reportedPlan: NeonPlanId | null;
  /** The period's compute-time limit in CU-hours (§335), or null when there is none (absent or zero). */
  quotaCuHours: number | null;
  /** The whole reading, for the pages that say where the figure came from. */
  meter: NeonMeter;
};

function reasonOf(failure: NeonFailure): string {
  switch (failure.kind) {
    case "forbidden":
    case "refused":
    case "unavailable":
      return `HTTP ${failure.status}`;
    case "busy":
      return "HTTP 423";
    case "unexpected":
      return "unexpected answer";
    default:
      return failure.kind;
  }
}

export async function readNeonConsumption(
  env: NeonEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<{ ok: true; consumption: NeonConsumption } | { ok: false; reason: "unconfigured" | string }> {
  const read = await readNeonMeter(env, { fetchImpl, shared: true }, now);
  if (!read.ok) return { ok: false, reason: reasonOf(read.failure) };
  const { meter } = read;
  return {
    ok: true,
    consumption: {
      cuHours: meter.usedCuHours,
      activeHours: meter.awakeHours,
      periodStart: meter.periodStart,
      periodEnd: meter.periodEnd,
      reportedPlan: meter.reportedPlan,
      quotaCuHours: meter.quotaCuHours,
      meter,
    },
  };
}

/**
 * `/api/health`'s early warning for a project's monthly compute-time quota (§335): once this
 * period's spend reaches 80% of it (`NEON_QUOTA_WARNING_RATIO`), health degrades before Neon
 * suspends the database at 100% — a suspension is total, every page down until the next billing
 * period, and the 503 is the one channel a monitor still reads once email is among what stopped.
 * Since §NNN the spend is the meter's, so the warning can fire at all: the counter it read before
 * stopped on 2026-09-24 and ran about 45% under the month.
 *
 * The shared reading (fifteen minutes in Next's data cache), never a query against the database
 * itself, so this never wakes a suspended (or merely sleeping) compute to answer it. Never fails
 * health on its own: unconfigured, refused or unreachable all read `ok` with no figures and the
 * level `unknown`.
 */
export type NeonQuotaHealth = {
  status: "ok" | "near-limit";
  quotaCuHours: number | null;
  usedCuHours: number | null;
  /** The whole percent of the quota spent, rounded, or null with no quota or no reading. */
  percent: number | null;
  /** The month's budget as the governor reads it (`domain/neon-budget.ts`). */
  level: NeonBudgetLevel;
};

export async function checkNeonQuotaHealth(
  env: NeonEnv,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<NeonQuotaHealth> {
  const read = await readNeonMeter(env, { fetchImpl, shared: true }, now);
  if (!read.ok) return { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, level: "unknown" };
  return quotaHealthOf(read.meter, now);
}

/** The health block from a meter already in hand — the route and the governor read one meter, not two. */
export function quotaHealthOf(meter: NeonMeter, now: Date): NeonQuotaHealth {
  const { quotaCuHours, usedCuHours } = meter;
  const ratio = neonQuotaRatio(usedCuHours, quotaCuHours);
  return {
    status: isNeonQuotaNearLimit(usedCuHours, quotaCuHours) ? "near-limit" : "ok",
    quotaCuHours,
    usedCuHours,
    percent: ratio === null ? null : Math.round(ratio * 100),
    level: neonBudget({ usedCuHours, quotaCuHours, periodStart: meter.periodStart, periodEnd: meter.periodEnd, now }).level,
  };
}

// --- The brakes (§335) ------------------------------------------------------------------------

/**
 * What a write needs back from the read besides the figures: the project's whole default compute
 * settings and whole quota, so a change to two keys sends every other key back as it was rather
 * than trusting a PATCH to leave the rest of a nested object alone.
 */
export type NeonLimitsSnapshot = {
  limits: NeonLimitsReading;
  raw: { defaults: Record<string, unknown>; quota: Record<string, unknown> };
};

/**
 * The project's brakes as Neon holds them (§335): the read-write computes' autoscaling range
 * (`GET /projects/{id}/endpoints`), the project's defaults for a compute created again and its
 * compute-time quota (`GET /projects/{id}`), both afresh, because a write starts from them. The
 * spend beside them is the meter's (§NNN) — the shared reading of the operations log and the
 * metered consumption, which never blocks the card: when neither answers, the row's own counter
 * stands in, as it always did.
 */
export async function readNeonLimits(
  env: NeonEnv,
  deps: NeonDeps = {},
  now: Date = new Date(),
): Promise<{ ok: true; snapshot: NeonLimitsSnapshot } | { ok: false; failure: NeonFailure }> {
  const missing = missingNeonVariables(env);
  if (missing.length > 0 || !env.NEON_API_KEY || !env.NEON_PROJECT_ID) return { ok: false, failure: { kind: "unconfigured", missing } };
  const configured = { NEON_API_KEY: env.NEON_API_KEY, NEON_PROJECT_ID: env.NEON_PROJECT_ID };
  const project = encodeURIComponent(env.NEON_PROJECT_ID);
  const fresh = { ...deps, shared: false };
  const [projectAnswer, endpointsAnswer] = await Promise.all([
    neonRequest(configured, `/projects/${project}`, { method: "GET" }, fresh),
    neonRequest(configured, `/projects/${project}/endpoints`, { method: "GET" }, fresh),
  ]);
  if (!projectAnswer.ok) return projectAnswer;
  if (!endpointsAnswer.ok) return endpointsAnswer;

  const row = isRecord(projectAnswer.body) && isRecord(projectAnswer.body.project) ? projectAnswer.body.project : null;
  const endpoints = isRecord(endpointsAnswer.body) && Array.isArray(endpointsAnswer.body.endpoints) ? endpointsAnswer.body.endpoints : null;
  if (!row || !endpoints || typeof row.consumption_period_end !== "string") return { ok: false, failure: { kind: "unexpected" } };

  const defaults = isRecord(row.default_endpoint_settings) ? row.default_endpoint_settings : {};
  const quota = isRecord(row.settings) && isRecord(row.settings.quota) ? row.settings.quota : {};
  const computes = endpoints.flatMap((endpoint) => {
    if (!isRecord(endpoint) || endpoint.type !== "read_write" || typeof endpoint.id !== "string") return [];
    const minCu = cuOrNull(endpoint.autoscaling_limit_min_cu);
    const maxCu = cuOrNull(endpoint.autoscaling_limit_max_cu);
    return minCu === null || maxCu === null ? [] : [{ id: endpoint.id, minCu, maxCu }];
  });
  const meter = await meterFromRow(configured, row, endpoints, { ...deps, shared: true }, now);

  return {
    ok: true,
    snapshot: {
      limits: {
        computes,
        defaults: { minCu: cuOrNull(defaults.autoscaling_limit_min_cu), maxCu: cuOrNull(defaults.autoscaling_limit_max_cu) },
        quotaCuHours: secondsToCuHours(quota.compute_time_seconds),
        usedCuHours: meter?.usedCuHours ?? (cuOrNull(row.compute_time_seconds) ?? 0) / 3600,
        activeHours: meter?.awakeHours ?? (cuOrNull(row.active_time_seconds) ?? 0) / 3600,
        periodEnd: new Date(row.consumption_period_end),
        reportedPlan: neonPlanFromSubscription(isRecord(row.owner) ? row.owner.subscription_type : undefined),
        usedSource: meter?.source ?? "legacy",
      },
      raw: { defaults, quota },
    },
  };
}

/**
 * Sets the brakes (§335): the project first — its defaults, so a compute created again inherits
 * the ceiling, and its quota, zero meaning none (Neon's own word for "no limit") — then every
 * read-write compute that is not already where it is asked to be. Nothing is sent that would not
 * change anything, so a save that changes only the limit starts no compute operation at all.
 *
 * Stops at the first refusal. `wrote` says what had already been applied by then, so the service
 * can tell "nothing changed" from "half of it did" — and it reads Neon again either way, because
 * what the card shows and the audit row records is Neon's answer, never this request.
 */
export async function writeNeonLimits(
  env: NeonEnv,
  current: NeonLimitsSnapshot,
  change: { maxCu: number; quotaCuHours: number | null },
  deps: NeonDeps = {},
): Promise<{ ok: true; wrote: string[] } | { ok: false; failure: NeonFailure; wrote: string[] }> {
  const missing = missingNeonVariables(env);
  if (missing.length > 0 || !env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
    return { ok: false, failure: { kind: "unconfigured", missing }, wrote: [] };
  }
  const configured = { NEON_API_KEY: env.NEON_API_KEY, NEON_PROJECT_ID: env.NEON_PROJECT_ID };
  const project = encodeURIComponent(env.NEON_PROJECT_ID);
  const { limits, raw } = current;
  const wrote: string[] = [];

  const defaultsChange =
    limits.defaults.minCu !== NEON_MIN_CU || limits.defaults.maxCu !== change.maxCu
      ? { default_endpoint_settings: { ...raw.defaults, autoscaling_limit_min_cu: NEON_MIN_CU, autoscaling_limit_max_cu: change.maxCu } }
      : {};
  const quotaChange =
    cuHoursToSeconds(limits.quotaCuHours) !== cuHoursToSeconds(change.quotaCuHours)
      ? { settings: { quota: { ...raw.quota, compute_time_seconds: cuHoursToSeconds(change.quotaCuHours) } } }
      : {};
  if (Object.keys(defaultsChange).length > 0 || Object.keys(quotaChange).length > 0) {
    const answer = await neonRequest(configured, `/projects/${project}`, { method: "PATCH", body: { project: { ...defaultsChange, ...quotaChange } } }, deps);
    if (!answer.ok) return { ok: false, failure: answer.failure, wrote };
    wrote.push("project");
  }

  for (const compute of limits.computes) {
    if (compute.minCu === NEON_MIN_CU && compute.maxCu === change.maxCu) continue;
    const answer = await neonRequest(
      configured,
      `/projects/${project}/endpoints/${encodeURIComponent(compute.id)}`,
      { method: "PATCH", body: { endpoint: { autoscaling_limit_min_cu: NEON_MIN_CU, autoscaling_limit_max_cu: change.maxCu } } },
      deps,
    );
    if (!answer.ok) return { ok: false, failure: answer.failure, wrote };
    wrote.push(`endpoint:${compute.id}`);
  }
  return { ok: true, wrote };
}
