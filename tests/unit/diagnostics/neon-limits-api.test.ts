import { describe, expect, it } from "vitest";
import { NEON_LOCKED_RETRY_MS, readNeonLimits, writeNeonLimits } from "@/modules/diagnostics/neon";
import { FAKE_PROJECT_ID, fakeNeon, instantSleep, NEON_ENV, productionLikeState } from "../../helpers/fake-neon";

/**
 * BR-REQ-090-07 criteria 8 and 10 (§335) — the Neon client behind "Limitele bazei de date": what it
 * asks Neon, what it makes of the answer, and the sentence-sized failure it returns instead of a
 * throw. Every request goes to the in-memory fake; nothing here reaches Neon.
 */
describe("BR-REQ-090-07 readNeonLimits — the brakes as Neon holds them", () => {
  it("names what is missing and calls nothing without the two variables", async () => {
    const never = (() => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    expect(await readNeonLimits({ NEON_API_KEY: undefined, NEON_PROJECT_ID: undefined }, { fetchImpl: never })).toEqual({
      ok: false,
      failure: { kind: "unconfigured", missing: ["NEON_API_KEY", "NEON_PROJECT_ID"] },
    });
    expect(await readNeonLimits({ NEON_API_KEY: "k", NEON_PROJECT_ID: undefined }, { fetchImpl: never })).toEqual({
      ok: false,
      failure: { kind: "unconfigured", missing: ["NEON_PROJECT_ID"] },
    });
  });

  it("asks for the project and its computes, with the key, a timeout and no cache", async () => {
    const neon = fakeNeon(productionLikeState({ quotaCuHours: 50 }));
    const result = await readNeonLimits(NEON_ENV, { fetchImpl: neon.fetch });

    expect(neon.calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([
      `GET /projects/${FAKE_PROJECT_ID}`,
      `GET /projects/${FAKE_PROJECT_ID}/endpoints`,
    ]);
    for (const call of neon.calls) {
      expect(call.headers.authorization).toBe("Bearer test-neon-key");
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { limits } = result.snapshot;
    // The read-write compute only: a read replica is not a brake on the bill this card controls.
    expect(limits.computes).toEqual([{ id: "ep-rw-main", minCu: 0.25, maxCu: 1 }]);
    expect(limits.defaults).toEqual({ minCu: 0.25, maxCu: 1 });
    expect(limits.quotaCuHours).toBe(50);
    expect(limits.usedCuHours).toBeCloseTo(12.34, 2);
    expect(limits.activeHours).toBe(40);
    expect(limits.periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(limits.reportedPlan).toBe("LAUNCH");
    // The whole default settings and quota, kept for the write to send back.
    expect(result.snapshot.raw.defaults).toMatchObject({ suspend_timeout_seconds: 0 });
  });

  it("reads no quota, and a zero quota, as no limit", async () => {
    const none = await readNeonLimits(NEON_ENV, { fetchImpl: fakeNeon(productionLikeState()).fetch });
    expect(none.ok && none.snapshot.limits.quotaCuHours).toBeNull();
    const state = productionLikeState();
    state.project.settings = { quota: { compute_time_seconds: 0 } };
    const zero = await readNeonLimits(NEON_ENV, { fetchImpl: fakeNeon(state).fetch });
    expect(zero.ok && zero.snapshot.limits.quotaCuHours).toBeNull();
  });

  it("turns each way Neon can fail into a kind, never a throw", async () => {
    const answering = (status: number) => fakeNeon(productionLikeState(), () => new Response("", { status })).fetch;
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: answering(401) })).toEqual({ ok: false, failure: { kind: "forbidden", status: 401 } });
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: answering(403) })).toEqual({ ok: false, failure: { kind: "forbidden", status: 403 } });
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: answering(404) })).toEqual({ ok: false, failure: { kind: "refused", status: 404 } });
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: answering(503) })).toEqual({ ok: false, failure: { kind: "unavailable", status: 503 } });

    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: down })).toEqual({ ok: false, failure: { kind: "network" } });

    const garbled = fakeNeon(productionLikeState(), () => new Response("<html>", { status: 200 })).fetch;
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: garbled })).toEqual({ ok: false, failure: { kind: "unexpected" } });

    const noPeriod = productionLikeState();
    delete noPeriod.project.consumption_period_end;
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: fakeNeon(noPeriod).fetch })).toEqual({ ok: false, failure: { kind: "unexpected" } });
  });

  it("gives up at the timeout and says so", async () => {
    // A Neon that never answers: the request is abandoned when the signal fires, not left to hang the page.
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const started = Date.now();
    expect(await readNeonLimits(NEON_ENV, { fetchImpl: hanging, timeoutMs: 30 })).toEqual({ ok: false, failure: { kind: "timeout" } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("BR-REQ-090-07 writeNeonLimits — the brakes set", () => {
  async function snapshotOf(neon: ReturnType<typeof fakeNeon>) {
    const read = await readNeonLimits(NEON_ENV, { fetchImpl: neon.fetch });
    if (!read.ok) throw new Error(`read failed: ${read.failure.kind}`);
    neon.calls.length = 0;
    return read.snapshot;
  }

  it("patches the project's defaults and quota, then the read-write compute, keeping every other key", async () => {
    const neon = fakeNeon(productionLikeState());
    const snapshot = await snapshotOf(neon);

    const result = await writeNeonLimits(NEON_ENV, snapshot, { maxCu: 2, quotaCuHours: 50 }, { fetchImpl: neon.fetch });
    expect(result).toEqual({ ok: true, wrote: ["project", "endpoint:ep-rw-main"] });

    expect(neon.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `PATCH /projects/${FAKE_PROJECT_ID}`,
      `PATCH /projects/${FAKE_PROJECT_ID}/endpoints/ep-rw-main`,
    ]);
    const [project, endpoint] = neon.calls;
    expect(project.headers["content-type"]).toBe("application/json");
    expect(project.body).toEqual({
      project: {
        // The whole default settings, two keys changed: the suspend timeout is sent back as it was.
        default_endpoint_settings: { autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 2, suspend_timeout_seconds: 0 },
        settings: { quota: { compute_time_seconds: 180_000 } },
      },
    });
    expect(endpoint.body).toEqual({ endpoint: { autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 2 } });
    // The read replica is left alone.
    expect(neon.state.endpoints.find((candidate) => candidate.id === "ep-ro-replica")).toMatchObject({ autoscaling_limit_max_cu: 0.25 });
  });

  it("removes a limit with Neon's zero, and sends nothing that would not change anything", async () => {
    const neon = fakeNeon(productionLikeState({ quotaCuHours: 50 }));
    const snapshot = await snapshotOf(neon);

    // Only the limit changes: one project PATCH, no compute operation started.
    expect(await writeNeonLimits(NEON_ENV, snapshot, { maxCu: 1, quotaCuHours: null }, { fetchImpl: neon.fetch })).toEqual({ ok: true, wrote: ["project"] });
    expect(neon.calls).toHaveLength(1);
    expect(neon.calls[0].body).toEqual({ project: { settings: { quota: { compute_time_seconds: 0 } } } });

    // Everything already as asked: no request at all.
    const again = await snapshotOf(neon);
    expect(await writeNeonLimits(NEON_ENV, again, { maxCu: 1, quotaCuHours: null }, { fetchImpl: neon.fetch })).toEqual({ ok: true, wrote: [] });
    expect(neon.calls).toHaveLength(0);
  });

  it("asks again after 423 Locked, and gives up as busy after the last wait", async () => {
    // The first try meets another operation; the second goes through.
    const once = fakeNeon(productionLikeState(), (call, attempt) =>
      call.method === "PATCH" && call.path.includes("/endpoints/") && attempt === 1 ? new Response("", { status: 423 }) : undefined,
    );
    const clock = instantSleep();
    const snapshot = await snapshotOf(once);
    expect(await writeNeonLimits(NEON_ENV, snapshot, { maxCu: 0.5, quotaCuHours: null }, { fetchImpl: once.fetch, sleep: clock.sleep })).toEqual({
      ok: true,
      wrote: ["project", "endpoint:ep-rw-main"],
    });
    expect(clock.waited).toEqual([NEON_LOCKED_RETRY_MS[0]]);

    // Locked every time: every wait, then a failure that says the project was busy.
    const always = fakeNeon(productionLikeState(), (call) => (call.method === "PATCH" ? new Response("", { status: 423 }) : undefined));
    const patient = instantSleep();
    const locked = await snapshotOf(always);
    expect(await writeNeonLimits(NEON_ENV, locked, { maxCu: 0.5, quotaCuHours: null }, { fetchImpl: always.fetch, sleep: patient.sleep })).toEqual({
      ok: false,
      failure: { kind: "busy" },
      wrote: [],
    });
    expect(patient.waited).toEqual([...NEON_LOCKED_RETRY_MS]);
  });

  it("stops at a key that may read and not write, saying what had been applied", async () => {
    const neon = fakeNeon(productionLikeState(), (call) =>
      call.method === "PATCH" && call.path.includes("/endpoints/") ? new Response("", { status: 403 }) : undefined,
    );
    const snapshot = await snapshotOf(neon);
    expect(await writeNeonLimits(NEON_ENV, snapshot, { maxCu: 4, quotaCuHours: null }, { fetchImpl: neon.fetch })).toEqual({
      ok: false,
      failure: { kind: "forbidden", status: 403 },
      wrote: ["project"],
    });
  });
});
