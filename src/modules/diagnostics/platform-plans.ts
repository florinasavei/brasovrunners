/**
 * What this platform costs the club, what its free plans refuse, and what the alternatives are.
 *
 * `/devs` answers "is this deployment configured correctly" and the task list above it answers
 * "what is waiting on me". This answers the third question, the one a volunteer treasurer asks
 * before a race: **what do we pay today, what is the next thing to cost money, and what are our
 * options?**
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
 */

export type CurrencyCode = "EUR" | "USD";

export type ServiceId = "domain" | "mailgun" | "vercel" | "neon" | "zitadel" | "githubActions";

/**
 * What this service costs the club per year, right now.
 *
 * `notTaken` is not `free`: nothing is bought yet, so nothing is being paid — but there is no
 * free plan to stay on either, which is the whole of the domain's story.
 */
export type AnnualCost =
  | { kind: "free" }
  | { kind: "notTaken" }
  | { kind: "paid"; amount: number; currency: CurrencyCode; plusVat: boolean };

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
};

/**
 * The `.ro` registry price, from ROTLD's own price page, checked 2026-09-07.
 *
 * "Costul serviciului de înregistrare pentru un domeniu .ro este de 12 EUR + TVA pe an", billed
 * to Romanian individuals and legal entities in lei at the National Bank's rate on the invoice
 * date. This is the **registry** price; an accredited registrar may charge more, which is why
 * the page still asks the club which registrar it used and what it actually paid.
 *
 * Romania's standard VAT has been 21% since 2025-08-01, so the gross figure is 14.52 EUR — but
 * the page prints "12 EUR + VAT" with the rate beside it rather than one blended number,
 * because those are two facts with two sources and two expiry dates.
 */
export const DOMAIN_PRICE_EUR_PER_YEAR = 12;
export const DOMAIN_PRICE_CHECKED_ON = "2026-09-07";
export const ROMANIAN_VAT_PERCENT = 21;

/** The date `docs/PLATFORM.md` verified the six vendor plan rows. */
export const VENDOR_PLANS_CHECKED_ON = "2026-09-05";

