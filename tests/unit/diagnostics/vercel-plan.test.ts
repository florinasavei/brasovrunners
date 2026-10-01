import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  DEFAULT_VERCEL_PLAN,
  readVercelPlanValue,
  VERCEL_MAX_SEATS,
  VERCEL_PLAN_IDS,
  VERCEL_PLANS,
  VERCEL_PLANS_CHECKED_ON,
  vercelPlanSettingSchema,
  vercelUsdPerMonth,
} from "@/modules/diagnostics/domain/vercel-plan";

/**
 * BR-REQ-090-05, §NNN — the Vercel plan is a setting: Hobby when nobody said otherwise, Pro with
 * its developer seats when an Administrator says so, and the one price the pages print comes from
 * the catalogue, dated, the way `docs/PLATFORM.md` quotes it.
 */
describe("§NNN the Vercel plan setting", () => {
  it("is Hobby with one seat when absent, when unreadable, and when it says something this code does not know", () => {
    expect(DEFAULT_VERCEL_PLAN).toEqual({ plan: "HOBBY", seats: 1, note: "" });
    for (const garbage of [undefined, null, "PRO", 42, [], { plan: "ENTERPRISE" }, { plan: "PRO", seats: 0 }, { plan: "PRO", extra: true }]) {
      expect(readVercelPlanValue(garbage), JSON.stringify(garbage) ?? "undefined").toEqual(DEFAULT_VERCEL_PLAN);
    }
  });

  it("round-trips Pro with its seats and a trimmed note, and defaults the seats and the note", () => {
    expect(readVercelPlanValue({ plan: "PRO", seats: 2, note: "  for the race; Hobby after 21 November  " })).toEqual({
      plan: "PRO",
      seats: 2,
      note: "for the race; Hobby after 21 November",
    });
    expect(vercelPlanSettingSchema.parse({ plan: "PRO" })).toEqual({ plan: "PRO", seats: 1, note: "" });
  });

  it("takes a whole number of seats from 1 to 20 and refuses the rest", () => {
    expect(VERCEL_MAX_SEATS).toBe(20);
    expect(vercelPlanSettingSchema.safeParse({ plan: "PRO", seats: 1 }).success).toBe(true);
    expect(vercelPlanSettingSchema.safeParse({ plan: "PRO", seats: 20 }).success).toBe(true);
    for (const seats of [0, 21, -1, 1.5, Number.NaN, "2"]) {
      expect(vercelPlanSettingSchema.safeParse({ plan: "PRO", seats }).success, String(seats)).toBe(false);
    }
  });

  it("refuses a plan it does not know, a missing plan and a note too long", () => {
    expect(vercelPlanSettingSchema.safeParse({ plan: "ENTERPRISE" }).success).toBe(false);
    expect(vercelPlanSettingSchema.safeParse({}).success).toBe(false);
    expect(vercelPlanSettingSchema.safeParse({ plan: "HOBBY", note: "x".repeat(201) }).success).toBe(false);
    expect(VERCEL_PLAN_IDS).toEqual(["HOBBY", "PRO"]);
  });
});

describe("§NNN the one Vercel price", () => {
  it("is $20 a developer seat a month on Pro, with $20 of usage included, checked with the other vendors", () => {
    // `docs/PLATFORM.md` § Subscriptions: «Pro $20/month per developer seat … $20 usage credit included».
    expect(VERCEL_PLANS_CHECKED_ON).toBe("2026-09-05");
    expect(VERCEL_PLANS.HOBBY).toEqual({ name: "Hobby", usdPerSeatPerMonth: 0, usdUsageCreditPerMonth: 0 });
    expect(VERCEL_PLANS.PRO).toEqual({ name: "Pro", usdPerSeatPerMonth: 20, usdUsageCreditPerMonth: 20 });
    expect(vercelUsdPerMonth({ plan: "PRO", seats: 3 })).toBe(60);
    expect(vercelUsdPerMonth({ plan: "HOBBY", seats: 3 })).toBe(0);
  });

  it("keeps the price out of the words: every Vercel sentence quotes it through a placeholder", () => {
    const flatten = (node: unknown, into: string[] = []): string[] => {
      if (typeof node === "string") into.push(node);
      else if (node && typeof node === "object") for (const value of Object.values(node)) flatten(value, into);
      return into;
    };
    for (const messages of [ro, en]) {
      const tasks = messages.Admin.tasks as unknown as { vercelPlan: unknown; services: { vercel: { pro: unknown } } };
      for (const message of [...flatten(tasks.vercelPlan), ...flatten(tasks.services.vercel.pro)]) {
        expect(message).not.toMatch(/\$\s?\d|\d\s?(USD|\$)/);
      }
    }
  });
});
