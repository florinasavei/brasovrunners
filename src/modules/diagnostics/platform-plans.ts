/**
 * What this platform costs the club, and what its free plans refuse.
 *
 * `/devs` answers "is this deployment configured correctly" and the task list above it answers
 * "what is waiting on me". This answers the third question, the one a volunteer treasurer asks
 * before a race: **what do we pay today, and what is the next thing to cost money?** The
 * alternatives that were researched and not taken used to be here too; they are `DECISIONS.md`'s
 * and were cut on 2026-09-17 (§61) so the page is today's answer and not a history of it.
 *
 * ## Every figure here is quoted with a source and a date, never computed and never remembered
 *
 * `AGENTS.md` §1.2 forbids inventing a vendor's plan or price, and a page somebody reads before
 * spending the club's money is the worst possible place to guess. Each figure below is recorded
 * in `docs/PLATFORM.md` § "Subscriptions, limits and cost" with the date it was verified against
 * the vendor's own page, and each row carries **its own** check date rather than sharing one —
 * the domain price was established later than the rest, and a shared date would have claimed a
 * re-check of six vendors that never happened.
 *
 * ## Currency: the vendor's own, and no exchange rate
 *
 * Decided here rather than left implicit. The club's money is RON; every vendor on this page
 * prices in EUR or USD, and none of them will ever issue a RON invoice — except the domain
 * registry, which converts at the National Bank's rate **on the invoice date**, a rate nobody
 * can know in advance. Printing a leu figure would mean choosing an exchange rate, stamping it
 * with a date, and watching it drift into a number no invoice ever matches; it would also be
 * arithmetic this file did on a vendor's behalf, which is what §1.2 is about. So every amount is
 * shown in the currency the vendor charges in, totals are per currency, and the conversion to
 * lei is named as the registrar's own step rather than performed here.
 *
 * ## Amounts are numbers, ceilings are quotations
 *
 * `costToday` is a number because the page has to total it — four sections and no total is what
 * this replaced. `nextCost` stays a string, because `$0.106/CU-hour` and `$20/mo per seat` are
 * not quantities to add up, and the moment they became numbers somebody would total them and
 * publish a figure no vendor ever gave.
 *
 * The one exception is a plan billed on usage — Neon Launch since 2026-09-22 — where the only
 * honest number *is* a projection: this month's pace at the vendor's rate, marked as an
 * estimate everywhere it is printed, and the total that includes it marked the same way.
 */

import { NEON_PLANS, type NeonPlanId, NEON_PLANS_CHECKED_ON, roundUsd } from "./domain/neon-plan";

export type CurrencyCode = "EUR" | "USD";

export type ServiceId = "domain" | "mailgun" | "vercel" | "neon" | "zitadel" | "scheduler";

/**
 * What this service costs the club per year, right now.
 *
 * `notTaken` is not `free`: nothing is bought, so nothing is being paid — but there is no free
 * plan to stay on either. No row carries it today, since the domain was bought on 2026-09-16; it
 * stays in the type because the `.ro` will be exactly this until it is bought.
 */
export type AnnualCost =
  | { kind: "free" }
  | { kind: "notTaken" }
  | { kind: "paid"; amount: number; currency: CurrencyCode; plusVat: boolean }
  /**
   * Billed on what is used, with no fixed price to quote: the Neon Launch row. The figure is
   * this month's pace projected to a full month at the vendor's rate, or null when nothing
   * measures the pace (no API key) — and the page prints the word for that, never a zero.
   */
  | { kind: "usage"; currency: CurrencyCode; estimatedPerMonth: number | null };

/**
 * How close this deployment is to the ceiling, right now.
 *
 * `measured` is read from this deployment's own data. `derived` is a yes/no fact about the
 * deployment. `notMeasured` says so out loud: a row with nothing behind it must not look
 * healthy, because "we never checked" and "we are fine" are otherwise the same green tick.
 */
