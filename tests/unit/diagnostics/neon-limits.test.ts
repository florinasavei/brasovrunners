import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  checkNeonLimits,
  cuHoursToSeconds,
  describeNeonLimits,
  NEON_MAX_CU_STEPS,
  NEON_QUOTA_MARGIN_CU_HOURS,
  type NeonLimitsReading,
  offeredCeilings,
  parseNeonLimitsRequest,
  priceCeiling,
  quotaBoxValue,
  recommendedNeonQuotaCuHours,
  secondsToCuHours,
} from "@/modules/diagnostics/domain/neon-limits";
import { NEON_PLANS } from "@/modules/diagnostics/domain/neon-plan";
import { NEON_FAILURE_KINDS } from "@/modules/diagnostics/neon";
import { NEON_LIMITS_REFUSAL_CODES } from "@/modules/diagnostics/neon-limits";

/**
 * BR-REQ-090-07 criterion 8 (§NNN) — the rules of the database's brakes: the six ceilings and
 * what each costs at worst, a new or changed limit that must clear what is spent, production's
 * confirmation, the limit in force kept to the second, and the limit the card recommends.
 */
const READING: NeonLimitsReading = {
  computes: [{ id: "ep-rw-main", minCu: 0.25, maxCu: 1 }],
  defaults: { minCu: 0.25, maxCu: 1 },
  quotaCuHours: null,
  usedCuHours: 12.34,
  activeHours: 40,
  periodEnd: new Date("2026-10-01T00:00:00Z"),
  reportedPlan: "LAUNCH",
};

describe("BR-REQ-090-07 the ceilings on offer and their worst case", () => {
  it("offers six ceilings from a quarter CU, within Neon's eight between floor and ceiling", () => {
    expect([...NEON_MAX_CU_STEPS]).toEqual([0.25, 0.5, 1, 2, 4, 8]);
    for (const cu of NEON_MAX_CU_STEPS) expect(cu - 0.25).toBeLessThanOrEqual(8);
  });

  it("prices a ceiling at Launch's rate from the one catalogue: the hour, and a month awake at it", () => {
    const rate = NEON_PLANS.LAUNCH.usdPerCuHour;
    expect(priceCeiling(1)).toEqual({ cu: 1, ramGb: 4, usdPerHour: rate, usdPerMonth: Math.round(rate * 720 * 100) / 100 });
    // 8 CU never sleeping is the bill a runaway would run to: 32 times the quarter CU's.
    expect(priceCeiling(8).usdPerMonth).toBeCloseTo(priceCeiling(0.25).usdPerMonth * 32, 0);
  });

  it("offers only what the plan lets a compute reach: Free stops at 2 CU", () => {
    expect(offeredCeilings("FREE").map((ceiling) => ceiling.cu)).toEqual([0.25, 0.5, 1, 2]);
    expect(offeredCeilings("LAUNCH").map((ceiling) => ceiling.cu)).toEqual([...NEON_MAX_CU_STEPS]);
    expect(offeredCeilings(null).map((ceiling) => ceiling.cu)).toEqual([...NEON_MAX_CU_STEPS]);
  });

  it("describes the ceiling in force as the largest read-write compute, and says when the default disagrees", () => {
    const model = describeNeonLimits(READING);
    expect(model).toMatchObject({ maxCu: 1, computeCount: 1, mixed: false, quotaCuHours: null });
    expect(model.price).toEqual(priceCeiling(1));

    const drifted = describeNeonLimits({ ...READING, defaults: { minCu: 0.25, maxCu: 8 } });
    expect(drifted.mixed).toBe(true);
    const none = describeNeonLimits({ ...READING, computes: [] });
    expect(none).toMatchObject({ maxCu: null, price: null, computeCount: 0 });
  });

  it("names the smallest limit it would accept: the first tenth above spend plus margin", () => {
    expect(describeNeonLimits(READING).smallestQuotaCuHours).toBe(17.4);
    expect(describeNeonLimits({ ...READING, usedCuHours: 12 }).smallestQuotaCuHours).toBe(17.1);
    expect(describeNeonLimits({ ...READING, usedCuHours: 0 }).smallestQuotaCuHours).toBe(5.1);
  });

  it("counts a quota in the seconds Neon keeps, zero being none", () => {
    expect(cuHoursToSeconds(50)).toBe(180_000);
    expect(cuHoursToSeconds(null)).toBe(0);
    expect(secondsToCuHours(180_000)).toBe(50);
    expect(secondsToCuHours(0)).toBeNull();
    expect(secondsToCuHours(undefined)).toBeNull();
  });
});

