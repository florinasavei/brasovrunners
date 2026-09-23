import { z } from "zod";

/**
 * The Neon plans, as the club can be on them — and every Neon figure the pages print, in one
 * place with the date it was checked (`DECISIONS.md` §280 and its follow-up).
 *
 * Read from the owner's Neon billing console and neon.com/pricing on 2026-09-22: Free gives
 * 100 CU-hours a month per project and half a gigabyte of storage, and *suspends the compute*
 * when the hours run out — the site is down until the next month. Launch removes both limits
 * and bills what is used: $0.106 per CU-hour (the console's 1.8 hours for $0.19 reconcile to
 * it), $0.35 per GB-month of storage and $0.20 per GB-month of changes kept for Instant
 * Restore, with no monthly minimum. Neon's API tells this code the consumption and the plan of
 * the account that owns the project (`owner.subscription_type` on the project row, which a
 * project-scoped key reads — §NNN), never the invoice. So the plan Neon reports is the plan,
 * and every figure on `/devs` and `/admin/tasks` follows it; the setting an Administrator
 * states (`platform_settings.neonPlan`, the same shape as the Mailgun plan's, §100) is what the
 * pages fall back on when the key is not set or Neon does not answer.
 *
 * `CUSTOM` is deliberately not here. The Mailgun catalogue needed it because Mailgun's plans
 * change faster than this code; Neon has two plans the club can be on and a third (Scale) the
 * club has no reason for. Adding one is a row in this table and a value in the enum below.
 *
 * The numbers are a fact about the vendor, not configuration; `NEON_PLANS_CHECKED_ON` says how
 * old they are, and the panel that shows them says so too.
 */
export const NEON_PLAN_IDS = ["FREE", "LAUNCH"] as const;
export type NeonPlanId = (typeof NEON_PLAN_IDS)[number];

export const NEON_PLANS_CHECKED_ON = "2026-09-22";

export type NeonPlanCatalogueEntry = {
  name: string;
  /** Compute hours a month per project, or null when the plan bills them instead of capping them. */
  cuHoursPerMonth: number | null;
  /** Storage per project, or null when the plan bills it instead of capping it. */
  storageBytes: number | null;
  /** What Neon bills per CU-hour, in USD; zero on Free, where the hours are included and then refused. */
  usdPerCuHour: number;
  /** What Neon bills per GB-month of storage, in USD; zero on Free. */
  usdPerGbMonth: number;
  /** What Neon bills per GB-month of changes kept for Instant Restore, in USD; zero on Free. */
  restoreUsdPerGbMonth: number;
  /** Whether running out stops the database — true on Free, where the compute is suspended. */
  suspendsWhenSpent: boolean;
};

export const NEON_PLANS: Record<NeonPlanId, NeonPlanCatalogueEntry> = {
  FREE: {
    name: "Free",
    cuHoursPerMonth: 100,
    storageBytes: 512 * 1024 * 1024,
    usdPerCuHour: 0,
    usdPerGbMonth: 0,
    restoreUsdPerGbMonth: 0,
    suspendsWhenSpent: true,
  },
  LAUNCH: {
    name: "Launch",
    cuHoursPerMonth: null,
    storageBytes: null,
    usdPerCuHour: 0.106,
    usdPerGbMonth: 0.35,
    restoreUsdPerGbMonth: 0.2,
    suspendsWhenSpent: false,
  },
};

/**
 * Past this share of a ceiling the figure is red (§68): on Free the compute stops at 100%, and a
 * warning at the very end would be a warning after the fact. Only a plan with a ceiling has it.
 */
export const NEON_WARN_AT_SHARE = 0.8;

/** The setting as stored under `platform_settings.neonPlan` and as an Administrator submits it. */
export const neonPlanSettingSchema = z
  .object({
    plan: z.enum(NEON_PLAN_IDS),
    /** Why, for the next person: "Launch since 22 September; review in December". */
    note: z.string().trim().max(200).default(""),
  })
  .strict();

export type NeonPlanSetting = z.infer<typeof neonPlanSettingSchema>;

/**
 * Free when nobody has said otherwise.
 *
 * Not Launch, although the club's account has been on Launch since 2026-09-22: a fresh
 * deployment has no reason to assume money, and a default that assumed it would hide a Free
 * project's real cutoff behind a calm "pay as you go" until somebody noticed the site was down.
 * The Administrator states the plan once per environment; the row is then the truth, and a
 * value this code can no longer read falls back here — the plan with the ceilings.
 */
export const DEFAULT_NEON_PLAN: NeonPlanSetting = { plan: "FREE", note: "" };

/**
 * What a stored value means: the setting when it parses, the default when it is absent or is
 * something this code cannot read. One function, so the service and the tests agree on it.
 */
export function readNeonPlanValue(value: unknown): NeonPlanSetting {
  const parsed = neonPlanSettingSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_NEON_PLAN };
}