export type Headroom =
  | { kind: "measured"; used: number; of: number; state: "ok" | "close" | "reached" }
  | { kind: "derived"; reached: boolean }
  | { kind: "notMeasured" };

/**
 * Neon Launch's rates, from the one catalogue (`domain/neon-plan.ts`, checked 2026-09-22): no
 * monthly fee, $0.106 per CU-hour, $0.35 per GB-month. The owner asked for "a monthly cost",
 * so the row projects this month's pace to a full month at those rates — what the club pays
 * on Launch, or would pay if it left Free today. Kept under these names for the callers and
 * the test that pin them.
 */
export const NEON_LAUNCH_USD_PER_CU_HOUR = NEON_PLANS.LAUNCH.usdPerCuHour;
export const NEON_LAUNCH_USD_PER_GB_MONTH = NEON_PLANS.LAUNCH.usdPerGbMonth;

export function projectedNeonLaunchUsdPerMonth(
  input: Pick<PlatformFacts, "neonCuHoursThisMonth" | "neonHoursElapsed" | "databaseBytes">,
): number | null {
  if (typeof input.neonCuHoursThisMonth !== "number" || !input.neonHoursElapsed || input.neonHoursElapsed <= 0) return null;
  const monthHours = 30 * 24;
  const cuHoursPerMonth = (input.neonCuHoursThisMonth / input.neonHoursElapsed) * monthHours;
  const gb = typeof input.databaseBytes === "number" ? input.databaseBytes / (1024 * 1024 * 1024) : 0;
  return roundUsd(cuHoursPerMonth * NEON_LAUNCH_USD_PER_CU_HOUR + gb * NEON_LAUNCH_USD_PER_GB_MONTH);
}

/**
 * The last known daily rate: CU-hours a day at this period's pace, or null without a reading.
 * One decimal, because "1.8 CU-hours a day" is what §280 reasoned from and what the row prints
 * beside the projection so a reader can check it.
 */
export function neonCuHoursPerDay(
  input: Pick<PlatformFacts, "neonCuHoursThisMonth" | "neonHoursElapsed">,
): number | null {
  if (typeof input.neonCuHoursThisMonth !== "number" || !input.neonHoursElapsed || input.neonHoursElapsed <= 0) return null;
  return Math.round((input.neonCuHoursThisMonth / input.neonHoursElapsed) * 24 * 10) / 10;
}

/** A temporary bump nobody reverses is the expensive failure, so each row says which it is. */
export type BumpKind = "temporary" | "permanent";

/**
 * How the row should read at a glance, decided here rather than by the page.
 *
 * "Reached" does not mean the same thing twice: a bound domain is good news and a spent email
 * allowance is not, so a page colouring every `reached` red would shout at the club for having
 * bought its own domain. `unknown` is its own value on purpose — a ceiling nothing measures may
 * not render green (§1.2: absence of a figure is not evidence of headroom).
 */
export type ServiceSeverity = "ok" | "unknown" | "watch" | "act";

export type ServiceRow = {
  id: ServiceId;
  /** The plan held today, or null where no provider has been chosen at all. */
  planToday: string | null;
  costToday: AnnualCost;
  /** The date the figures in *this* row were last checked against the vendor's own page. */
  checkedOn: string;
  headroom: Headroom;
  severity: ServiceSeverity;
  /** The next plan up and its price, in the vendor's own units. Null where there is none. */
  nextPlan: string | null;
  nextCost: string | null;
  /** Whether the upgrade above is normally bought for one window and dropped again. */
  bump: BumpKind | null;
  /**
   * Which wording the page reads for this row's fixed sentences (what the plan gives, its
   * ceiling, what crossing it does, the way back down): `services.<id>.<variant>.*` when set,
   * `services.<id>.*` otherwise. Set only where the plan in force changes what is true — the
   * Neon row on Launch, whose "first limit" is no longer a limit.
   */
  variant?: "launch";
};

