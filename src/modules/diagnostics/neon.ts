import type { Env } from "@/shared/config/env";
import {
  cuHoursToSeconds,
  isNeonQuotaNearLimit,
  NEON_MIN_CU,
  type NeonLimitsReading,
  neonQuotaRatio,
  secondsToCuHours,
} from "./domain/neon-limits";
import { NEON_PLANS, type NeonPlanId, neonPlanFromSubscription } from "./domain/neon-plan";

/** Neon's API, the one third-party host this module talks to (`scripts/docs-check.mjs` lists it). */
const NEON_API = "https://console.neon.tech/api/v2";

/**
 * The database's consumption this billing period, read from Neon (BR-REQ-090-07).
 *
 * What the figure means depends on the plan the club states (`domain/neon-plan.ts`): on Free
 * it is counted against 100 CU-hours a month per project and the compute is *suspended* when
 * they run out — the site is down until the next month; on Launch the same hours are billed
 * at the catalogue rate. A compute pinged every five minutes never sleeps and spends 180
 * CU-hours a month, which is how QA had used 74 by the 18th of September 2026 — a cutoff on
 * Free and a bill on Launch, which is why the cadence stayed (§280). `/devs` shows the
 * figure when the two variables are set (SETUP.md §33). Optional: without them the panel says
 * so and nothing else changes.
 *
 * One request, a short timeout, and a sentence on failure — a diagnostics page that hangs on
 * a third party is worse than one that says "Neon did not answer".
 *
 * The same row names the plan of the account that owns the project (`owner.subscription_type`),
 * so the answer carries it too (§326) and the pages stop depending on somebody remembering to
 * state it.
 */
/** Free's monthly compute allowance, from the one catalogue; kept under its old name for the callers that read it. */
export const NEON_FREE_CU_HOURS = NEON_PLANS.FREE.cuHoursPerMonth as number;

export type NeonConsumption = {
  cuHours: number;
  activeHours: number;
  periodStart: Date;
  periodEnd: Date;
  /** The plan Neon reports for the owning account, or null when it names one this code does not know. */
  reportedPlan: NeonPlanId | null;
  /** The period's compute-time limit in CU-hours (§NNN), or null when there is none (absent or zero). */
  quotaCuHours: number | null;
};

/**
 * The one project row `readNeonConsumption` and `checkNeonQuotaHealth` both read — every field
 * either has ever needed, in one shape, so a third reader cannot invent a second one.
 */
type NeonProjectRow = {
  compute_time_seconds?: number;
  active_time_seconds?: number;
  consumption_period_start?: string;
  consumption_period_end?: string;
  owner?: { subscription_type?: string };
  settings?: { quota?: { compute_time_seconds?: number } };
};

/** The quota and this period's spend, read off the row the same one way everywhere (§NNN). */
function neonQuotaReading(project: NeonProjectRow): { quotaCuHours: number | null; usedCuHours: number } {
  return {
    quotaCuHours: secondsToCuHours(project.settings?.quota?.compute_time_seconds),
    usedCuHours: (project.compute_time_seconds ?? 0) / 3600,
  };
}

/**
 * The one request `readNeonConsumption` and `checkNeonQuotaHealth` both make to Neon — same URL,
 * same headers, same five-second timeout — so a cache option is the only way they can ever
 * differ, rather than each keeping its own copy of the request that could quietly drift apart.
 */
