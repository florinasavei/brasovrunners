import type { Env } from "@/shared/config/env";

/**
 * The database's consumption this billing period, read from Neon (BR-REQ-090-07).
 *
 * The Free plan gives 100 CU-hours a month per project and *suspends the compute* when they
 * run out — the site is down until the next month. A compute pinged every five minutes never
 * sleeps and spends 180 CU-hours a month, which is how QA had used 74 by the 18th of
 * September 2026. This is the figure to watch, and `/devs` shows it when the two variables
 * are set (SETUP.md §33). Optional: without them the panel says so and nothing else changes.
 *
 * One request, a short timeout, and a sentence on failure — a diagnostics page that hangs on
 * a third party is worse than one that says "Neon did not answer".
 */
export const NEON_FREE_CU_HOURS = 100;

export type NeonConsumption = {
  cuHours: number;
  activeHours: number;
  periodStart: Date;
  periodEnd: Date;
};

export async function readNeonConsumption(
  env: Pick<Env, "NEON_API_KEY" | "NEON_PROJECT_ID">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; consumption: NeonConsumption } | { ok: false; reason: "unconfigured" | string }> {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return { ok: false, reason: "unconfigured" };
  try {
    const response = await fetchImpl(`https://console.neon.tech/api/v2/projects/${env.NEON_PROJECT_ID}`, {
      headers: { authorization: `Bearer ${env.NEON_API_KEY}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = (await response.json()) as {
      project?: {
        compute_time_seconds?: number;
        active_time_seconds?: number;
        consumption_period_start?: string;
        consumption_period_end?: string;
      };
    };
    const project = body.project;
    if (!project?.consumption_period_start || !project.consumption_period_end) {
      return { ok: false, reason: "unexpected answer" };
    }
    return {
      ok: true,
      consumption: {
        cuHours: (project.compute_time_seconds ?? 0) / 3600,
        activeHours: (project.active_time_seconds ?? 0) / 3600,
        periodStart: new Date(project.consumption_period_start),
        periodEnd: new Date(project.consumption_period_end),
      },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : String(error) };
  }
}