describe("BR-REQ-090-07 what the form may post", () => {
  it("accepts one of the six ceilings and a positive limit, with a decimal comma", () => {
    expect(parseNeonLimitsRequest({ maxCu: "0.5", quotaMode: "none", quotaCuHours: "999", confirmSuspension: false })).toEqual({
      ok: true,
      request: { maxCu: 0.5, quotaCuHours: null, confirmSuspension: false },
    });
    expect(parseNeonLimitsRequest({ maxCu: "2", quotaMode: "limit", quotaCuHours: "50,5", confirmSuspension: true })).toEqual({
      ok: true,
      request: { maxCu: 2, quotaCuHours: 50.5, confirmSuspension: true },
    });
  });

  it("refuses a ceiling that is not a step, and a limit that is not a sensible number, naming the box", () => {
    expect(parseNeonLimitsRequest({ maxCu: "3", quotaMode: "none" })).toEqual({ ok: false, fields: ["maxCu"] });
    expect(parseNeonLimitsRequest({ maxCu: "", quotaMode: "none" })).toEqual({ ok: false, fields: ["maxCu"] });
    expect(parseNeonLimitsRequest({ maxCu: "16", quotaMode: "none" })).toEqual({ ok: false, fields: ["maxCu"] });
    for (const quota of ["", "0", "-5", "abc", "1e3", "10001"]) {
      expect(parseNeonLimitsRequest({ maxCu: "1", quotaMode: "limit", quotaCuHours: quota }), quota).toEqual({ ok: false, fields: ["quotaCuHours"] });
    }
    expect(parseNeonLimitsRequest({ maxCu: "1", quotaMode: "sometimes" })).toEqual({ ok: false, fields: ["quotaMode"] });
  });
});

describe("BR-REQ-090-07 the rules against what Neon says now", () => {
  const request = (quotaCuHours: number | null, confirmSuspension = false, maxCu: 0.25 | 0.5 | 1 | 2 | 4 | 8 = 1) => ({ maxCu, quotaCuHours, confirmSuspension });

  it("refuses a new limit at or below what is spent plus the margin — it would suspend the database on saving", () => {
    const context = { usedCuHours: 12.34, quotaCuHours: null, plan: "LAUNCH" as const, appEnv: "qa" as const };
    expect(checkNeonLimits(request(12.34 + NEON_QUOTA_MARGIN_CU_HOURS), context)).toEqual({ code: "NEON_QUOTA_BELOW_USAGE", field: "quotaCuHours" });
    expect(checkNeonLimits(request(10), context)).toEqual({ code: "NEON_QUOTA_BELOW_USAGE", field: "quotaCuHours" });
    expect(checkNeonLimits(request(17.4), context)).toBeNull();
    expect(checkNeonLimits(request(null), context)).toBeNull();
  });

  it("asks production for the ticked confirmation before a new or changed limit, and nobody else", () => {
    const production = { usedCuHours: 1, quotaCuHours: null, plan: "LAUNCH" as const, appEnv: "production" as const };
    expect(checkNeonLimits(request(100), production)).toEqual({ code: "NEON_QUOTA_UNCONFIRMED", field: "confirmSuspension" });
    expect(checkNeonLimits(request(100, true), production)).toBeNull();
    // Changing a limit in force is a new limit too.
    expect(checkNeonLimits(request(150), { ...production, quotaCuHours: 100 })).toEqual({ code: "NEON_QUOTA_UNCONFIRMED", field: "confirmSuspension" });
    // "No limit" where there was none changes nothing and asks nothing.
    expect(checkNeonLimits(request(null), production)).toBeNull();
    expect(checkNeonLimits(request(100), { ...production, appEnv: "qa" })).toBeNull();
    // The usage rule comes first: a confirmed limit that would stop the site at once is still refused.
    expect(checkNeonLimits(request(3, true), production)).toEqual({ code: "NEON_QUOTA_BELOW_USAGE", field: "quotaCuHours" });
  });

  it("asks production for the same confirmation before removing its limit — the owner kept production capped (§327)", () => {
    const capped = { usedCuHours: 40, quotaCuHours: 100, plan: "LAUNCH" as const, appEnv: "production" as const };
    expect(checkNeonLimits(request(null), capped)).toEqual({ code: "NEON_QUOTA_REMOVAL_UNCONFIRMED", field: "confirmSuspension" });
    expect(checkNeonLimits(request(null, true), capped)).toBeNull();
    // With the size changed at the same press, the removal still asks.
    expect(checkNeonLimits(request(null, false, 0.5), capped)).toEqual({ code: "NEON_QUOTA_REMOVAL_UNCONFIRMED", field: "confirmSuspension" });
    // QA removes its limit freely: the guard is production's.
    expect(checkNeonLimits(request(null), { ...capped, appEnv: "qa" })).toBeNull();
  });

  it("leaves the limit Neon holds alone: posted back to the second, it needs no confirmation and meets no usage rule", () => {
    // Production as set on 2026-09-23 (SETUP.md §40): 100 CU-hours. Throttling the size alone,
    // the quota box untouched, is not a new limit — not even late in a busy month.
    const production = { usedCuHours: 97, quotaCuHours: 100, plan: "LAUNCH" as const, appEnv: "production" as const };
    expect(checkNeonLimits(request(100, false, 0.5), production)).toBeNull();
    // A quota Neon holds in odd seconds, posted back as the box shows it (`quotaBoxValue`).
    const odd = { ...production, usedCuHours: 1, quotaCuHours: 100_000 / 3600 };
    expect(checkNeonLimits(request(Number(quotaBoxValue(odd.quotaCuHours)), false, 0.5), odd)).toBeNull();
    // A tenth away is a change, and meets both rules again.
    expect(checkNeonLimits(request(27.8, false, 0.5), odd)).toEqual({ code: "NEON_QUOTA_UNCONFIRMED", field: "confirmSuspension" });
  });

  it("refuses a ceiling above the plan's own autoscaling limit", () => {
    const qa = { usedCuHours: 0, quotaCuHours: null, appEnv: "qa" as const };
    expect(checkNeonLimits(request(null, false, 4), { ...qa, plan: "FREE" })).toEqual({ code: "VALIDATION_ERROR", field: "maxCu" });
    expect(checkNeonLimits(request(null, false, 2), { ...qa, plan: "FREE" })).toBeNull();
    expect(checkNeonLimits(request(null, false, 8), { ...qa, plan: null })).toBeNull();
  });
});