export type PlatformFacts = {
  /** Free-tier daily message allowance, and what today has already spent of it. */
  emailAllowance: number;
  emailSentToday: number;
  /** Messages this application sends for one registration that completes normally. */
  messagesPerRegistration: number;
  /** Is any published event charging an entry fee? `events.cost_type = 'PAID'`. */
  hasPaidEvent: boolean;
  /** Is the club's own domain bound and serving this deployment? False on localhost too. */
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
  emailAllowance: number;
  emailSentToday: number;
  messagesPerRegistration: number;
}): number {
  if (input.messagesPerRegistration <= 0) return 0;
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
  const remaining = Math.max(0, input.emailAllowance - input.emailSentToday);
  const left = registrationsLeftToday(input);

  return [
    {
      id: "domain",
      planToday: null,
      // Nothing is paid until it is registered, and the club is entitled to see that its
      // running cost today is genuinely zero rather than "zero except the thing we imply".
      costToday: input.clubDomainBound
        ? { kind: "paid", amount: DOMAIN_PRICE_EUR_PER_YEAR, currency: "EUR", plusVat: true }
        : { kind: "notTaken" },
      checkedOn: DOMAIN_PRICE_CHECKED_ON,
      headroom: { kind: "derived", reached: input.clubDomainBound },
      severity: input.clubDomainBound ? "ok" : "watch",
      nextPlan: input.clubDomainBound ? null : "ROTLD",
      // The bare amount and its currency. "+ VAT", "per year" and the conversion to lei are
      // words, so they live in the catalogues and not in a string built here.
      nextCost: input.clubDomainBound ? null : `${DOMAIN_PRICE_EUR_PER_YEAR} EUR`,
      bump: null,
    },
    {
      id: "mailgun",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // The one ceiling on this page read from the deployment's own data rather than quoted.
      headroom: {
        kind: "measured",
        used: input.emailSentToday,
        of: input.emailAllowance,
        state: remaining === 0 ? "reached" : left <= 5 ? "close" : "ok",
      },
      severity: remaining === 0 ? "act" : left <= 5 ? "watch" : "ok",
      nextPlan: "Basic",
      nextCost: "$15/mo",
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
    {
      id: "neon",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // Storage and CU-hours live in Neon's console and this application never reads them.
      // "Not measured" is the honest render; a green row here would be a claim.
      headroom: { kind: "notMeasured" },
      severity: "unknown",
      nextPlan: "Launch",
      nextCost: "$0.106/CU-hour",
      bump: "temporary",
    },
    {
      id: "zitadel",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // Zero custom domains on Free, so binding the club's domain is the moment it bites.
      headroom: { kind: "derived", reached: input.clubDomainBound },
      severity: input.clubDomainBound ? "watch" : "ok",
      nextPlan: null,
      nextCost: null,
      bump: null,
    },
    {
      id: "githubActions",
      planToday: "Free",
      costToday: { kind: "free" },
      checkedOn: VENDOR_PLANS_CHECKED_ON,
      // Unlimited on a public repository, so the ceiling here is cadence rather than money:
      // this is the only thing draining the outbox, and a stale job is its visible edge.
      headroom: { kind: "derived", reached: !input.jobsHealthy },
      severity: input.jobsHealthy ? "ok" : "act",
      nextPlan: null,
      nextCost: null,
      bump: null,
    },
  ];
}

/**
 * What the club pays per year today, per currency.
 *
 * An empty array is the honest answer while nothing has been bought, and the page then says
 * "nothing at all" rather than printing a zero that invites the reader to wonder which currency
 * it is in. Grouped by currency because no exchange rate is applied here; see the header.
 */
export function annualCostToday(
  rows: readonly ServiceRow[],
): { currency: CurrencyCode; amount: number; plusVat: boolean }[] {
  const totals = new Map<CurrencyCode, { amount: number; plusVat: boolean }>();

  for (const row of rows) {
    if (row.costToday.kind !== "paid") continue;
    const running = totals.get(row.costToday.currency) ?? { amount: 0, plusVat: false };
    totals.set(row.costToday.currency, {
      amount: running.amount + row.costToday.amount,
      // One VAT-exclusive component makes the whole total VAT-exclusive; saying so is cheaper
      // than a treasurer discovering it on the invoice.
      plusVat: running.plusVat || row.costToday.plusVat,
    });
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
    if (row && row.costToday.kind !== "paid" && row.nextCost) return row;
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
 * A question somebody owes an answer to, as opposed to a fact somebody should read.
 *
 * The task list already separates blocking from open from done; the money needed the same
 * distinction. "The domain costs 12 EUR + VAT" is a fact. "Which registrar, and did we actually
 * pay that?" is a question with a person attached to it, and rendering the two identically is
 * how a decision goes unmade for a year — every line looks equally like something to read.
 */
export type MoneyDecisionId =
  | "domainRegistrar"
  | "entryContribution"
  | "currency"
  | "mailgunBeforeRace";

export type MoneyDecision = {
  id: MoneyDecisionId;
  owner: "club" | "developer";
  state: "open" | "answered";
};

export function moneyDecisions(input: PlatformFacts): MoneyDecision[] {
  return [
    // Open until the domain exists: the registry price is known, what a registrar actually
    // charged is not, and only the person who paid it can close this.
    { id: "domainRegistrar", owner: "club", state: input.clubDomainBound ? "answered" : "open" },
    /**
     * Answered by the owner on 2026-09-07 (`DECISIONS.md` §50): the club sells nothing and takes
     * no money. A published event marked `PAID` contradicts that recorded answer, so it reopens
     * the question rather than quietly overriding it.
     */
    { id: "entryContribution", owner: "club", state: input.hasPaidEvent ? "open" : "answered" },
    // Answered in this file's header, and shown so the reader knows a decision was taken rather
    // than that the question was never noticed.
    { id: "currency", owner: "developer", state: "answered" },
    // Open for as long as the club is on the free daily cap, and it is a decision with a
    // deadline attached: before a registration window opens, never during one.
    { id: "mailgunBeforeRace", owner: "club", state: "open" },
  ];
}

/**
 * The alternative that was researched and not taken, per service.
 *
 * The second half of the complaint this page answers was "options": with only the chosen
 * providers on screen, every one of them looks equally load-bearing and equally permanent. Each
 * of these is already recorded somewhere — what this adds is that they are recorded *together*.
 * Nothing here re-decides anything, and `source` is where the decision actually lives.
 */
export type ProviderOption = {
  id: ServiceId | "storage";
  /** The alternative's own name, which is not translated. */
  alternative: string;
  source: string;
};

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  { id: "vercel", alternative: "Render Free (Frankfurt)", source: "DECISIONS.md" },
  { id: "mailgun", alternative: "Resend (Ireland)", source: "DECISIONS.md" },
  { id: "zitadel", alternative: "Auth.js", source: "DECISIONS.md" },
  { id: "storage", alternative: "public/", source: "AGENTS.md §17" },
];

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
 * Three answers rather than two, because "yes" and "no" both mislead here. Nothing is bought
 * yet, the domain is the one line with no free plan under it, and there are named events that
 * end the arrangement.
 */
export type FreeTierVerdict = "freeExceptDomain" | "freeButAtALimit" | "notFree";

export function freeTierVerdict(input: PlatformFacts): FreeTierVerdict {
  // Charging entry is the one that ends it outright rather than pressing on a ceiling: the
  // deployment is then outside Vercel's fair-use terms, not merely close to a cap.
  if (input.hasPaidEvent) return "notFree";
  return registrationsLeftToday(input) === 0 ? "freeButAtALimit" : "freeExceptDomain";
}