async function fetchNeonProjectRow(
  env: Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">,
  fetchImpl: typeof fetch,
  cacheInit: { cache: "no-store" } | { next: { revalidate: number } },
): Promise<{ ok: true; project: NeonProjectRow } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(`${NEON_API}/projects/${env.NEON_PROJECT_ID}`, {
      headers: { authorization: `Bearer ${env.NEON_API_KEY}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      ...cacheInit,
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = (await response.json()) as { project?: NeonProjectRow };
    if (!body.project) return { ok: false, reason: "unexpected answer" };
    return { ok: true, project: body.project };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : String(error) };
  }
}

export async function readNeonConsumption(
  env: Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; consumption: NeonConsumption } | { ok: false; reason: "unconfigured" | string }> {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return { ok: false, reason: "unconfigured" };
  const row = await fetchNeonProjectRow(env, fetchImpl, { cache: "no-store" });
  if (!row.ok) return row;
  const { project } = row;
  if (!project.consumption_period_start || !project.consumption_period_end) {
    return { ok: false, reason: "unexpected answer" };
  }
  const reading = neonQuotaReading(project);
  return {
    ok: true,
    consumption: {
      cuHours: reading.usedCuHours,
      activeHours: (project.active_time_seconds ?? 0) / 3600,
      periodStart: new Date(project.consumption_period_start),
      periodEnd: new Date(project.consumption_period_end),
      reportedPlan: neonPlanFromSubscription(project.owner?.subscription_type),
      quotaCuHours: reading.quotaCuHours,
    },
  };
}

/** How long `/api/health`'s own reading of the quota is kept, so a monitor's ping does not put a Neon request behind every one of them. */
const NEON_HEALTH_CACHE_SECONDS = 900;

/**
 * `/api/health`'s early warning for a project's monthly compute-time quota (§NNN): once this
 * period's spend reaches 80% of it (`NEON_QUOTA_WARNING_RATIO`), health degrades before Neon
 * suspends the database at 100% — a suspension is total, every page down until the next billing
 * period, and the 503 is the one channel a monitor still reads once email is among what stopped.
 *
 * This supersedes BR-REQ-090-07 criterion 5's "`/api/health` reads no Neon figure" for the quota
 * case only: that line was about the *plan*, which is a setting nobody would notice go stale;
 * a quota is a suspension the owner asked to be warned of before it lands (`DECISIONS.md` §NNN).
 *
 * Cached for fifteen minutes in Next's Data Cache (`next: { revalidate }`) rather than the
 * admin panel's `no-store` — the monitors ping every fifteen minutes by day on production and
 * hourly on QA, and an Administrator reading the Costuri panel wants this second's figure, but a
 * monitor reads the same number whichever minute inside the window it asks. The same console API
 * request as `readNeonConsumption`'s, never a query against the database itself, so this never
 * wakes a suspended (or merely sleeping) compute to answer it.
 *
 * Never fails health on its own: unconfigured, refused or unreachable all read `ok` with no
 * figures — a monitor woken by a key nobody meant to set on this environment, or by Neon's API
 * having a bad minute, would be a false alarm about a warning that already has its own row on
 * `/admin/tasks` (`owner-tasks.ts`).
 */
export type NeonQuotaHealth = {
  status: "ok" | "near-limit";
  quotaCuHours: number | null;
  usedCuHours: number | null;
  /** The whole percent of the quota spent, rounded, or null with no quota or no reading. */
  percent: number | null;
};

export async function checkNeonQuotaHealth(
  env: Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">,
  fetchImpl: typeof fetch = fetch,
): Promise<NeonQuotaHealth> {
  const unavailable: NeonQuotaHealth = { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null };
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return unavailable;
  const row = await fetchNeonProjectRow(env, fetchImpl, { next: { revalidate: NEON_HEALTH_CACHE_SECONDS } });
  if (!row.ok) return unavailable;
  const { quotaCuHours, usedCuHours } = neonQuotaReading(row.project);
  const ratio = neonQuotaRatio(usedCuHours, quotaCuHours);
  return {
    status: isNeonQuotaNearLimit(usedCuHours, quotaCuHours) ? "near-limit" : "ok",
    quotaCuHours,
    usedCuHours,
    percent: ratio === null ? null : Math.round(ratio * 100),
  };
}

/**
 * Why a request to Neon gave nothing this code can use — each kind is one sentence on the card
 * and one refusal code on the form (§NNN), never a stack or Neon's own error text.
 *
 * `forbidden` is the one worth its own word: a key that reads the figures and may not change
 * them (a Viewer's, or an organization key without Editor on the project) answers 401 or 403 to
 * the write while every read above it worked, and the sentence has to say which key is needed.
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

/** What the limits functions can be handed instead of the real world: a fetch, a clock to wait on, a shorter timeout. */
export type NeonDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

/** The same bound as the consumption read: a page that waits on a third party waits five seconds at most. */
export const NEON_TIMEOUT_MS = 5_000;

/**
 * How long to wait before asking again when Neon answers 423 Locked — "another operation is
 * running on this project", which the endpoint change itself starts. Neon's guidance is to retry
 * with a growing delay; three tries inside two and a half seconds keep a save well inside a
 * serverless request's budget.
 */
export const NEON_LOCKED_RETRY_MS = [300, 700, 1_500] as const;

type NeonEnv = Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">;

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
 * write that meets 423 Locked is asked again after `NEON_LOCKED_RETRY_MS`; a read never is.
 */
async function neonRequest(
  env: Required<NeonEnv>,
  path: string,
  init: { method: "GET" } | { method: "PATCH"; body: unknown },
  deps: NeonDeps,
): Promise<{ ok: true; body: unknown } | { ok: false; failure: NeonFailure }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays: readonly number[] = init.method === "PATCH" ? NEON_LOCKED_RETRY_MS : [];
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
        cache: "no-store",
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
 * The project's brakes as Neon holds them (§NNN): the read-write computes' autoscaling range
 * (`GET /projects/{id}/endpoints`), the project's defaults for a compute created again and its
 * compute-time quota, with this period's consumption (`GET /projects/{id}`). Two requests, side
 * by side, each bounded like the consumption read.
 */
export async function readNeonLimits(
  env: NeonEnv,
  deps: NeonDeps = {},
): Promise<{ ok: true; snapshot: NeonLimitsSnapshot } | { ok: false; failure: NeonFailure }> {
  const missing = missingNeonVariables(env);
  if (missing.length > 0 || !env.NEON_API_KEY || !env.NEON_PROJECT_ID) return { ok: false, failure: { kind: "unconfigured", missing } };
  const configured = { NEON_API_KEY: env.NEON_API_KEY, NEON_PROJECT_ID: env.NEON_PROJECT_ID };
  const project = encodeURIComponent(env.NEON_PROJECT_ID);
  const [projectAnswer, endpointsAnswer] = await Promise.all([
    neonRequest(configured, `/projects/${project}`, { method: "GET" }, deps),
    neonRequest(configured, `/projects/${project}/endpoints`, { method: "GET" }, deps),
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

  return {
    ok: true,
    snapshot: {
      limits: {
        computes,
        defaults: { minCu: cuOrNull(defaults.autoscaling_limit_min_cu), maxCu: cuOrNull(defaults.autoscaling_limit_max_cu) },
        quotaCuHours: secondsToCuHours(quota.compute_time_seconds),
        usedCuHours: (cuOrNull(row.compute_time_seconds) ?? 0) / 3600,
        activeHours: (cuOrNull(row.active_time_seconds) ?? 0) / 3600,
        periodEnd: new Date(row.consumption_period_end),
        reportedPlan: neonPlanFromSubscription(isRecord(row.owner) ? row.owner.subscription_type : undefined),
      },
      raw: { defaults, quota },
    },
  };
}

/**
 * Sets the brakes (§NNN): the project first — its defaults, so a compute created again inherits
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
