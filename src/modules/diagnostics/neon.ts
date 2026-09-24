import type { Env } from "@/shared/config/env";
import { NEON_PLANS, type NeonPlanId, neonPlanFromSubscription } from "./domain/neon-plan";

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
        owner?: { subscription_type?: string };
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
        reportedPlan: neonPlanFromSubscription(project.owner?.subscription_type),
      },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : String(error) };
  }
}
