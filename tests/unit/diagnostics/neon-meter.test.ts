import { beforeEach, describe, expect, it } from "vitest";
import { awakeSecondsFromOperations, meteredCuSeconds, pickMeterReading } from "@/modules/diagnostics/domain/neon-meter";
import { forgetNeonConsumptionRefusals, NEON_CONSUMPTION_REFUSAL_MS, readNeonConsumption, readNeonLimits, readNeonMeter } from "@/modules/diagnostics/neon";
import { FAKE_PROJECT_ID, fakeNeon, NEON_ENV, productionLikeState } from "../../helpers/fake-neon";

/**
 * BR-REQ-090-07 (§NNN) — the one reader: what Neon meters for the period, three ways.
 *
 * The re-measure of 2026-09-26 found every screen reading the project row's `compute_time_seconds`,
 * frozen since 2026-09-24 (9.03 CU-hours shown against 16.48 metered on production), so §335's
 * 80% warning could never fire. These pin the arithmetic of the two sources that replaced it and
 * the rule that picks between the three.
 */
const PERIOD_START = new Date("2026-09-22T07:00:00.000Z");
const NOW = new Date("2026-09-26T07:30:00.000Z");
const op = (action: string, at: string, status = "finished") => ({ action, status, created_at: at, updated_at: at });

describe("§NNN awake time from the operations log", () => {
  it("adds up every start-to-suspend inside the period, and counts a compute still up to now", () => {
    const operations = [
      op("start_compute", "2026-09-26T07:00:00Z"), // still up at NOW: 30 minutes
      op("suspend_compute", "2026-09-25T10:05:00Z"),
      op("apply_config", "2026-09-25T10:02:00Z"), // not a wake
      op("start_compute", "2026-09-25T10:00:00Z"), // 5 minutes
      op("suspend_compute", "2026-09-22T06:30:00Z"),
      op("start_compute", "2026-09-22T06:00:00Z"), // before the period: nothing
    ];
    expect(awakeSecondsFromOperations(operations, PERIOD_START, NOW, true)).toBe(35 * 60);
  });

  it("clips a wake that straddles the period's start at the start", () => {
    const operations = [op("suspend_compute", "2026-09-22T07:10:00Z"), op("start_compute", "2026-09-22T06:55:00Z")];
    expect(awakeSecondsFromOperations(operations, PERIOD_START, NOW, true)).toBe(10 * 60);
  });

  it("reads a suspension with no start before it as a compute already up when the log begins", () => {
    // The log (as read) starts inside the period with a suspension: up from the period's start.
    const operations = [op("suspend_compute", "2026-09-22T07:20:00Z")];
    expect(awakeSecondsFromOperations(operations, PERIOD_START, NOW, true)).toBe(20 * 60);
  });

  it("ignores a start or a suspension that did not finish", () => {
    const operations = [op("suspend_compute", "2026-09-25T10:05:00Z"), op("start_compute", "2026-09-25T10:00:00Z", "failed")];
    // Without the failed start, the suspension reads as the end of a wake that began at the period's start.
    expect(awakeSecondsFromOperations(operations, PERIOD_START, NOW, true)).toBe((Date.parse("2026-09-25T10:05:00Z") - PERIOD_START.getTime()) / 1000);
  });

  it("says nothing when the log does not reach back to the period's start — a figure missing its oldest wakes would read low", () => {
    expect(awakeSecondsFromOperations([op("start_compute", "2026-09-26T07:00:00Z")], PERIOD_START, NOW, false)).toBeNull();
  });
});

describe("§NNN the metered figure from the consumption endpoint", () => {
  const body = {
    projects: [
      {
        project_id: FAKE_PROJECT_ID,
        periods: [
          // The period before this one, on the same first day: not ours.
          { period_start: "2026-08-22T07:00:00Z", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 9_999 }] }] },
          {
            period_start: "2026-09-22T07:00:00Z",
            consumption: [
              { metrics: [{ metric_name: "compute_unit_seconds", value: 3_600 }, { metric_name: "public_network_transfer_bytes", value: 5 }] },
              { metrics: [{ metric_name: "compute_unit_seconds", value: 1_800 }] },
            ],
          },
        ],
      },
      { project_id: "another-project", periods: [{ period_start: "2026-09-22T07:00:00Z", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 100_000 }] }] }] },
    ],
  };

  it("sums compute_unit_seconds over this period's days, for this project alone", () => {
    expect(meteredCuSeconds(body, FAKE_PROJECT_ID, PERIOD_START)).toBe(5_400);
  });

  it("is null for an answer with nothing for this project, or not an answer at all", () => {
    expect(meteredCuSeconds(body, "missing", PERIOD_START)).toBeNull();
    expect(meteredCuSeconds({ message: "no" }, FAKE_PROJECT_ID, PERIOD_START)).toBeNull();
    expect(meteredCuSeconds(null, FAKE_PROJECT_ID, PERIOD_START)).toBeNull();
  });
});

