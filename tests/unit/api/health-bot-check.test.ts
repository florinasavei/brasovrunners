import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-031-01 — `/api/health` says how often the anti-bot check let people down in the last day
 * (`DECISIONS.md` §518): held presses the valve sent, widgets that failed or never loaded. A level —
 * none / some / many — never the count (the body is public) and never the status; `null` when it could not be read, never a reason for `down`. The words travel
 * with the registration form and are counted by its action: there is no endpoint of their own.
 */
const countBotCheckSignals = vi.fn();
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
}));

const healthRoute = await import("@/app/api/health/route");
/** The full report (§NNN): these cases are about what the deep answer asks and says. */
const GET = () => healthRoute.GET(new Request("http://localhost/api/health?deep=1"));
const { botCheckSignalLevel } = await import("@/modules/registrations/bot-check-signals");

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
});

describe("§518 /api/health carries the check's last day", () => {
  it("reports a level, never the count, and stays ok however high it is", async () => {
    countBotCheckSignals.mockResolvedValue({ heldPressValve: 40, widgetFailed: 3 });
    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text);
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.turnstile).toEqual({ status: "ok", lastDay: { heldPressValve: "many", widgetFailed: "some" } });
    // The public body carries no raw figure: a daily count would bound the club's registrations.
    expect(JSON.stringify(body.turnstile)).not.toMatch(/\d/);
  });

  it("a quiet day is none", async () => {
    countBotCheckSignals.mockResolvedValue({ heldPressValve: 0, widgetFailed: 0 });
    const body = await (await GET()).json();
    expect(body.turnstile.lastDay).toEqual({ heldPressValve: "none", widgetFailed: "none" });
  });

  it("the level's edges: 0 none, 1–4 some, 5 and up many", () => {
    expect([0, 1, 4, 5, 500].map(botCheckSignalLevel)).toEqual(["none", "some", "some", "many", "many"]);
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

describe("§518 the signals ride with the registration", () => {
  const ROOT = path.resolve(__dirname, "../../..");

  it("has no endpoint of its own: nobody writes a count without registering", () => {
    expect(existsSync(path.join(ROOT, "src/app/api/bot-check-signal"))).toBe(false);
  });

  it("the register action counts the form's own words, after the registration went through, and never fails on them", () => {
    const action = readFileSync(path.join(ROOT, "src/app/[locale]/events/[slug]/register/actions.ts"), "utf8");
    const counted = action.indexOf("botCheckSignalsFrom(form.getAll(BOT_CHECK_SIGNAL_FIELD))");
    expect(counted).toBeGreaterThan(action.indexOf("await submitRegistration("));
    expect(action.slice(counted - 200, counted)).toMatch(/if \(verdict !== "not_configured"\) \{\s*try \{/);
  });
});
