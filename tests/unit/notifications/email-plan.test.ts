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
import {
  DEFAULT_HOURLY_ALLOWANCE,
  hourlyRoom,
  isRatePaused,
  PACE_EVIDENCE_MS,
  PACE_WINDOW_MS,
  paceHolds,
  pauseIsRecent,
  RATE_PAUSE_ERROR_PREFIX,
} from "@/modules/notifications/domain/hourly-pace";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";

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
    // No hourly pace stored reads Mailgun's probation, a hundred an hour (§NNN).
    expect(ok).toEqual({ plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: 100, note: "" });
    expect(EMAIL_PLAN_IDS).toContain("CUSTOM");
  });
});

/** §NNN — Mailgun's hourly pace: the setting's own field, whatever the plan, never a plan's fact. */
describe("the hourly pace", () => {
  it("reads 100 from a value stored before the field existed, and keeps a cleared one cleared", () => {
    // What production holds today: the setting as §100 wrote it, no hourly field.
    expect(emailPlanSettingSchema.parse({ plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, note: "x" }).hourlyAllowance).toBe(DEFAULT_HOURLY_ALLOWANCE);
    expect(DEFAULT_EMAIL_PLAN.hourlyAllowance).toBe(100);
    expect(emailPlanSettingSchema.parse({ plan: "BASIC", hourlyAllowance: null }).hourlyAllowance).toBeNull();
    expect(emailPlanSettingSchema.parse({ plan: "FREE", hourlyAllowance: 300 }).hourlyAllowance).toBe(300);
  });

  it("refuses a pace the box cannot mean", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, 100_001]) {
      expect(emailPlanSettingSchema.safeParse({ plan: "BASIC", hourlyAllowance: bad }).success).toBe(false);
    }
  });

  it("puts no hourly ceiling in the catalogue: the probation is the account's", () => {
    for (const entry of Object.values(EMAIL_PLANS)) expect(Object.keys(entry)).not.toContain("hourlyAllowance");
  });

  it("leaves the room the hour has, never below zero, and none to count without a pace", () => {
    expect(hourlyRoom(100, 60)).toBe(40);
    expect(hourlyRoom(100, 100)).toBe(0);
    expect(hourlyRoom(100, 130)).toBe(0);
    expect(hourlyRoom(null, 500)).toBeNull();
  });

  it("calls a backlog the pace working only while a pace is set and the hour binds", () => {
    expect(paceHolds({ hourlyAllowance: 100, carriedRecently: 100, inFlight: 0 })).toBe(true);
    expect(paceHolds({ hourlyAllowance: 100, carriedRecently: 90, inFlight: 10 })).toBe(true);
    // Mailgun carrying a message or two is not the pace: an hour with room holds nothing back.
    expect(paceHolds({ hourlyAllowance: 100, carriedRecently: 1, inFlight: 0 })).toBe(false);
    expect(paceHolds({ hourlyAllowance: 100, carriedRecently: 99, inFlight: 0 })).toBe(false);
    expect(paceHolds({ hourlyAllowance: null, carriedRecently: 400, inFlight: 0 })).toBe(false);
    // The evidence window is `/api/health`'s own ninety minutes (§98).
    expect(PACE_EVIDENCE_MS).toBe(EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS);
  });

  it("counts the hour over sixty-one minutes: a minute of margin against Mailgun's own clock", () => {
    expect(PACE_WINDOW_MS).toBe(61 * 60_000);
  });

  it("tells a provider's pause from any other reason on the row", () => {
    expect(isRatePaused(`${RATE_PAUSE_ERROR_PREFIX}mailgun 429: Too Many Requests`)).toBe(true);
    expect(isRatePaused("mailgun 500: Internal Server Error")).toBe(false);
    expect(isRatePaused(null)).toBe(false);
  });

  it("calls a pause recent only while it ended less than the evidence window ago", () => {
    const now = new Date("2026-10-01T09:30:00.000Z");
    const lastError = `${RATE_PAUSE_ERROR_PREFIX}mailgun 429: Too Many Requests`;
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    expect(pauseIsRecent({ lastError, nextAttemptAt: at(10) }, now)).toBe(true);
    expect(pauseIsRecent({ lastError, nextAttemptAt: at(-89) }, now)).toBe(true);
    expect(pauseIsRecent({ lastError, nextAttemptAt: at(-91) }, now)).toBe(false);
    expect(pauseIsRecent({ lastError, nextAttemptAt: null }, now)).toBe(false);
    expect(pauseIsRecent({ lastError: "mailgun 500", nextAttemptAt: at(10) }, now)).toBe(false);
  });
});