describe("§NNN awake time per compute", () => {
  it("sums each endpoint's own timeline, so two computes awake at once are not merged into one", () => {
    const at = (iso: string, action: string, endpoint: string) => ({ ...op(action, iso), endpoint_id: endpoint });
    const operations = [
      at("2026-09-25T12:00:00Z", "suspend_compute", "ep-main"),
      at("2026-09-25T11:00:00Z", "suspend_compute", "ep-branch"),
      at("2026-09-25T10:30:00Z", "start_compute", "ep-branch"),
      at("2026-09-25T10:00:00Z", "start_compute", "ep-main"),
    ];
    // Two hours on the main compute, half an hour on the branch's, overlapping.
    expect(awakeSecondsFromOperations(operations, PERIOD_START, NOW, true)).toBe(2.5 * 3600);
  });
});

describe("§NNN which reading the pages use", () => {
  it("takes the larger of the two live sources that answered, and says which", () => {
    // Production on 2026-09-26: the frozen counter at 9.03 against 16.48 metered.
    expect(pickMeterReading({ metered: 16.48, operations: 16.2, legacy: 9.03 })).toEqual({ usedCuHours: 16.48, source: "metered" });
    // A project-scoped key: no metered figure; the log wins over the frozen counter.
    expect(pickMeterReading({ metered: null, operations: 8.1, legacy: 5.42 })).toEqual({ usedCuHours: 8.1, source: "operations" });
    // Nothing but the counter: the counter, as before.
    expect(pickMeterReading({ metered: null, operations: null, legacy: 5.42 })).toEqual({ usedCuHours: 5.42, source: "legacy" });
    // A tie goes to the better-founded source.
    expect(pickMeterReading({ metered: 3, operations: 3, legacy: 3 }).source).toBe("metered");
  });

  it("never lets the frozen legacy counter outbid a live source, however large it is", () => {
    // 1 October, a counter that did not reset: 9.03 frozen against a first day of 0.4 from the log.
    expect(pickMeterReading({ metered: null, operations: 0.4, legacy: 9.03 })).toEqual({ usedCuHours: 0.4, source: "operations" });
    expect(pickMeterReading({ metered: 1.2, operations: null, legacy: 99 })).toEqual({ usedCuHours: 1.2, source: "metered" });
  });
});

