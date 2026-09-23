import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  DEFAULT_NEON_PLAN,
  describeNeonBlock,
  NEON_PLAN_IDS,
  NEON_PLANS,
  NEON_PLANS_CHECKED_ON,
  NEON_WARN_AT_SHARE,
  neonPlanSettingSchema,
  readNeonPlanValue,
} from "@/modules/diagnostics/domain/neon-plan";
import { NEON_FREE_STORAGE_BYTES } from "@/modules/diagnostics/database-size";
import { NEON_FREE_CU_HOURS } from "@/modules/diagnostics/neon";
import { NEON_LAUNCH_USD_PER_CU_HOUR, NEON_LAUNCH_USD_PER_GB_MONTH } from "@/modules/diagnostics/platform-plans";

/**
 * BR-REQ-090-07 criteria 1–2, `DECISIONS.md` §280's follow-up — the Neon plan is a setting, and
 * the block on `/devs` follows it.
 *
 * Three things, and the last one is the report the owner filed: the setting reads as Free when
 * absent or unreadable and round-trips Launch; every figure the pages print comes from the one
 * catalogue, so a page and a constant cannot disagree; and on Launch nothing has a ceiling, so
 * nothing turns red — the same hours become an estimated charge at the catalogue's rate, which
 * is what the billing console showed beside a `/devs` still counting down from a hundred.
 */
const NOW = new Date("2026-09-24T09:00:00.000Z");
const PERIOD = { periodStart: new Date("2026-09-22T00:00:00.000Z"), periodEnd: new Date("2026-10-01T00:00:00.000Z") };

describe("the Neon plan setting", () => {
  it("is Free when absent, when unreadable, and when it says something this code does not know", () => {
    // A fresh deployment has no reason to assume money; a value from a future version falls back
    // to the plan with the ceilings — the safe one to be wrong about.
    expect(readNeonPlanValue(undefined)).toEqual(DEFAULT_NEON_PLAN);
    expect(readNeonPlanValue(null)).toEqual(DEFAULT_NEON_PLAN);
    expect(readNeonPlanValue("LAUNCH")).toEqual(DEFAULT_NEON_PLAN);
    expect(readNeonPlanValue({ plan: "SCALE" })).toEqual(DEFAULT_NEON_PLAN);
    expect(readNeonPlanValue({ plan: "LAUNCH", extra: true })).toEqual(DEFAULT_NEON_PLAN);
    expect(DEFAULT_NEON_PLAN.plan).toBe("FREE");
  });

  it("round-trips Launch with its note, and trims what the form typed", () => {
    expect(readNeonPlanValue({ plan: "LAUNCH", note: "  since 22 September; review in December  " })).toEqual({
      plan: "LAUNCH",
      note: "since 22 September; review in December",
    });
    expect(neonPlanSettingSchema.parse({ plan: "LAUNCH" })).toEqual({ plan: "LAUNCH", note: "" });
  });

  it("refuses what the form cannot mean", () => {
    expect(neonPlanSettingSchema.safeParse({ plan: "GOLD" }).success).toBe(false);
    expect(neonPlanSettingSchema.safeParse({ plan: "FREE", note: "x".repeat(201) }).success).toBe(false);
    expect(neonPlanSettingSchema.safeParse({}).success).toBe(false);
    expect(NEON_PLAN_IDS).toEqual(["FREE", "LAUNCH"]);
  });
});

describe("the one catalogue every Neon figure is read from", () => {
  it("pins Free's ceilings and Launch's rates, dated, and the older constants point at them", () => {
    // The console on 2026-09-22 (§280): Free's 100 CU-hours and 0.5 GB; Launch's $0.106 per
    // CU-hour, $0.35 per GB-month of storage, $0.20 per GB-month of restore history.
    expect(NEON_PLANS_CHECKED_ON).toBe("2026-09-22");
    expect(NEON_PLANS.FREE).toMatchObject({ cuHoursPerMonth: 100, storageBytes: 512 * 1024 * 1024, usdPerCuHour: 0, suspendsWhenSpent: true });
    expect(NEON_PLANS.LAUNCH).toMatchObject({ cuHoursPerMonth: null, storageBytes: null, usdPerCuHour: 0.106, usdPerGbMonth: 0.35, restoreUsdPerGbMonth: 0.2, suspendsWhenSpent: false });
    // The names the older callers import are the catalogue's values, not a second copy.
    expect(NEON_FREE_CU_HOURS).toBe(NEON_PLANS.FREE.cuHoursPerMonth);
    expect(NEON_FREE_STORAGE_BYTES).toBe(NEON_PLANS.FREE.storageBytes);
    expect(NEON_LAUNCH_USD_PER_CU_HOUR).toBe(NEON_PLANS.LAUNCH.usdPerCuHour);
    expect(NEON_LAUNCH_USD_PER_GB_MONTH).toBe(NEON_PLANS.LAUNCH.usdPerGbMonth);
    // 1.8 CU-hours for $0.19 is what the console showed; the rate reconciles it (§280).
    expect(Math.round(1.8 * NEON_PLANS.LAUNCH.usdPerCuHour * 100) / 100).toBe(0.19);
  });

  it("keeps every price out of the catalogues and behind a placeholder, in both languages", () => {
    // The pages quote the rate through `{rate}` and `{storageRate}` from the catalogue; a
    // literal `0,106` or `$0.35` in a message would be the second place a price lives.
    const flatten = (node: unknown, into: string[] = []): string[] => {
      if (typeof node === "string") into.push(node);
      else if (node && typeof node === "object") for (const value of Object.values(node)) flatten(value, into);
      return into;
    };
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      const bag = messages as unknown as { Devs: { neon: unknown }; Admin: { tasks: { neonPlan: unknown; services: { neon: unknown } } } };
      for (const message of [...flatten(bag.Devs.neon), ...flatten(bag.Admin.tasks.neonPlan), ...flatten(bag.Admin.tasks.services.neon)]) {
        expect(message, `${locale} quotes a Neon rate or ceiling literally`).not.toMatch(/0[.,]106|0[.,]35\b|0[.,]20?\s?\$|\$0[.,]20?\b|\b100 (de )?(ore-CU|CU-hours)|0[.,]5 GB|512 MB/);
      }
    }
  });
});