/**
 * The `.com` registry price — Verisign's wholesale fee, checked 2026-09-16.
 *
 * $10.26 a year until 2026-11-01 and $10.97 from then on (Verisign's announced increase, the
 * first since September 2024). The higher figure is quoted because it is what the club renews
 * at. This is the **registry** price, which no club can buy at directly: the registrar (ROMARG,
 * `DECISIONS.md` §56) adds its margin and Romania's VAT and invoices in lei at the National
 * Bank's rate on the day, which is why the page calls this the registry price and not the
 * invoice. The owner bought the `.com` on 2026-09-16 and a `.ro` follows a year later
 * (`DECISIONS.md` §55); the `.ro` is 12 EUR + VAT at ROTLD and is this row's "next plan".
 *
 * Romania's standard VAT has been 21% since 2025-08-01. The page prints the amount with "+ VAT"
 * and the rate beside it rather than one blended number, because those are two facts with two
 * sources and two expiry dates.
 */
export const DOMAIN_PRICE_USD_PER_YEAR = 10.97;
export const DOMAIN_PRICE_CHECKED_ON = "2026-09-16";
export const ROMANIAN_VAT_PERCENT = 21;
/** ROTLD's `.ro` registration fee, checked 2026-09-16 with the `.com` (`DECISIONS.md` §55). */
export const RO_DOMAIN_PRICE_EUR_PER_YEAR = 12;

/** The date `docs/PLATFORM.md` verified the six vendor plan rows. */
export const VENDOR_PLANS_CHECKED_ON = "2026-09-05";

export type PlatformFacts = {
  /**
   * The ceiling that binds on the plan the club is on (§100) — Free's hundred a day, a paid
   * plan's month — and what has been spent of it over that period. Null when nothing binds.
   */
  emailAllowance: number | null;
  emailSentToday: number;
  /** The plan's own name and monthly price, from `notifications/domain/email-plan.ts`. */
  emailPlanName?: string;
  emailPlanUsdPerMonth?: number;
  emailPeriod?: "day" | "month" | "none";
  /** The plan after this one, for the "next" column; null when there is none in the catalogue. */
  emailNextPlan?: { name: string; usdPerMonth: number } | null;
  /** Messages this application sends for one registration that completes normally. */
  messagesPerRegistration: number;
  /** The database's size in bytes, read from Postgres (§88); null when it could not be read. */
  databaseBytes?: number | null;
  /**
   * The Neon plan the club says it is on (`diagnostics/neon-plan.ts`); Free when absent, the
   * same default the setting itself has. On Free the storage is measured against the plan's
   * half gigabyte and the row is free; on Launch nothing is a ceiling and the row is a usage
   * estimate at the catalogue's rates.
   */
  neonPlan?: NeonPlanId;
  /** This month's compute so far, from Neon (`/devs` reads it with a key); null without one. */
  neonCuHoursThisMonth?: number | null;
  /** How far into the month that figure is, in hours, so it can be projected to a full month. */
  neonHoursElapsed?: number | null;
  /** Is any published event charging an entry fee? `events.cost_type = 'PAID'`. */
  hasPaidEvent: boolean;
  /**
   * Is this deployment answering on the club's own domain? False on the provider hostname and
   * on localhost. Not "is the domain bought" — that is recorded (2026-09-16, `DECISIONS.md`
   * §55) and the software cannot read it; this is the one fact about the domain it can.
   */
  clubDomainBound: boolean;
  /** Are the scheduled jobs reporting healthy right now? */
  jobsHealthy: boolean;
};

/**
 * How many more registrations today's remaining allowance pays for.
 *
 * Floor division, and never below zero. It understates rather than flatters: a waitlisted
 * entrant costs more than a completed one (`notifications/volume.ts`), so the real number is
 * lower than this and a club that plans against it has margin rather than a surprise.
 */
