import { z } from "zod";

/**
 * The Vercel plans, as the club can be on them — and the one Vercel price the pages print, with
 * the date it was checked (§610).
 *
 * `docs/PLATFORM.md` § "Subscriptions, limits and cost", checked 2026-09-05: Hobby is free and for
 * non-commercial use; Pro is **$20 a month per developer seat**, viewer seats free, with $20 of
 * usage credit included and usage beyond it billed on top. Nothing else is quoted here — Pro's own
 * ceilings are on Vercel's dashboard, not in this file, and a figure the docs do not state is not
 * invented (`AGENTS.md` §1.2).
 *
 * The club took Pro on 2026-09-30, for the function quota before the 21 November race, while every
 * page went on printing Hobby and «Prima cheltuială care urmează: Vercel Pro». So the plan is a
 * setting an Administrator states on «Setări» → «Costuri» (`platform_settings.vercelPlan`), the same
 * shape as the Mailgun plan (§100) and the Neon plan (§306) — with the seats, because Pro is priced
 * per seat. Vercel's API is not asked: reading the plan from Vercel's own answer first, the setting
 * as the fallback, is the follow-up, in §326's shape.
 */
export const VERCEL_PLAN_IDS = ["HOBBY", "PRO"] as const;
export type VercelPlanId = (typeof VERCEL_PLAN_IDS)[number];

export const VERCEL_PLANS_CHECKED_ON = "2026-09-05";

export type VercelPlanCatalogueEntry = {
  name: string;
  /** What Vercel bills a month per developer seat, in USD; zero on Hobby. */
  usdPerSeatPerMonth: number;
  /**
   * The usage credit the plan includes a month, in USD: usage up to it costs nothing more, usage
   * beyond it is billed on top. Part of the seat's price, never a cost of its own (§610).
   */
  usdUsageCreditPerMonth: number;
};

export const VERCEL_PLANS: Record<VercelPlanId, VercelPlanCatalogueEntry> = {
  HOBBY: { name: "Hobby", usdPerSeatPerMonth: 0, usdUsageCreditPerMonth: 0 },
  PRO: { name: "Pro", usdPerSeatPerMonth: 20, usdUsageCreditPerMonth: 20 },
};

/** The most seats the form accepts: a club's handful of people who deploy, with room to spare. */
export const VERCEL_MAX_SEATS = 20;

/** The setting as stored under `platform_settings.vercelPlan` and as an Administrator submits it. */
export const vercelPlanSettingSchema = z
  .object({
    plan: z.enum(VERCEL_PLAN_IDS),
    /** Developer seats — what Pro is priced by. Read on Pro only; Hobby has one free seat. */
    seats: z.number().int().min(1).max(VERCEL_MAX_SEATS).default(1),
    /** Why, for the next person: "Pro for the race; back to Hobby after 21 November". */
    note: z.string().trim().max(200).default(""),
  })
  .strict();

export type VercelPlanSetting = z.infer<typeof vercelPlanSettingSchema>;

/**
 * Hobby when nobody has said otherwise, so a deployment that never set the plan reads exactly as it
 * did before the setting existed — the free plan, priced at nothing.
 */
export const DEFAULT_VERCEL_PLAN: VercelPlanSetting = { plan: "HOBBY", seats: 1, note: "" };

/**
 * What a stored value means: the setting when it parses, the default when it is absent or is
 * something this code cannot read. One function, so the service and the tests agree on it.
 */
export function readVercelPlanValue(value: unknown): VercelPlanSetting {
  const parsed = vercelPlanSettingSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_VERCEL_PLAN };
}

/** What the plan costs a month, in USD: the seat price times the seats — zero on Hobby. */
export function vercelUsdPerMonth(setting: Pick<VercelPlanSetting, "plan" | "seats">): number {
  return VERCEL_PLANS[setting.plan].usdPerSeatPerMonth * setting.seats;
}