describe("BR-REQ-090-07 the quota box and the limit the card recommends", () => {
  it("shows a limit Neon holds so that it goes back to exactly the same seconds", () => {
    expect(quotaBoxValue(null)).toBe("");
    expect(quotaBoxValue(100)).toBe("100");
    expect(quotaBoxValue(30)).toBe("30");
    for (const seconds of [100_000, 360_000, 108_000, 1, 12_345, 35_999_999]) {
      const shown = quotaBoxValue(seconds / 3600);
      expect(cuHoursToSeconds(Number(shown)), `${seconds} s shown as ${shown}`).toBe(seconds);
    }
  });

  it("recommends the limits the owner set on Neon (SETUP.md §40): 100 CU-hours on production, 30 elsewhere — never none", () => {
    expect(recommendedNeonQuotaCuHours("production")).toBe(100);
    for (const appEnv of ["qa", "local", "test"] as const) expect(recommendedNeonQuotaCuHours(appEnv)).toBe(30);
  });
});

describe("BR-REQ-090-07 the card's words, in both languages", () => {
  const flatten = (node: unknown, into: string[] = []): string[] => {
    if (typeof node === "string") into.push(node);
    else if (node && typeof node === "object") for (const value of Object.values(node)) flatten(value, into);
    return into;
  };
  type Catalogue = { Admin: { errors: Record<string, string>; tasks: { neonLimits: { failure: Record<string, string> } & Record<string, unknown> } } };

  it("has a sentence for every failure kind the read can meet, and every refusal the form can be handed", () => {
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      const catalogue = messages as unknown as Catalogue;
      // `unconfigured` has its own sentence, naming the missing variables.
      for (const kind of NEON_FAILURE_KINDS.filter((candidate) => candidate !== "unconfigured")) {
        expect(catalogue.Admin.tasks.neonLimits.failure[kind], `${locale} failure.${kind}`).toBeTruthy();
      }
      for (const code of NEON_LIMITS_REFUSAL_CODES) expect(catalogue.Admin.errors[code], `${locale} errors.${code}`).toBeTruthy();
    }
  });

  it("quotes no Neon rate literally: every price comes from the catalogue through a placeholder", () => {
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      for (const message of flatten((messages as unknown as Catalogue).Admin.tasks.neonLimits)) {
        expect(message, `${locale} quotes a Neon rate literally`).not.toMatch(/0[.,]106|\$\s?\d|\d\s?\$\/(oră|hour)/);
      }
    }
  });

  it("never advises leaving production without a limit — the owner capped it (SETUP.md §40)", () => {
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      const catalogue = messages as unknown as Catalogue & { Admin: { tasks: { items: { neonLimits: unknown } } } };
      const words = [...flatten(catalogue.Admin.tasks.neonLimits), ...flatten(catalogue.Admin.tasks.items.neonLimits)];
      for (const message of words) {
        expect(message, `${locale} advises no limit`).not.toMatch(/no limit on production|fără limită pe producție|recommends there|recomandă acest ecran acolo/i);
      }
      expect(catalogue.Admin.tasks.neonLimits.recommend, `${locale} recommend`).toContain("{hours}");
      expect(catalogue.Admin.tasks.neonLimits.recommendConfirm, `${locale} recommendConfirm`).toBeTruthy();
    }
  });
});
