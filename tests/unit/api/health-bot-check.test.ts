import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-031-01 — `/api/health` says how often the anti-bot check let people down in the last day
 * (`DECISIONS.md` §NNN): held presses the valve sent, widgets that failed or never loaded. A figure,
 * never the status; `null` when it could not be read, never a reason for `down`. And the endpoint
 * the browser reports to counts only its two words, from this site, and always answers 204.
 */
const countBotCheckSignals = vi.fn();
const recordBotCheckSignal = vi.fn();
const execute = vi.fn();

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("@/db/schema-version", () => ({ checkSchemaVersion: async () => ({ status: "ok", expected: "0095", applied: "0095" }) }));
vi.mock("@/modules/jobs/health", () => ({
  checkJobHealth: async (_db: unknown, jobName: string) => ({ jobName, status: "ok", lastFinishedAt: "2026-09-27T09:50:00.000Z" }),
}));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: async () => ({ status: "ok" }) }));
vi.mock("@/modules/diagnostics/neon", () => {
  const notRead = { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" };
  return { checkNeonQuotaHealth: async () => notRead, QUOTA_NOT_READ: notRead };
});
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ probeTurnstileSecret: async () => "ok" }));
vi.mock("@/modules/translate/credit", () => ({ readTranslationCredit: async () => ({ ok: false, reason: "unavailable" }) }));
vi.mock("@/modules/diagnostics/domain/domain-renewal", () => ({ domainRenewal: () => ({ status: "unknown" }) }));
vi.mock("@/modules/registrations/bot-check-signals", async (original) => ({
  ...(await original<typeof import("@/modules/registrations/bot-check-signals")>()),
  countBotCheckSignals: (...args: unknown[]) => countBotCheckSignals(...args),
  recordBotCheckSignal: (...args: unknown[]) => recordBotCheckSignal(...args),
}));

const { GET } = await import("@/app/api/health/route");
const { POST } = await import("@/app/api/bot-check-signal/route");

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
  recordBotCheckSignal.mockResolvedValue(undefined);
});

describe("§NNN /api/health carries the check's last day", () => {
  it("reports the counts and stays ok however high they are", async () => {
    countBotCheckSignals.mockResolvedValue({ heldPressValve: 40, widgetFailed: 12 });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.turnstile).toEqual({ status: "ok", lastDay: { heldPressValve: 40, widgetFailed: 12 } });
  });

  it("a count that cannot be read is null, never a database that is down", async () => {
    countBotCheckSignals.mockRejectedValue(new Error("relation does not exist"));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.database).toBe("ok");
    expect(body.turnstile.lastDay).toBeNull();
  });
});

describe("§NNN /api/bot-check-signal", () => {
  const post = (body: string, site: string | null = "same-origin") =>
    POST(new Request("http://localhost/api/bot-check-signal", { method: "POST", body, headers: site ? { "sec-fetch-site": site } : {} }));

  it("counts one of its two words from this site", async () => {
    const response = await post("held-press-valve");
    expect(response.status).toBe(204);
    expect(recordBotCheckSignal).toHaveBeenCalledTimes(1);
    expect(recordBotCheckSignal.mock.calls[0][1]).toBe("held-press-valve");
    await post("widget-failed", null);
    expect(recordBotCheckSignal).toHaveBeenCalledTimes(2);
  });

  it("counts nothing else, and nothing another site sent — and answers 204 all the same", async () => {
    expect((await post("ana@example.org")).status).toBe(204);
    expect((await post("widget-failed", "cross-site")).status).toBe(204);
    expect(recordBotCheckSignal).not.toHaveBeenCalled();
  });

  it("a count that fails is still a 204", async () => {
    recordBotCheckSignal.mockRejectedValue(new Error("away"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post("widget-failed")).status).toBe(204);
    error.mockRestore();
  });
});
