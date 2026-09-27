import type { CreditReading } from "@/modules/translate/credit";
import type { NeonPlanId } from "./domain/neon-plan";
import { type MonthCostFacts, type MonthCostId, type MonthCostLine, monthCosts, type MonthTotals, monthTotals, previousMonth, utcMonth } from "./domain/month-costs";

/**
 * «Luna aceasta»'s facts, put together from what the page has already read and the readers only
 * this card needs (§479) — one function with its readers as arguments, so the mapping from each
 * provider's answer to `MonthCostFacts` is tested with fakes, every reader failing in turn, rather
 * than trusted to a page nobody renders in a test.
 *
 * Each reader is its own risk: a reader that throws or answers `ok: false` makes its line say why
 * and never a zero (§1.2), and never takes the rest of the card with it.
 */

/** A reading that could fail, as the card needs it: the value, or the reason in the provider's own words. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

export type MonthCostReaders = {
  /** Vercel's month, from the hour-long cache (`readVercelMonthForCosts`). */
  vercelMonth: () => Promise<{ ok: true; month: { buildMinutes: number; deployments: number } } | { ok: false; reason: string }>;
  /** The characters sent to DeepL since `since` (`charactersTranslatedSince`). */
  charactersSince: (since: Date) => Promise<number>;
  /** The messages Mailgun carried in `[start, end)` (`mailgunMessagesSentBetween`). */
  mailgunSentBetween: (start: Date, end: Date) => Promise<number>;
  /** Neon's period before the one starting at `periodStart` (`readNeonPreviousPeriod`). */
  neonPreviousPeriod: (periodStart: Date) => Promise<{ ok: true; cuHours: number } | { ok: false; reason: string }>;
  /** The pictures' recorded bytes (`storedMediaBytes`). */
  mediaBytes: () => Promise<number>;
  /** DeepL's credit from its own meter, cached an hour and expired by every press (`readTranslationCredit`, §497). */
  deeplCredit: () => Promise<CreditReading>;
};

export type MonthCostInputs = {
  now: Date;
  /** The Neon plan in force (§326). */
  neonPlan: NeonPlanId;
  /** The page's own Neon reading (`readNeonConsumption`): the meter, or why there is none. */
  neon: { ok: true; meter: { usedCuHours: number; periodStart: Date; periodEnd: Date; quotaCuHours: number | null } } | { ok: false; reason: string };
  databaseBytes: number | null;
  /** The page's own outbox reading and Mailgun plan (§100). */
  mailgun: {
    planName: string;
    /** `CUSTOM` is a typed plan whose price is not recorded: its month is unknown, never free. */
    planId: string;
    usdPerMonth: number;
    sentThisMonth: number;
    monthlyAllowance: number | null;
    dailyAllowance: number | null;
  };
  vercelBuildMinutesPerMonth: number;
  domain: { planName: string; usdPerYear: number; expiresOn: string | null };
};

/** Why each line has no reading (or no last month), keyed by line; null where it read. */
export type MonthCostReasons = {
  current: Record<MonthCostId, string | null>;
  lastMonth: Record<MonthCostId, string | null>;
  /** Why DeepL's credit has no reading (§497): `unconfigured`, or the provider's refusal; null when read. */
  deeplCredit: string | null;
};

export type MonthCostsReading = { lines: MonthCostLine[]; totals: MonthTotals; reasons: MonthCostReasons };

/** A reader that throws becomes a reason; the message of a thrown driver error is never shown (§14.3). */
async function settle<T>(read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    console.error("[month-costs] a reader failed", error);
    return { ok: false, reason: "error" };
  }
}

const noReasons = (): Record<MonthCostId, string | null> => ({ neon: null, mailgun: null, vercel: null, domain: null, deepl: null, r2: null });

export async function readMonthCosts(inputs: MonthCostInputs, readers: MonthCostReaders): Promise<MonthCostsReading> {
  const month = utcMonth(inputs.now);
  const before = previousMonth(month);
  const neonPeriodStart = inputs.neon.ok ? inputs.neon.meter.periodStart : month.start;

  const [vercel, characters, lastMailgun, lastNeon, media, credit] = await Promise.all([
    settle(readers.vercelMonth).then((read): Read<{ buildMinutes: number; deployments: number }> =>
      !read.ok ? read : read.value.ok ? { ok: true, value: read.value.month } : { ok: false, reason: read.value.reason },
    ),
    settle(() => readers.charactersSince(month.start)),
    settle(() => readers.mailgunSentBetween(before.start, before.end)),
    // Without this period's meter there is no period to ask the one before of.
    inputs.neon.ok
      ? settle(() => readers.neonPreviousPeriod(neonPeriodStart)).then((read): Read<number> =>
          !read.ok ? read : read.value.ok ? { ok: true, value: read.value.cuHours } : { ok: false, reason: read.value.reason },
        )
      : Promise.resolve<Read<number>>({ ok: false, reason: inputs.neon.reason }),
    settle(readers.mediaBytes),
    settle(readers.deeplCredit).then((read): CreditReading => (read.ok ? read.value : { ok: false, reason: "unavailable" })),
  ]);

  const facts: MonthCostFacts = {
    now: inputs.now,
    neon: { plan: inputs.neonPlan, meter: inputs.neon.ok ? inputs.neon.meter : null, databaseBytes: inputs.databaseBytes },
    mailgun: {
      planName: inputs.mailgun.planName,
      // A typed plan's price is not recorded (§100), and a zero would read as free.
      usdPerMonth: inputs.mailgun.planId === "CUSTOM" ? null : inputs.mailgun.usdPerMonth,
      sentThisMonth: inputs.mailgun.sentThisMonth,
      monthlyAllowance: inputs.mailgun.monthlyAllowance,
      dailyAllowance: inputs.mailgun.dailyAllowance,
    },
    vercel: vercel.ok ? vercel.value : null,
    vercelBuildMinutesPerMonth: inputs.vercelBuildMinutesPerMonth,
    domain: inputs.domain,
    deepl: characters.ok ? { charactersThisMonth: characters.value } : null,
    deeplCredit: { expected: credit.ok || credit.reason !== "unconfigured", credit: credit.ok ? credit.credit : null },
    r2: media.ok ? { storedBytes: media.value } : null,
    lastMonth: {
      neonCuHours: lastNeon.ok ? lastNeon.value : null,
      mailgunSent: lastMailgun.ok ? lastMailgun.value : null,
    },
  };
  const lines = monthCosts(facts);

  const current = noReasons();
  if (!inputs.neon.ok) current.neon = inputs.neon.reason;
  if (!vercel.ok) current.vercel = vercel.reason;
  if (!characters.ok) current.deepl = characters.reason;
  if (!media.ok) current.r2 = media.reason;
  if (inputs.mailgun.planId === "CUSTOM") current.mailgun = "typed plan";

  const lastMonth = noReasons();
  // Free bills nothing whatever the history says, so an unread history is not a missing amount there.
  if (!lastNeon.ok && inputs.neonPlan !== "FREE") lastMonth.neon = lastNeon.reason;
  if (!lastMailgun.ok) lastMonth.mailgun = lastMailgun.reason;
  if (inputs.mailgun.planId === "CUSTOM") lastMonth.mailgun = "typed plan";
  if (!media.ok) lastMonth.r2 = media.reason;

  return { lines, totals: monthTotals(lines), reasons: { current, lastMonth, deeplCredit: credit.ok ? null : credit.reason } };
}
