import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asksForDeepHealth, shallowHealth, type ShallowHealthInput } from "@/modules/diagnostics/domain/shallow-health";

/**
 * §577 — `/api/health` is shallow unless it is asked `?deep=1`: the build and the configuration,
 * and no database, no Neon, no Cloudflare, no DeepL. The hourly monitor calls it, so on a platform
 * nobody visits it wakes nothing; `scripts/ship.mjs` reads its baseline; the full report is what a
 * person, `yarn smoke` and the daily monitor at the maintenance window ask for.
 *
 * The route itself, with every dependency the deep answer has replaced by a spy that fails the
 * case if the shallow answer so much as touches it.
 */
const execute = vi.fn();
const getDb = vi.fn(() => ({ execute }));
const checkNeonQuotaHealth = vi.fn();
const probeTurnstileSecret = vi.fn();
const readTranslationCredit = vi.fn();
const checkSchemaVersion = vi.fn();

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => getDb() }));
vi.mock("@/db/schema-version", () => ({
  checkSchemaVersion: (...args: unknown[]) => checkSchemaVersion(...args),
  EXPECTED_MIGRATION: { tag: "0114_example", when: "1790000000000" },
}));
vi.mock("@/modules/jobs/health", () => ({
  checkJobHealth: async (_db: unknown, jobName: string) => ({ jobName, status: "ok", lastFinishedAt: new Date().toISOString(), lastPingAt: null }),
}));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: async () => ({ status: "ok" }) }));
vi.mock("@/modules/diagnostics/neon", () => {
  const notRead = { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" };
  return { checkNeonQuotaHealth: (...args: unknown[]) => checkNeonQuotaHealth(...args), QUOTA_NOT_READ: notRead };
});
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ probeTurnstileSecret: (...args: unknown[]) => probeTurnstileSecret(...args) }));
vi.mock("@/modules/translate/credit", () => ({ readTranslationCredit: (...args: unknown[]) => readTranslationCredit(...args) }));
vi.mock("@/shared/config/build-info", () => ({
  buildInfo: { baseline: "BR-V2.41-2026-09-30", commit: "abc1234", committedAt: "2026-09-30T08:00:00.000Z", id: "" },
}));

const { GET } = await import("@/app/api/health/route");
const fetchSpy = vi.spyOn(globalThis, "fetch");

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
  checkSchemaVersion.mockResolvedValue({ status: "ok", expectedTag: "0114_example" });
  checkNeonQuotaHealth.mockResolvedValue({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" });
  probeTurnstileSecret.mockResolvedValue("not_configured");
  readTranslationCredit.mockResolvedValue({ ok: false, reason: "unavailable" });
  fetchSpy.mockImplementation(async () => {
    throw new Error("the shallow health called a third party");
  });
});
afterEach(() => fetchSpy.mockReset());

function nothingAsked(): void {
  expect(getDb).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(checkSchemaVersion).not.toHaveBeenCalled();
  expect(checkNeonQuotaHealth).not.toHaveBeenCalled();
  expect(probeTurnstileSecret).not.toHaveBeenCalled();
  expect(readTranslationCredit).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("§577 /api/health is shallow by default", () => {
  it("answers the build and the configuration with nothing asked of the database or anybody else", async () => {
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      depth: "shallow",
      build: { baseline: "BR-V2.41-2026-09-30", commit: "abc1234" },
      schema: { expectedTag: "0114_example" },
      deep: "/api/health?deep=1",
    });
    // Nothing the deep answer reads is in it.
    for (const key of ["database", "jobs", "email", "neon", "budget", "turnstile", "translation"]) expect(body).not.toHaveProperty(key);
    nothingAsked();
  });

  it("carries the baseline `scripts/ship.mjs` waits for, as the quoted string it searches the body for", async () => {
    const text = await (await GET(new Request("http://localhost/api/health"))).text();
    expect(text).toContain('"BR-V2.41-2026-09-30"');
    nothingAsked();
  });

  it("is shallow for a direct call with no request, and for a query that is not `deep`", async () => {
    expect((await (await GET()).json()).depth).toBe("shallow");
    expect((await (await GET(new Request("http://localhost/api/health?deep=0"))).json()).depth).toBe("shallow");
    expect((await (await GET(new Request("http://localhost/api/health?utm_source=x"))).json()).depth).toBe("shallow");
    nothingAsked();
  });

  it("asks the database and the rest on `?deep=1`, and says it is the deep answer", async () => {
    const response = await GET(new Request("http://localhost/api/health?deep=1"));
    const body = await response.json();
    expect(body.depth).toBe("deep");
    expect(body.database).toBe("ok");
    expect(execute).toHaveBeenCalled();
    expect(checkSchemaVersion).toHaveBeenCalled();
    expect(checkNeonQuotaHealth).toHaveBeenCalled();
    expect(probeTurnstileSecret).toHaveBeenCalled();
  });
});

describe("§577 the shallow report's rules", () => {
  const base: ShallowHealthInput = {
    build: { baseline: "BR-V2.41-2026-09-30", commit: "abc1234", committedAt: "" },
    expectedMigration: "0114_example",
    appEnv: "production",
    present: { DATABASE_URL: true, JOB_SECRET: true },
    domain: { status: "ok", expiresOn: "2027-09-16", daysLeft: 351 },
    now: new Date("2026-09-30T09:00:00.000Z"),
  };

  it("is ok for a configured deployment, and names an unknown build part null", () => {
    const report = shallowHealth(base);
    expect(report.status).toBe("ok");
    expect(report.configuration).toEqual({ status: "ok", missing: [] });
    expect(report.build.committedAt).toBeNull();
  });

  it("is degraded, naming the variable, when a deployed environment has no database or no job secret", () => {
    expect(shallowHealth({ ...base, present: { DATABASE_URL: true, JOB_SECRET: false } })).toMatchObject({
      status: "degraded",
      configuration: { status: "incomplete", missing: ["JOB_SECRET"] },
    });
    expect(shallowHealth({ ...base, appEnv: "qa", present: { DATABASE_URL: false, JOB_SECRET: false } }).configuration.missing).toEqual([
      "DATABASE_URL",
      "JOB_SECRET",
    ]);
  });

  it("requires neither on a laptop or under test", () => {
    for (const appEnv of ["local", "test"] as const) {
      expect(shallowHealth({ ...base, appEnv, present: { DATABASE_URL: false, JOB_SECRET: false } }).status).toBe("ok");
    }
  });

  it("is degraded thirty days before the domain expires, as the deep answer is (§435)", () => {
    expect(shallowHealth({ ...base, domain: { status: "urgent", expiresOn: "2026-10-20", daysLeft: 20 } }).status).toBe("degraded");
    expect(shallowHealth({ ...base, domain: { status: "soon", expiresOn: "2026-12-20", daysLeft: 81 } }).status).toBe("ok");
    expect(shallowHealth({ ...base, domain: { status: "unknown" } }).domain).toEqual({ status: "unknown" });
  });

  it("reads `?deep=1`, `true`, `yes` and a bare `?deep` as deep, anything else as shallow", () => {
    for (const url of ["/api/health?deep=1", "/api/health?deep=true", "/api/health?deep=YES", "/api/health?deep", "http://x/api/health?a=b&deep=1"]) {
      expect(asksForDeepHealth(url), url).toBe(true);
    }
    for (const url of ["/api/health", "/api/health?deep=0", "/api/health?deeper=1", undefined, null, ""]) {
      expect(asksForDeepHealth(url), String(url)).toBe(false);
    }
  });
});
