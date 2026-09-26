/**
 * What Neon meters for this project's billing period, read three ways and kept apart (§447) —
 * pure, so the arithmetic is a test rather than a hope.
 *
 * The re-measure of 2026-09-26 (`docs/QUEUE.md`, "Neon: re-measure after the first quiet night")
 * found the one figure every screen read, the project row's `compute_time_seconds`, frozen since
 * 2026-09-24 around noon: Neon's documentation lists it as a legacy-plan metric, and it still said
 * 9.03 CU-hours on production against 16.48 metered. The screens ran about 45% under the month,
 * and §335's 80% warning could never fire. Three sources answer the question now, and the page
 * says which one it used:
 *
 * - **metered** — `compute_unit_seconds` from `GET /consumption_history/v2/projects`, the figure
 *   Neon bills. It needs a key that may read the organisation: a project-scoped key, the kind
 *   `SETUP.md` §33 hands out, is refused ("not allowed to perform actions outside the project
 *   this key is scoped to", checked 2026-09-26). Neon updates it about every fifteen minutes.
 * - **operations** — the project's own operations log, which a project-scoped key may read: the
 *   time between each `start_compute` and the `suspend_compute` after it, times the compute's
 *   floor. On a compute that idles at its floor — both of the club's, measured at 0.25–0.26 CU
 *   while awake (§327) — that is the metered figure to within a percent (QA on 2026-09-26: 8.10
 *   from the log against 8.18 metered). It can only undercount: a compute that scaled up for a
 *   while spent more than its floor.
 * - **legacy** — the project row's `compute_time_seconds`, kept because it is free (the row is
 *   read anyway) and because it is what Neon's quota may still be counted against; nobody could
 *   find out which (the report of 2026-09-26).
 *
 * The figure every page and the governor use is the **larger** of the two live sources that
 * answered. Each is a lower bound of the truth in its own way (the metered one lags a quarter of
 * an hour, the log counts only the floor), so the larger is the closer, and a quota is the one
 * number where reading low is the dangerous direction. The legacy counter is a labelled fallback
 * only, used when neither live source answered (`pickMeterReading`).
 */

export type NeonMeterSource = "metered" | "operations" | "legacy";

/** One operation off `GET /projects/{id}/operations`, only the fields the arithmetic reads. */
export type NeonOperation = { action: string; status: string; created_at: string; updated_at?: string; endpoint_id?: string | null };

/**
 * How long the compute was awake inside `[periodStart, now]`, in seconds, from the operations log
 * — or null when the log does not reach back to the period's start and so cannot say.
 *
 * - Only finished `start_compute` and `suspend_compute` count; a configuration change, a replica
 *   or a failed start wakes nothing billable.
 * - An operation's own end (`updated_at`) is when the compute was actually up or down.
 * - A suspension with no start before it inside the log began before the log does: the compute
 *   was already awake at the period's start (or at the log's oldest entry, if later).
 * - A start with no suspension after it is still awake: it counts up to `now`.
 * - Each compute (`endpoint_id`) is its own timeline, summed at the end.
 * - `reachesPeriodStart` is the caller's knowledge that the pages it read go back past the
 *   period's start. Without it the oldest wakes are missing, and a figure that silently dropped
 *   them would read low — so it is null, and the other sources answer.
 */
export function awakeSecondsFromOperations(
  operations: readonly NeonOperation[],
  periodStart: Date,
  now: Date,
  reachesPeriodStart: boolean,
): number | null {
  if (!reachesPeriodStart) return null;
  // Per compute: a second endpoint (a branch's, a migration's) has its own starts and suspensions,
  // and one timeline across both would merge overlapping wakes and read low. Operations with no
  // endpoint named are grouped together, as the one read-write compute they almost always are.
  const byEndpoint = new Map<string, NeonOperation[]>();
  for (const op of operations) {
    const key = typeof op.endpoint_id === "string" ? op.endpoint_id : "";
    const list = byEndpoint.get(key);
    if (list) list.push(op);
    else byEndpoint.set(key, [op]);
  }
  let total = 0;
  for (const list of byEndpoint.values()) total += awakeSecondsOfOneCompute(list, periodStart, now);
  return total;
}