export function registrationsLeftToday(input: {
  emailAllowance: number | null;
  emailSentToday: number;
  messagesPerRegistration: number;
}): number | null {
  if (input.messagesPerRegistration <= 0) return 0;
  // No ceiling, no count: null, and the page prints the word for it rather than a big number.
  if (input.emailAllowance === null) return null;
  const remaining = Math.max(0, input.emailAllowance - input.emailSentToday);
  return Math.floor(remaining / input.messagesPerRegistration);
}

/**
 * One row per service, carrying everything about that service.
 *
 * This replaced three overlapping sections — a limit list, a plan list and a bump list — which
 * between them mentioned Mailgun three times and connected none of the mentions, so "how much
 * email can we send, and what happens then" had to be assembled from three places.
 *
 * The order is the order the club will meet a bill: the domain first, because it is the only
 * line with no free plan under it, then email, because it is the ceiling a race day meets.
 */
export function platformServices(input: PlatformFacts): ServiceRow[] {
  const remaining = input.emailAllowance === null ? null : Math.max(0, input.emailAllowance - input.emailSentToday);
  const left = registrationsLeftToday(input);
  const emailUsd = input.emailPlanUsdPerMonth ?? 0;

  return [
    {
      id: "domain",
      planToday: ".com (ROMARG)",
      // Bought on 2026-09-16 (`DECISIONS.md` §55, §56), so it is paid whichever hostname this
      // deployment answers on: QA runs on a subdomain of the same purchase. The registry price,
      // for the reason the constant's comment gives; the registrar's lei invoice is the club's.
      costToday: { kind: "paid", amount: DOMAIN_PRICE_USD_PER_YEAR, currency: "USD", plusVat: true },
      checkedOn: DOMAIN_PRICE_CHECKED_ON,
      // The one fact about the domain the software can read: is *this* deployment on it.
      headroom: { kind: "derived", reached: input.clubDomainBound },
      severity: "ok",
      // The `.ro`, a year after the `.com`, both alive at once (§55). The bare amount and its
      // currency: "+ VAT", "per year" and the conversion to lei are words, so they live in the
      // catalogues and not in a string built here.
      nextPlan: ".ro (ROTLD)",
      nextCost: `${RO_DOMAIN_PRICE_EUR_PER_YEAR} EUR`,
      bump: null,
    },
    {
      id: "mailgun",
      // The plan the club says it is on (§100): the name, and a year of its monthly price when
      // it has one — a temporary month of Basic reads as a year's worth until it is switched back,
      // which is the honest figure for "what does today's setup cost".
      planToday: input.emailPlanName ?? "Free",
      costToday: emailUsd > 0 ? { kind: "paid", amount: emailUsd * 12, currency: "USD", plusVat: true } : { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // The one ceiling on this page read from the deployment's own data rather than quoted.
      headroom:
        input.emailAllowance === null || remaining === null || left === null
          ? { kind: "derived", reached: false }
          : {
              kind: "measured",
              used: input.emailSentToday,
              of: input.emailAllowance,
              state: remaining === 0 ? "reached" : left <= 5 ? "close" : "ok",
            },
      severity: remaining === 0 ? "act" : left !== null && left <= 5 ? "watch" : "ok",
      nextPlan: input.emailNextPlan === undefined ? "Basic" : (input.emailNextPlan?.name ?? null),
      nextCost: input.emailNextPlan === undefined ? "$15/mo" : input.emailNextPlan ? `$${input.emailNextPlan.usdPerMonth}/mo` : null,
      bump: "temporary",
    },
    {
      id: "vercel",
      planToday: "Hobby",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // The commercial clause, derived from `cost_type = 'PAID'` on anything published. Not
      // "does this site take money" — it takes none — but whether a page announces a priced
      // service (`DECISIONS.md` §50).
      headroom: { kind: "derived", reached: input.hasPaidEvent },
      // A caution and not a breach: §50 records the owner's answer that the club sells nothing.
      severity: input.hasPaidEvent ? "watch" : "ok",
      nextPlan: "Pro",
      nextCost: "$20/mo per seat",
      bump: "permanent",
    },
    neonRow(input),
    {
      id: "zitadel",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // Zero custom domains on Free, and that is decided rather than pending: sign-in stays on
      // the provider's hostname (`docs/RUNBOOKS.md` § Staff sign-in), so the club's domain
      // being bound changes nothing here. The row is not a ceiling this deployment approaches.
      headroom: { kind: "derived", reached: false },
      severity: "ok",
      nextPlan: null,
      nextCost: null,
      bump: null,
    },
    {
      id: "scheduler",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // The external pinger every five minutes, with GitHub Actions as the backstop (`SETUP.md`
      // §26). Neither costs money, so the ceiling here is cadence: a stale job is its visible
      // edge, and the task list above names which one.
      headroom: { kind: "derived", reached: !input.jobsHealthy },
      severity: input.jobsHealthy ? "ok" : "act",
      nextPlan: null,
      nextCost: null,
      bump: null,
    },
  ];
}

/**
 * The Neon row, which is the one row whose every column follows a setting (`neonPlan`).
 *
 * **Free:** the plan is free, storage is measured from Postgres itself since §88
 * (`pg_database_size` against the plan's half gigabyte) and turns red at eighty percent, the
 * CU-hours live on `/devs`, and the next step is Launch at its per-hour rate. Unmeasured stays
 * "not measured": a green row here would be a claim.
 *
 * **Launch:** nothing is a ceiling, so nothing is "close" — the row is a usage estimate, this
 * month's pace projected to a full month at the catalogue's rates, and it reads "ok" when the
 * pace is measured and "unknown" when no key measures it. No next plan: Scale is for an SLA
 * the club does not need (§280), and its price is not recorded here, so it is not quoted. The
 * bump is the way *down* — the December review may return the account to Free, one select on
 * `/admin/tasks` — which is why the row keeps "temporary" and its wording says so.
 */
function neonRow(input: PlatformFacts): ServiceRow {
  const plan = input.neonPlan ?? "FREE";
  const entry = NEON_PLANS[plan];

  if (plan === "LAUNCH") {
    const projected = projectedNeonLaunchUsdPerMonth(input);
    return {
      id: "neon",
      planToday: entry.name,
      costToday: { kind: "usage", currency: "USD", estimatedPerMonth: projected },
      checkedOn: NEON_PLANS_CHECKED_ON,
      headroom: { kind: "derived", reached: false },
      severity: projected === null ? "unknown" : "ok",
      nextPlan: null,
      nextCost: null,
      bump: "temporary",
      variant: "launch",
    };
  }

  const ceiling = entry.storageBytes;
  const bytes = typeof input.databaseBytes === "number" ? input.databaseBytes : null;
  const measured = bytes !== null && ceiling !== null;
  return {
    id: "neon",
    planToday: entry.name,
    costToday: { kind: "free" },
    checkedOn: NEON_PLANS_CHECKED_ON,
    headroom: measured
      ? {
          kind: "measured",
          used: Math.round(bytes / (1024 * 1024)),
          of: Math.round(ceiling / (1024 * 1024)),
          state: bytes >= ceiling ? "reached" : bytes >= ceiling * 0.8 ? "close" : "ok",
        }
      : { kind: "notMeasured" },
    severity: measured ? (bytes >= ceiling ? "act" : bytes >= ceiling * 0.8 ? "watch" : "ok") : "unknown",
    nextPlan: NEON_PLANS.LAUNCH.name,
    nextCost: `$${NEON_LAUNCH_USD_PER_CU_HOUR}/CU-hour`,
    bump: "temporary",
  };
}

/**
 * What the club pays per year today, per currency.
 *
 * An empty array is the honest answer while nothing has been bought, and the page then says
 * "nothing at all" rather than printing a zero that invites the reader to wonder which currency
 * it is in. Grouped by currency because no exchange rate is applied here; see the header.
 *
 * A usage row (Neon Launch) adds twelve of its monthly estimate and marks the total
 * `estimated`, because a projection is not a price and the sentence has to say so; a usage row
 * whose pace nothing measures adds nothing and still marks it — the total is then known to be
 * incomplete, which is more useful than a total that looks whole.
 */
export function annualCostToday(
  rows: readonly ServiceRow[],
): { currency: CurrencyCode; amount: number; plusVat: boolean; estimated: boolean }[] {
  const totals = new Map<CurrencyCode, { amount: number; plusVat: boolean; estimated: boolean }>();

  for (const row of rows) {
    const cost = row.costToday;
    if (cost.kind !== "paid" && cost.kind !== "usage") continue;
    const running = totals.get(cost.currency) ?? { amount: 0, plusVat: false, estimated: false };
    if (cost.kind === "paid") {
      totals.set(cost.currency, {
        amount: roundUsd(running.amount + cost.amount),
        // One VAT-exclusive component makes the whole total VAT-exclusive; saying so is cheaper
        // than a treasurer discovering it on the invoice.
        plusVat: running.plusVat || cost.plusVat,
        estimated: running.estimated,
      });
    } else {
      totals.set(cost.currency, {
        amount: roundUsd(running.amount + (cost.estimatedPerMonth ?? 0) * 12),
        plusVat: running.plusVat,
        estimated: true,
      });
    }
  }

  return [...totals.entries()].map(([currency, total]) => ({ currency, ...total }));
}

/**
 * The next thing to cost money.
 *
 * The order is `docs/PLATFORM.md`'s own — "the domain, then one month of Mailgun Basic around
 * the first real race, then a Vercel paid plan if and only if the repository moves to a club
 * organization or the club starts charging entry" — walked against what this deployment reports
 * rather than restated. Null only when everything on that list is already paid for.
 */
export function nextSpend(rows: readonly ServiceRow[]): ServiceRow | null {
  const order: ServiceId[] = ["domain", "mailgun", "vercel"];
  for (const id of order) {
    const row = rows.find((candidate) => candidate.id === id);
    if (row && row.costToday.kind !== "paid" && row.costToday.kind !== "usage" && row.nextCost) return row;
  }
  return null;
}

/**
 * How old a quoted price is, and whether it may still be acted on.
 *
 * The check date used to be printed and nothing else happened, so the page asserted a figure
 * with identical confidence on day one and on day four hundred. **The thresholds are a
 * decision:** a quarter (90 days) is inside the cycle vendors normally revise pricing on, so a
 * figure that young is worth acting on; past three quarters (270 days) a quotation is nearer a
 * year old than a quarter and has to be re-checked before anybody spends against it. They are
 * deliberately generous, because this page is read a few times a year, and deliberately not
 * configurable, because a threshold somebody can widen is a threshold that gets widened instead
 * of a price that gets re-checked.
 */
export const PRICE_AGEING_AFTER_DAYS = 90;
export const PRICE_STALE_AFTER_DAYS = 270;

export type PriceFreshness = { days: number; state: "fresh" | "ageing" | "stale" };

export function priceFreshness(checkedOn: string, now: Date): PriceFreshness {
  const checked = Date.parse(`${checkedOn}T00:00:00Z`);
  // An unparseable date is not "fresh". The safe direction for a price is always older.
  if (Number.isNaN(checked)) return { days: Number.POSITIVE_INFINITY, state: "stale" };

  const days = Math.max(0, Math.floor((now.getTime() - checked) / 86_400_000));
  if (days >= PRICE_STALE_AFTER_DAYS) return { days, state: "stale" };
  if (days >= PRICE_AGEING_AFTER_DAYS) return { days, state: "ageing" };
  return { days, state: "fresh" };
}

/** The oldest check date across the rows — the age the page as a whole may claim. */
export function oldestCheckDate(rows: readonly ServiceRow[]): string {
  return [...rows.map((row) => row.checkedOn)].sort()[0] ?? VENDOR_PLANS_CHECKED_ON;
}

/**
 * A question somebody still owes an answer to, as opposed to a fact somebody should read.
 *
 * The task list already separates blocking from open from done; the money needed the same
 * distinction. "The domain costs 10.97 USD + VAT at the registry" is a fact. "Do we buy a month
 * of Mailgun before the race?" is a question with a person attached to it, and rendering the
 * two identically is how a decision goes unmade for a year.
 *
 * Only what is **still undecided** is listed (`DECISIONS.md` §61). The registrar question
 * closed when the domain was bought and the currency question is answered in this file's
 * header; a settled question rendered as "answered" for ever was a line to scroll past. The
 * researched-and-not-taken alternatives and the Cloudflare answer left with them — they live in
 * `DECISIONS.md`, which is where a re-decision would start anyway.
 */
export type MoneyDecisionId = "entryContribution" | "mailgunBeforeRace";

export type MoneyDecision = {
  id: MoneyDecisionId;
  owner: "club" | "developer";
  state: "open" | "answered";
};

export function moneyDecisions(input: PlatformFacts): MoneyDecision[] {
  return [
    /**
     * Answered by the owner on 2026-09-07 (`DECISIONS.md` §50): the club sells nothing and takes
     * no money. A published event marked `PAID` contradicts that recorded answer, so it reopens
     * the question rather than quietly overriding it — and it is listed only while it is open.
     */
    { id: "entryContribution", owner: "club", state: input.hasPaidEvent ? "open" : "answered" },
    // Open for as long as the club is on the free daily cap, and it is a decision with a
    // deadline attached: before a registration window opens, never during one.
    { id: "mailgunBeforeRace", owner: "club", state: "open" },
  ];
}

/**
 * What each limit means operationally, for `/devs` — and deliberately no prices.
 *
 * The split is the point. This says what a limit *does* when it is met and who enforces it; the
 * money half stays on `/admin/tasks`. One number rendered in two places is one number that will
 * disagree with itself.
 */
export type OperationalLimit = {
  id:
    | "mailgunDaily"
    | "captureOnServerless"
    | "schedulerFloor"
    | "hobbyCapPause"
    | "identityDomain"
    | "statementTimeout";
  /** Who stops you: the provider's own API, or this application's code. */
  enforcedBy: "provider" | "application";
  /** The variable or monitor involved, or null where there is none to name. */
  variable: string | null;
};

export const OPERATIONAL_LIMITS: readonly OperationalLimit[] = [
  { id: "mailgunDaily", enforcedBy: "provider", variable: null },
  { id: "captureOnServerless", enforcedBy: "application", variable: "EMAIL_DELIVERY_MODE" },
  { id: "schedulerFloor", enforcedBy: "provider", variable: "JOB_SECRET" },
  { id: "hobbyCapPause", enforcedBy: "provider", variable: null },
  { id: "identityDomain", enforcedBy: "provider", variable: "STAFF_AUTH_MODE" },
  { id: "statementTimeout", enforcedBy: "application", variable: "DATABASE_URL" },
];

/**
 * Can the club run this for nothing?
 *
 * Four answers rather than two, because "yes" and "no" both mislead here. The domain is the
 * one line with no free plan under it, there are named events that end the arrangement — and
 * since 2026-09-22 the database is on a plan the club *chose* to pay for by the hour, which is
 * neither a limit reached nor a problem: `paysForUsage` says so, and the page reads it calmly.
 */
export type FreeTierVerdict = "freeExceptDomain" | "freeButAtALimit" | "notFree" | "paysForUsage";

export function freeTierVerdict(input: PlatformFacts): FreeTierVerdict {
  // Charging entry is the one that ends it outright rather than pressing on a ceiling: the
  // deployment is then outside Vercel's fair-use terms, not merely close to a cap.
  if (input.hasPaidEvent) return "notFree";
  if (registrationsLeftToday(input) === 0) return "freeButAtALimit";
  return (input.neonPlan ?? "FREE") === "FREE" ? "freeExceptDomain" : "paysForUsage";
}