/**
 * The plan Neon reports for the account that owns the project (§NNN): the project row's
 * `owner.subscription_type` — `"launch_v3"` for the club on 2026-09-23, `"free_v3"` on Free.
 * The suffix is Neon's pricing generation, so the prefix is what is matched; anything else
 * (Scale, Business, a name this code has not met) is null, and the stated setting decides
 * rather than a guess.
 */
export function neonPlanFromSubscription(subscriptionType: unknown): NeonPlanId | null {
  if (typeof subscriptionType !== "string") return null;
  const value = subscriptionType.trim().toLowerCase();
  if (value.startsWith("free")) return "FREE";
  if (value.startsWith("launch")) return "LAUNCH";
  return null;
}

/**
 * The plan every figure is read against: what Neon reports when it answered, the stated
 * setting when it did not (§NNN). The owner, 2026-09-23, with Launch bought the day before
 * and `/admin/tasks` still printing Free: a setting nobody had changed was being believed over
 * the vendor's own answer, which the page had been receiving all along.
 */
export function effectiveNeonPlan(
  stated: NeonPlanId,
  reported: NeonPlanId | null,
): { plan: NeonPlanId; source: "neon" | "setting" } {
  return reported ? { plan: reported, source: "neon" } : { plan: stated, source: "setting" };
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * What the block on `/devs` prints for one plan and one reading of the system — as numbers, so
 * the page picks the sentence and the tests pin the arithmetic.
 *
 * On Free every figure has a ceiling and a share, and the compute line turns red at eighty
 * percent because a hundred percent is the site going down. On Launch nothing has a ceiling
 * and nothing turns red: the same hours become an **estimated** charge at the catalogue rate.
 * Estimated, because Neon's API gives the consumption and not the invoice — the invoice adds
 * the storage and the restore history over the whole period and rounds its own way.
 */
export type NeonBlockModel = {
  plan: NeonPlanId;
  planName: string;
  storage: {
    usedBytes: number | null;
    /** Whole megabytes, one decimal — what the page prints. */
    usedMb: number | null;
    ceilingMb: number | null;
    percent: number | null;
    warn: boolean;
    /** Launch only: this size at the storage rate, for a full month, in USD. */
    estimatedUsdPerMonth: number | null;
  };
  compute: {
    cuHours: number;
    ceilingCuHours: number | null;
    percent: number | null;
    warn: boolean;
    /** Launch only: the hours used so far at the compute rate, in USD. */
    estimatedUsd: number | null;
    activeHours: number;
    elapsedHours: number;
    periodEnd: Date;
  } | null;
  /** Launch only: the rates the estimates were made at, for the sentence that quotes them. */
  rates: { usdPerCuHour: number; usdPerGbMonth: number; restoreUsdPerGbMonth: number } | null;
};

export function describeNeonBlock(input: {
  plan: NeonPlanId;
  databaseBytes: number | null;
  consumption: { cuHours: number; activeHours: number; periodStart: Date; periodEnd: Date } | null;
  now: Date;
}): NeonBlockModel {
  const entry = NEON_PLANS[input.plan];
  const billed = entry.cuHoursPerMonth === null;

  const usedBytes = input.databaseBytes;
  const storage: NeonBlockModel["storage"] = {
    usedBytes,
    usedMb: usedBytes === null ? null : Math.round((usedBytes / MB) * 10) / 10,
    ceilingMb: entry.storageBytes === null ? null : Math.round(entry.storageBytes / MB),
    percent: usedBytes === null || entry.storageBytes === null ? null : Math.round((usedBytes / entry.storageBytes) * 100),
    warn: usedBytes !== null && entry.storageBytes !== null && usedBytes >= entry.storageBytes * NEON_WARN_AT_SHARE,
    estimatedUsdPerMonth: billed && usedBytes !== null ? roundUsd((usedBytes / GB) * entry.usdPerGbMonth) : null,
  };

  const c = input.consumption;
  const compute: NeonBlockModel["compute"] = c
    ? {
        cuHours: c.cuHours,
        ceilingCuHours: entry.cuHoursPerMonth,
        percent: entry.cuHoursPerMonth === null ? null : Math.round((c.cuHours / entry.cuHoursPerMonth) * 100),
        warn: entry.cuHoursPerMonth !== null && c.cuHours >= entry.cuHoursPerMonth * NEON_WARN_AT_SHARE,
        estimatedUsd: billed ? roundUsd(c.cuHours * entry.usdPerCuHour) : null,
        activeHours: c.activeHours,
        elapsedHours: Math.max(0, (input.now.getTime() - c.periodStart.getTime()) / 3_600_000),
        periodEnd: c.periodEnd,
      }
    : null;

  return {
    plan: input.plan,
    planName: entry.name,
    storage,
    compute,
    rates: billed
      ? { usdPerCuHour: entry.usdPerCuHour, usdPerGbMonth: entry.usdPerGbMonth, restoreUsdPerGbMonth: entry.restoreUsdPerGbMonth }
      : null,
  };
}

/** Two decimals, the way an invoice prints — and never a negative zero. */
export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}