function awakeSecondsOfOneCompute(operations: readonly NeonOperation[], periodStart: Date, now: Date): number {
  const start = periodStart.getTime();
  const end = now.getTime();
  const events = operations
    .filter((op) => op.status === "finished" && (op.action === "start_compute" || op.action === "suspend_compute"))
    .map((op) => ({ up: op.action === "start_compute", at: Date.parse(op.updated_at ?? op.created_at) }))
    .filter((event) => Number.isFinite(event.at) && event.at <= end)
    .sort((a, b) => a.at - b.at);

  let awakeMs = 0;
  let upSince: number | null = null;
  let seenAny = false;
  for (const event of events) {
    if (event.up) {
      if (upSince === null) upSince = event.at;
    } else {
      // A suspension first thing: the compute was up before the log began.
      const from = upSince ?? (seenAny ? null : start);
      if (from !== null) awakeMs += Math.max(0, event.at - Math.max(from, start));
      upSince = null;
    }
    seenAny = true;
  }
  if (upSince !== null) awakeMs += Math.max(0, end - Math.max(upSince, start));
  return awakeMs / 1000;
}

/**
 * The metered `compute_unit_seconds` of this billing period, from the consumption answer, or null
 * when the answer has none for this project.
 *
 * The answer groups by billing period (`period_start`) and then by day; a day may straddle two
 * periods and appears under each. Only the periods that began at or after this one's start (less
 * a minute, for the second Neon rounds) are this period's, and inside them every entry counts.
 */
export function meteredCuSeconds(body: unknown, projectId: string, periodStart: Date): number | null {
  const projects = isRecord(body) && Array.isArray(body.projects) ? body.projects : null;
  if (!projects) return null;
  const project = projects.find((candidate) => isRecord(candidate) && candidate.project_id === projectId);
  if (!isRecord(project) || !Array.isArray(project.periods)) return null;
  const from = periodStart.getTime() - 60_000;
  let seconds = 0;
  let found = false;
  for (const period of project.periods) {
    if (!isRecord(period) || typeof period.period_start !== "string" || Date.parse(period.period_start) < from) continue;
    if (!Array.isArray(period.consumption)) continue;
    for (const entry of period.consumption) {
      if (!isRecord(entry) || !Array.isArray(entry.metrics)) continue;
      for (const metric of entry.metrics) {
        if (isRecord(metric) && metric.metric_name === "compute_unit_seconds" && typeof metric.value === "number" && Number.isFinite(metric.value)) {
          seconds += metric.value;
          found = true;
        }
      }
    }
  }
  return found ? seconds : null;
}

/**
 * The three readings, and the one the pages use: the larger of the two live sources that answered
 * — `metered` and `operations` — and the legacy counter **only when neither did**, labelled as
 * such. The counter stopped updating on 2026-09-24 and nobody knows whether it resets when a
 * period turns; letting a frozen figure compete as an equal would, on the first day of a period,
 * read a whole month's pace off one day and throttle (or pause) the jobs for nothing. It stays on
 * the meter as a displayed third reading.
 */
export function pickMeterReading(readings: { metered: number | null; operations: number | null; legacy: number }): {
  usedCuHours: number;
  source: NeonMeterSource;
} {
  const candidates: Array<[NeonMeterSource, number | null]> = [
    ["metered", readings.metered],
    ["operations", readings.operations],
  ];
  let best: { usedCuHours: number; source: NeonMeterSource } | null = null;
  for (const [source, value] of candidates) {
    // Strictly larger only, so a tie goes to the better-founded source: the order above.
    if (value !== null && Number.isFinite(value) && (best === null || value > best.usedCuHours)) best = { usedCuHours: value, source };
  }
  if (best) return best;
  return { usedCuHours: Number.isFinite(readings.legacy) ? readings.legacy : 0, source: "legacy" };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
