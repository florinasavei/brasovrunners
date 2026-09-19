import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_PLAN,
  EMAIL_PLAN_IDS,
  EMAIL_PLANS,
  emailCeilings,
  emailHeadroom,
  emailPlanSettingSchema,
  nextEmailPlan,
} from "@/modules/notifications/domain/email-plan";
import { MAILGUN_FREE_DAILY_MESSAGES } from "@/modules/notifications/volume";

/** `DECISIONS.md` §100 — the Mailgun plan as a setting: the catalogue and the arithmetic. */
describe("the email plan catalogue", () => {
  it("keeps Free as the default and the hundred a day as its ceiling", () => {
    expect(DEFAULT_EMAIL_PLAN.plan).toBe("FREE");
    expect(EMAIL_PLANS.FREE.dailyAllowance).toBe(MAILGUN_FREE_DAILY_MESSAGES);
    expect(EMAIL_PLANS.FREE.usdPerMonth).toBe(0);
  });

  it("gives every paid plan a monthly ceiling, no daily one, and a price", () => {
    for (const id of ["BASIC", "FOUNDATION", "SCALE"] as const) {
      expect(EMAIL_PLANS[id].dailyAllowance).toBeNull();
      expect(EMAIL_PLANS[id].monthlyAllowance).toBeGreaterThan(0);
      expect(EMAIL_PLANS[id].usdPerMonth).toBeGreaterThan(0);
    }
    expect(nextEmailPlan("FREE")).toBe("BASIC");
    expect(nextEmailPlan("SCALE")).toBeNull();
    expect(nextEmailPlan("CUSTOM")).toBeNull();
  });

  it("binds the day on Free, the month on a paid plan, and nothing on a contract with no numbers", () => {
    expect(emailHeadroom(emailCeilings({ ...DEFAULT_EMAIL_PLAN }), 40, 900)).toEqual({ period: "day", allowance: 100, remaining: 60 });
    expect(emailHeadroom(emailCeilings({ ...DEFAULT_EMAIL_PLAN, plan: "BASIC" }), 400, 9_990)).toEqual({ period: "month", allowance: 10_000, remaining: 10 });
    // Never below zero: a day that overshot (the deferred rows) reads as spent, not negative.
    expect(emailHeadroom(emailCeilings({ ...DEFAULT_EMAIL_PLAN }), 130, 130).remaining).toBe(0);
    const custom = emailCeilings({ plan: "CUSTOM", dailyAllowance: null, monthlyAllowance: null, note: "" });
    expect(emailHeadroom(custom, 5, 5)).toEqual({ period: "none", allowance: null, remaining: null });
    // Custom with a daily number binds on the day, as Free does.
    expect(emailHeadroom(emailCeilings({ plan: "CUSTOM", dailyAllowance: 500, monthlyAllowance: null, note: "" }), 20, 20).allowance).toBe(500);
  });

  it("refuses what the form cannot mean", () => {
    expect(emailPlanSettingSchema.safeParse({ plan: "GOLD" }).success).toBe(false);
    expect(emailPlanSettingSchema.safeParse({ plan: "CUSTOM", dailyAllowance: 0 }).success).toBe(false);
    expect(emailPlanSettingSchema.safeParse({ plan: "CUSTOM", dailyAllowance: 2.5 }).success).toBe(false);
    expect(emailPlanSettingSchema.safeParse({ plan: "BASIC", note: "x".repeat(201) }).success).toBe(false);
    const ok = emailPlanSettingSchema.parse({ plan: "BASIC" });
    expect(ok).toEqual({ plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, note: "" });
    expect(EMAIL_PLAN_IDS).toContain("CUSTOM");
  });
});