describe("§NNN readNeonMeter — the one reader", () => {
  beforeEach(() => forgetNeonConsumptionRefusals());

  it("remembers a project-scoped key's refusal of the consumption endpoint, for the shared reading only", async () => {
    const state = productionLikeState({ quotaCuHours: 100 });
    state.project.org_id = "org-example";
    const neon = fakeNeon(state);
    const consumptionCalls = () => neon.calls.filter((call) => call.path === "/consumption_history/v2/projects").length;

    await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch, shared: true }, NOW);
    await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch, shared: true }, new Date(NOW.getTime() + 60_000));
    expect(consumptionCalls()).toBe(1);
    // A direct read always asks; the shared one asks again once the refusal is old.
    await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch }, NOW);
    expect(consumptionCalls()).toBe(2);
    await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch, shared: true }, new Date(NOW.getTime() + NEON_CONSUMPTION_REFUSAL_MS));
    expect(consumptionCalls()).toBe(3);
  });

  it("prices the awake time at the compute's floor when the key may not read the organisation's consumption", async () => {
    const state = productionLikeState({ usedCuHours: 5.42, quotaCuHours: 30 });
    state.project.consumption_period_start = "2026-09-22T07:00:00Z";
    state.project.org_id = "org-example";
    // Eight hours awake since the period began, in one long wake.
    state.operations = [op("suspend_compute", "2026-09-25T18:00:00Z"), op("start_compute", "2026-09-25T10:00:00Z"), op("suspend_compute", "2026-09-20T10:00:00Z")];
    const neon = fakeNeon(state);

    const read = await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch }, NOW);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.meter.operationsCuHours).toBeCloseTo(8 * 0.25, 5);
    expect(read.meter.meteredCuHours).toBeNull();
    expect(read.meter.legacyCuHours).toBeCloseTo(5.42, 2);
    // The frozen 5.42 is shown, never used while the log answers: 2.0 is the figure.
    expect(read.meter.source).toBe("operations");
    expect(read.meter.usedCuHours).toBeCloseTo(2, 5);
    expect(read.meter.awakeHours).toBeCloseTo(8, 5);
    expect(read.meter.quotaCuHours).toBe(30);
    // The consumption endpoint was asked — the key might have been an organisation's — and refused.
    expect(neon.calls.some((call) => call.path === "/consumption_history/v2/projects")).toBe(true);
  });

  it("uses the metered figure when Neon gives it, asking for this period, this project and the one metric", async () => {
    const state = productionLikeState({ usedCuHours: 9.03, quotaCuHours: 100 });
    state.project.consumption_period_start = "2026-09-22T07:00:00Z";
    state.project.org_id = "org-example";
    state.consumption = {
      projects: [{ project_id: FAKE_PROJECT_ID, periods: [{ period_start: "2026-09-22T07:00:00Z", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 16.48 * 3600 }] }] }] }],
    };
    const seen: URL[] = [];
    const neon = fakeNeon(state, (call) => {
      if (call.path === "/consumption_history/v2/projects") seen.push(new URL(`https://x${call.path}`));
      return undefined;
    });
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      return neon.fetch(input, init);
    }) as typeof fetch;

    const read = await readNeonMeter(NEON_ENV, { fetchImpl }, NOW);
    expect(read.ok && read.meter.usedCuHours).toBeCloseTo(16.48, 2);
    expect(read.ok && read.meter.source).toBe("metered");

    const consumption = new URL(urls.find((url) => url.includes("/consumption_history/v2/projects")) ?? "https://none");
    expect(consumption.searchParams.get("org_id")).toBe("org-example");
    expect(consumption.searchParams.get("project_ids")).toBe(FAKE_PROJECT_ID);
    expect(consumption.searchParams.get("metrics")).toBe("compute_unit_seconds");
    expect(consumption.searchParams.get("granularity")).toBe("daily");
    expect(consumption.searchParams.get("from")).toBe("2026-09-22T07:00:00.000Z");
    // Stable for the whole day, so a shared reading stays one cache entry.
    expect(consumption.searchParams.get("to")).toBe("2026-09-27T00:00:00.000Z");
    expect(seen).toHaveLength(1);
  });

  it("walks the operations log back page by page until it passes the period's start", async () => {
    const state = productionLikeState();
    state.project.consumption_period_start = "2026-09-22T07:00:00Z";
    // 2 400 operations, one wake of a minute every 5 minutes, newest first, back past the start.
    const operations: Array<{ action: string; status: string; created_at: string; updated_at: string }> = [];
    for (let index = 0; index < 1_200; index += 1) {
      const start = NOW.getTime() - (index + 1) * 5 * 60_000;
      operations.push(op("suspend_compute", new Date(start + 60_000).toISOString()), op("start_compute", new Date(start).toISOString()));
    }
    state.operations = operations;
    const neon = fakeNeon(state);

    const read = await readNeonMeter(NEON_ENV, { fetchImpl: neon.fetch }, NOW);
    const pages = neon.calls.filter((call) => call.path.endsWith("/operations"));
    expect(pages.length).toBe(3);
    // Every wake since the period's start, a minute each.
    const wakes = Math.floor((NOW.getTime() - PERIOD_START.getTime()) / (5 * 60_000));
    expect(read.ok && read.meter.awakeHours).toBeCloseTo(wakes / 60, 1);
  });

  it("fails only when the project row itself cannot be read — the log and the consumption are extras", async () => {
    const refused = await readNeonMeter(NEON_ENV, { fetchImpl: fakeNeon(productionLikeState(), () => new Response("", { status: 403 })).fetch }, NOW);
    expect(refused).toEqual({ ok: false, failure: { kind: "forbidden", status: 403 } });

    const unconfigured = await readNeonMeter({ NEON_API_KEY: undefined, NEON_PROJECT_ID: undefined }, {}, NOW);
    expect(unconfigured).toEqual({ ok: false, failure: { kind: "unconfigured", missing: ["NEON_API_KEY", "NEON_PROJECT_ID"] } });
  });

  it("is the figure every screen reads: the consumption, the limits card", async () => {
    const state = productionLikeState({ usedCuHours: 1, quotaCuHours: 100 });
    state.project.consumption_period_start = "2026-09-22T07:00:00Z";
    state.operations = [op("suspend_compute", "2026-09-26T07:00:00Z"), op("start_compute", "2026-09-22T08:00:00Z"), op("suspend_compute", "2026-09-21T00:00:00Z")];
    const expected = ((Date.parse("2026-09-26T07:00:00Z") - Date.parse("2026-09-22T08:00:00Z")) / 3_600_000) * 0.25;

    const consumption = await readNeonConsumption(NEON_ENV, fakeNeon(state).fetch, NOW);
    expect(consumption.ok && consumption.consumption.cuHours).toBeCloseTo(expected, 5);
    expect(consumption.ok && consumption.consumption.meter.source).toBe("operations");

    const limits = await readNeonLimits(NEON_ENV, { fetchImpl: fakeNeon(state).fetch }, NOW);
    expect(limits.ok && limits.snapshot.limits.usedCuHours).toBeCloseTo(expected, 5);
    expect(limits.ok && limits.snapshot.limits.usedSource).toBe("operations");
  });
});