describe("the block on /devs, given the plan and the month", () => {
  const consumption = { cuHours: 74.15, activeHours: 281.4, ...PERIOD };

  it("on Free counts against the ceilings, and turns red past eighty percent — which is where the site would stop", () => {
    const calm = describeNeonBlock({ plan: "FREE", databaseBytes: 11 * 1024 * 1024, consumption, now: NOW });
    expect(calm.planName).toBe("Free");
    expect(calm.storage).toMatchObject({ usedMb: 11, ceilingMb: 512, percent: 2, warn: false, estimatedUsdPerMonth: null });
    expect(calm.compute).toMatchObject({ cuHours: 74.15, ceilingCuHours: 100, percent: 74, warn: false, estimatedUsd: null });
    expect(calm.compute?.elapsedHours).toBe(57);
    expect(calm.compute?.periodEnd).toEqual(PERIOD.periodEnd);
    expect(calm.rates).toBeNull();

    const red = describeNeonBlock({ plan: "FREE", databaseBytes: 450 * 1024 * 1024, consumption: { ...consumption, cuHours: 85 }, now: NOW });
    expect(red.compute?.warn).toBe(true);
    expect(red.compute?.percent).toBe(85);
    expect(red.storage.warn).toBe(true);
    expect(NEON_WARN_AT_SHARE).toBe(0.8);
  });

  it("on Launch has no ceiling and never turns red: the hours are an estimated charge at the rate", () => {
    // The owner's console, 2026-09-23: "Compute 6.43 compute hours $0.68", 11 MB of storage.
    const launch = describeNeonBlock({ plan: "LAUNCH", databaseBytes: 11 * 1024 * 1024, consumption: { ...consumption, cuHours: 6.43 }, now: NOW });
    expect(launch.planName).toBe("Launch");
    expect(launch.compute).toMatchObject({ cuHours: 6.43, ceilingCuHours: null, percent: null, warn: false, estimatedUsd: 0.68 });
    expect(launch.storage).toMatchObject({ usedMb: 11, ceilingMb: null, percent: null, warn: false });
    // 11 MiB at $0.35 a GB-month is under a cent, and it is said as a figure rather than hidden.
    expect(launch.storage.estimatedUsdPerMonth).toBe(0);
    expect(launch.rates).toEqual({ usdPerCuHour: 0.106, usdPerGbMonth: 0.35, restoreUsdPerGbMonth: 0.2 });

    // Past Free's whole allowance, and still calm: there is nothing to run out of.
    const heavy = describeNeonBlock({ plan: "LAUNCH", databaseBytes: 3 * 1024 * 1024 * 1024, consumption: { ...consumption, cuHours: 180 }, now: NOW });
    expect(heavy.compute?.warn).toBe(false);
    expect(heavy.storage.warn).toBe(false);
    expect(heavy.compute?.estimatedUsd).toBe(19.08);
    expect(heavy.storage.estimatedUsdPerMonth).toBe(1.05);
  });

  it("keeps the awake line on both plans and says nothing about compute without a reading", () => {
    for (const plan of NEON_PLAN_IDS) {
      const withReading = describeNeonBlock({ plan, databaseBytes: null, consumption, now: NOW });
      expect(withReading.compute?.activeHours).toBeCloseTo(281.4, 1);
      expect(withReading.storage).toMatchObject({ usedMb: null, percent: null, warn: false, estimatedUsdPerMonth: null });
      const without = describeNeonBlock({ plan, databaseBytes: 11 * 1024 * 1024, consumption: null, now: NOW });
      expect(without.compute).toBeNull();
      expect(without.storage.usedMb).toBe(11);
    }
  });
});
