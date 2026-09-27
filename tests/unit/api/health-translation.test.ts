import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditHealth, translationCredit } from "@/modules/translate/domain/credit";

/**
 * §497 — `/api/health` warns when the DeepL credit is low (95 %) or spent, after §335 and §447:
 * a level and a note, never the characters used or left (the club's account figures belong on
 * Costuri, §479), and never the status — translation stops nothing a visitor needs.
 */
const readTranslationCredit = vi.fn();
const execute = vi.fn();

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("@/db/schema-version", () => ({ checkSchemaVersion: async () => ({ status: "ok", expected: "0091", applied: "0091" }) }));
vi.mock("@/modules/jobs/health", () => ({
  checkJobHealth: async (_db: unknown, jobName: string) => ({ jobName, status: "ok", lastFinishedAt: new Date().toISOString(), lastPingAt: null }),
}));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: async () => ({ status: "ok" }) }));
vi.mock("@/modules/diagnostics/neon", () => {
  const notRead = { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" };
  return { checkNeonQuotaHealth: async () => notRead, QUOTA_NOT_READ: notRead };
});
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ probeTurnstileSecret: async () => "not_configured" }));
vi.mock("@/modules/translate/credit", () => ({ readTranslationCredit: (...args: unknown[]) => readTranslationCredit(...args) }));

const { GET } = await import("@/app/api/health/route");

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
});

describe("§497 /api/health and the DeepL credit", () => {
  it("says a spent credit with a note and no figure, and leaves the status alone", async () => {
    readTranslationCredit.mockResolvedValue({ ok: true, credit: translationCredit({ used: 1_000_000, limit: 1_000_000 }) });
    const response = await GET();
    const body = await response.json();
    expect(body.translation.level).toBe("spent");
    expect(body.translation.note).toMatch(/spent/);
    expect(Object.keys(body.translation).sort()).toEqual(["level", "note"]);
    // The public answer carries no number of the credit's.
    expect(JSON.stringify(body.translation)).not.toMatch(/\d/);
    expect(JSON.stringify(body)).not.toMatch(/1000000|1\.000\.000|1,000,000|character/i);
    expect(body.status).toBe("ok");
    expect(response.status).toBe(200);
  });

  it("notes a low credit, and says nothing while the credit is fine or unread", async () => {
    readTranslationCredit.mockResolvedValue({ ok: true, credit: translationCredit({ used: 960_000, limit: 1_000_000 }) });
    const low = (await (await GET()).json()).translation;
    expect(low.level).toBe("low");
    expect(low.note).toMatch(/nearly spent/);
    expect(JSON.stringify(low)).not.toMatch(/\d/);

    readTranslationCredit.mockResolvedValue({ ok: true, credit: translationCredit({ used: 850_000, limit: 1_000_000 }) });
    expect((await (await GET()).json()).translation).toEqual({ level: "watch", note: null });

    readTranslationCredit.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await (await GET()).json()).translation).toEqual({ level: "unknown", note: null });

    readTranslationCredit.mockResolvedValue({ ok: false, reason: "unconfigured" });
    expect((await (await GET()).json()).translation).toEqual({ level: "unconfigured", note: null });
  });

  it("maps every reading without a figure", () => {
    for (const used of [0, 800_000, 950_000, 1_000_000]) {
      expect(JSON.stringify(creditHealth({ ok: true, credit: translationCredit({ used, limit: 1_000_000 }) }))).not.toMatch(/\d/);
    }
    expect(creditHealth({ ok: false, reason: "refused" })).toEqual({ level: "unknown", note: null });
  });
});
