/**
 * What this platform costs, what its free plans refuse, and what to buy when they do.
 *
 * `/devs` answers "is this deployment configured correctly" and `/admin/tasks` answers "what is
 * waiting on me". This answers the third question the club actually asks: **can we keep running
 * this for nothing, and what happens on the day we cannot?**
 *
 * ## Every figure here is quoted, never computed and never remembered
 *
 * `AGENTS.md` §1.2 forbids inventing a vendor's plan or price, and a page a volunteer reads
 * before spending the club's money is the worst possible place to guess. Each number below is
 * one already researched and recorded in `docs/PLATFORM.md` § "Subscriptions, limits and cost",
 * which was checked on the date in `PLANS_CHECKED_ON` and re-checked by a second pass that
 * existed only to refute the first. The day a price changes it changes *there* first and this
 * file follows — and `tests/unit/diagnostics/platform-plans.test.ts` asserts the date is
 * carried onto the page, so a stale quote is visible rather than silent.
 *
 * Prices are strings on purpose. They are quotations in the vendor's own currency and units,
 * not quantities to do arithmetic with; the moment one becomes a number somebody will total
 * them and publish a figure no vendor ever gave.
 */

/**
 * The date `docs/PLATFORM.md` last verified every figure below against the vendors' own pages.
 *
 * Rendered next to the table rather than hidden in a comment: a price with no date is a claim,
 * and the club is entitled to know how old the claim is before acting on it.
 */
export const PLANS_CHECKED_ON = "2026-09-05";

export type PlanLine = {
  id: string;
  /** The plan this deployment is on today. */
  currentPlan: string;
  currentCost: string;
  /** The next step up, or null where the free plan has no ceiling worth naming. */
  firstPaidPlan: string | null;
  firstPaidCost: string | null;
};

/**
 * One row per service, in the order the club will meet a bill for it.
 *
 * The domain is first because it is the only line that is not free today, and last in
 * `PLATFORM.md`'s own table for the same reason — there it is a footnote to a cost table, here
 * it is the answer to "what do we pay".
 */
export const PLAN_LINES: readonly PlanLine[] = [
  { id: "domain", currentPlan: "—", currentCost: "?", firstPaidPlan: null, firstPaidCost: null },
  {
    id: "mailgun",
    currentPlan: "Free",
    currentCost: "$0",
    firstPaidPlan: "Basic",
    firstPaidCost: "$15/mo",
  },
  {
    id: "vercel",
    currentPlan: "Hobby",
    currentCost: "$0",
    firstPaidPlan: "Pro",
    firstPaidCost: "$20/mo per seat",
  },
  {
    id: "neon",
    currentPlan: "Free",
    currentCost: "$0",
    firstPaidPlan: "Launch",
    firstPaidCost: "$0.106/CU-hour",
  },
  {
    id: "zitadel",
    currentPlan: "Free",
    currentCost: "$0",
    firstPaidPlan: null,
    firstPaidCost: null,
  },
  {
    id: "githubActions",
    currentPlan: "Free",
    currentCost: "$0",
    firstPaidPlan: null,
    firstPaidCost: null,
  },
];

/**
 * A ceiling the club will actually meet, and what it does when it is met.
 *
 * Only the four `PLATFORM.md` calls "the ones that will actually bite" plus the commercial
 * clause, because a page listing every documented limit is a page nobody finishes. `applies`
 * says whether this deployment is subject to it *today*, so a club on a paid tier stops being
 * warned about a ceiling it has already bought its way past.
 */
export type PlatformLimit = {
  id: string;
  /** true when this deployment is under the limit today. */
  applies: boolean;
  /** true when the club is at or past it now, rather than merely subject to it. */
  reached: boolean;
};

export type PlatformLimitInputs = {
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

export function platformLimits(input: PlatformLimitInputs): PlatformLimit[] {
  const left = registrationsLeftToday(input);

  return [
    /**
     * The one that decides a registration day. Three messages per completed registration
     * against a hundred a day is about thirty-three entries, and a race opening to a hundred
     * people crosses it before lunch.
     */
    {
      id: "mailgunDaily",
      applies: true,
      reached: left === 0,
    },
    /**
     * Vercel Hobby's cron fires at most once a day and refuses a finer expression at deploy
     * time, which is why the scheduler is a GitHub Actions workflow plus an external pinger.
     * Measured on this repository, Actions alone fires roughly every two hours.
     */
    { id: "schedulerFloor", applies: true, reached: !input.jobsHealthy },
    /**
     * The commercial clause. A donate button sits inside a donations carve-out; an entry fee
     * does not, and the day the club charges, Hobby stops being defensible.
     */
    { id: "commercialUse", applies: true, reached: input.hasPaidEvent },
    /**
     * Zitadel Free includes zero custom domains and one administrator. Neither matters while
     * staff sign in on the provider's hostname; both do the day the club's domain is bound.
     */
    { id: "identityDomain", applies: true, reached: input.clubDomainBound },
    /**
     * Hobby cannot connect to a Git *organization's* repository. `BUSINESS.md` BR-BUS-101 wants
     * the repository club-owned, and doing that forces a paid Vercel plan — a dependency
     * between two things the club wants that nobody noticed until it was written down.
     */
    { id: "orgRepository", applies: true, reached: false },
  ];
}

/**
 * What to buy, when, and when to stop buying it.
 *
 * Quoted from `docs/PLATFORM.md` § "What to bump, and in what order". The `temporary` flag is
 * the point of the whole table: a bump nobody reverses is the expensive failure here, and
 * nothing in any dashboard will remind the club to come back down.
 */
export type BumpLine = {
  id: string;
  /** Is this normally bought for one window and dropped again? */
  temporary: boolean;
};

export const BUMP_LINES: readonly BumpLine[] = [
  { id: "mailgun", temporary: true },
  { id: "neon", temporary: true },
  { id: "vercelLoad", temporary: true },
  { id: "vercelCommercial", temporary: false },
];

/**
 * Can the club run this for nothing?
 *
 * Three answers rather than two, because "yes" and "no" both mislead here. The honest shape is:
 * every service is free today, the domain never is, and there are named events that end it.
 */
export type FreeTierVerdict = "freeExceptDomain" | "freeButAtALimit" | "notFree";

export function freeTierVerdict(input: PlatformLimitInputs): FreeTierVerdict {
  // Charging entry is the one that ends it outright rather than pressing on a ceiling: the
  // deployment is then outside Vercel's fair-use terms, not merely close to a cap.
  if (input.hasPaidEvent) return "notFree";
  return registrationsLeftToday(input) === 0 ? "freeButAtALimit" : "freeExceptDomain";
}
