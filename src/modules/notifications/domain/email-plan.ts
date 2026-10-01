import { z } from "zod";
import { DEFAULT_HOURLY_ALLOWANCE, MAX_HOURLY_ALLOWANCE } from "./hourly-pace";

/**
 * The Mailgun plans, as the club can be on them (`DECISIONS.md` §100).
 *
 * Read from mailgun.com/pricing on 2026-09-19. Free is a *daily* ceiling; every paid plan is a
 * *monthly* one with no daily limit, and Basic's ten thousand a month is more than the club
 * sends in a season — which is why the decision on `/admin/tasks` is "one month of Basic
 * around the race" rather than a subscription. `CUSTOM` is for whatever Mailgun says the day
 * the plan changes: an Administrator types the ceilings the dashboard shows.
 *
 * The numbers are a fact about the vendor, not configuration; `EMAIL_PLANS_CHECKED_ON` says
 * how old they are, and the page that shows them says so too.
 *
 * No plan here carries an hourly ceiling, on purpose (§NNN): Mailgun's hundred an hour is the
 * *account's* probation — an account Mailgun put on probation — not a fact of any plan,
 * and it ends when Mailgun's support lifts it. So it is the setting's own field, `hourlyAllowance`,
 * whatever plan is chosen.
 */
export const EMAIL_PLAN_IDS = ["FREE", "BASIC", "FOUNDATION", "SCALE", "CUSTOM"] as const;
export type EmailPlanId = (typeof EMAIL_PLAN_IDS)[number];

export const EMAIL_PLANS_CHECKED_ON = "2026-09-19";

export type EmailPlanCatalogueEntry = {
  name: string;
  /** Messages a day, or null when the plan has no daily ceiling. */
  dailyAllowance: number | null;
  /** Messages a month, or null when the plan has no monthly ceiling. */
  monthlyAllowance: number | null;
  /** What Mailgun bills a month, in USD; zero on Free. */
  usdPerMonth: number;
};

export const EMAIL_PLANS: Record<Exclude<EmailPlanId, "CUSTOM">, EmailPlanCatalogueEntry> = {
  FREE: { name: "Free", dailyAllowance: 100, monthlyAllowance: null, usdPerMonth: 0 },
  BASIC: { name: "Basic", dailyAllowance: null, monthlyAllowance: 10_000, usdPerMonth: 15 },
  FOUNDATION: { name: "Foundation", dailyAllowance: null, monthlyAllowance: 50_000, usdPerMonth: 35 },
  SCALE: { name: "Scale", dailyAllowance: null, monthlyAllowance: 100_000, usdPerMonth: 90 },
};

/** The setting as stored under `platform_settings.emailPlan` and as an Administrator submits it. */
export const emailPlanSettingSchema = z
  .object({
    plan: z.enum(EMAIL_PLAN_IDS),
    /** Only read for `CUSTOM`; the catalogue answers for the others. Null means no ceiling. */
    dailyAllowance: z.number().int().min(1).max(1_000_000).nullable().default(null),
    monthlyAllowance: z.number().int().min(1).max(10_000_000).nullable().default(null),
    /**
     * The most Mailgun's road sends in any hour (§NNN, counted over `PACE_WINDOW_MS`), whatever the plan: Mailgun's
     * probation. A stored value written before the field existed has none and reads 100, so
     * production paces from the first deploy; null — the box cleared — is no pace at all.
     */
    hourlyAllowance: z.number().int().min(1).max(MAX_HOURLY_ALLOWANCE).nullable().default(DEFAULT_HOURLY_ALLOWANCE),
    /** Why, for the next person: "Basic for October's race, cancel on the 20th". */
    note: z.string().trim().max(200).default(""),
  })
  .strict();

export type EmailPlanSetting = z.infer<typeof emailPlanSettingSchema>;

export const DEFAULT_EMAIL_PLAN: EmailPlanSetting = {
  plan: "FREE",
  dailyAllowance: null,
  monthlyAllowance: null,
  hourlyAllowance: DEFAULT_HOURLY_ALLOWANCE,
  note: "",
};

/**
 * Whether a plan takes the ceilings an Administrator types (§100): only «Altceva» (`CUSTOM`).
 * The form shows the two boxes only while such a plan is chosen, and the service drops whatever
 * the boxes held for any other plan before it validates (§551, amending §100).
 */
export function takesTypedCeilings(plan: EmailPlanId): boolean {
  return plan === "CUSTOM";
}

/** The plans whose choice shows the typed-ceiling boxes, in the select's order. */
export const TYPED_CEILING_PLAN_IDS: readonly EmailPlanId[] = EMAIL_PLAN_IDS.filter(takesTypedCeilings);

/** The ceilings in force for a setting: the catalogue's, or the typed ones for `CUSTOM`. */
export type EmailCeilings = {
  planName: string;
  dailyAllowance: number | null;
  monthlyAllowance: number | null;
  usdPerMonth: number;
};

export function emailCeilings(
  // The hourly pace is not a ceiling of the plan (§NNN): a setting written without it still answers.
  setting: Pick<EmailPlanSetting, "plan" | "dailyAllowance" | "monthlyAllowance"> & Partial<EmailPlanSetting>,
): EmailCeilings {
  if (setting.plan === "CUSTOM") {
    return {
      planName: "Custom",
      dailyAllowance: setting.dailyAllowance,
      monthlyAllowance: setting.monthlyAllowance,
      // Unknown, and better shown as nothing than as a number somebody made up.
      usdPerMonth: 0,
    };
  }
  const entry = EMAIL_PLANS[setting.plan];
  return {
    planName: entry.name,
    dailyAllowance: entry.dailyAllowance,
    monthlyAllowance: entry.monthlyAllowance,
    usdPerMonth: entry.usdPerMonth,
  };
}

/**
 * What can still be sent right now, and over which period the ceiling that binds is counted.
 *
 * The daily ceiling binds when there is one; otherwise the monthly one; otherwise nothing
 * does and both figures are null — "unlimited" is a word the pages print, not a number.
 */
export function emailHeadroom(
  ceilings: EmailCeilings,
  sentToday: number,
  sentThisMonth: number,
): { period: "day" | "month" | "none"; allowance: number | null; remaining: number | null } {
  if (ceilings.dailyAllowance !== null) {
    return {
      period: "day",
      allowance: ceilings.dailyAllowance,
      remaining: Math.max(0, ceilings.dailyAllowance - sentToday),
    };
  }
  if (ceilings.monthlyAllowance !== null) {
    return {
      period: "month",
      allowance: ceilings.monthlyAllowance,
      remaining: Math.max(0, ceilings.monthlyAllowance - sentThisMonth),
    };
  }
  return { period: "none", allowance: null, remaining: null };
}

/** The plan Mailgun offers after this one, for the "what comes next" column on the task board. */
export function nextEmailPlan(plan: EmailPlanId): Exclude<EmailPlanId, "CUSTOM" | "FREE"> | null {
  switch (plan) {
    case "FREE":
      return "BASIC";
    case "BASIC":
      return "FOUNDATION";
    case "FOUNDATION":
      return "SCALE";
    default:
      return null;
  }
}
