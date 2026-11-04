import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";
import { ACTIVE_STATUSES } from "./state-machine";

/**
 * «Planul locurilor» (§NNN; the owner, 2026-11-03, choosing «one plan page per race» among four place controls for
 * the 21 November race): one event's places on one read-only page — who holds them, who sits outside them, both lists,
 * and what to order if every place fills.
 *
 * Pure: the counts in, the rows and the totals out (`race-plan.ts#readRacePlan` reads them).
 *
 * - **Inside the places** the rows are the outlook's own numbers (`place-outlook.ts`, `readPlaceOutlook`: the
 *   allocator's `countOccupied`, test rows counted as the allocator counts them, §30), so «Pe categorii» cannot
 *   disagree with «Locuri» above it, and the five kinds always add up to `occupied`. «din care cu termenul trecut» is
 *   the allocator's own lapsed count (`countOccupied().lapsedDeclarationHolds`: not a hold whose first email is still
 *   queued, §513), never a second definition of "lapsed"; «din care elită» reads the elite mark (§897), which changes
 *   nothing the allocator does.
 * - **Outside the places** — the special guests (§643) by state, as `countOutsideCapacity` counts them (real rows,
 *   confirmed, to sign or offered), their invitations not yet answered, the lines of the elite list (§895: a name on a
 *   bib, no place), the volunteers with a kit (§904) — never enter `occupied`.
 * - **The lists**: the official waiting list and «Lista internă (doar notițe)», which hold no place either.
 */

/** One group of the event's registrations, as the plan's one grouped read returns it. */
export type RegistrationGroup = {
  status: RegistrationStatus;
  outside: boolean;
  elite: boolean;
  kind: RegistrationKind;
  total: number;
};

/** What the grouped read adds to the outlook: the elite inside the places, the special guests by state, the test rows. */
export type RacePlanBreakdown = {
  /** Confirmed inside the places and marked «Elită» (§897), any kind — the set the outlook's `confirmed` counts. */
  eliteConfirmed: number;
  /** Holding a place to sign inside the places and marked «Elită», any kind. */
  eliteDeclaration: number;
  /** The special guests by state (§643): real rows, as `countOutsideCapacity` counts them, so the three add up to `outside`. */
  outsideConfirmed: number;
  outsideDeclaration: number;
  outsideOffered: number;
  /** The official waiting list, as `countEligibleWaitlisted` counts it: `WAITLISTED`, never a row outside the places. */
  waiting: number;
  /** Test registrations in an active state inside the places (§30): counted like any other, said apart. */
  test: number;
};

/** The states a special guest is counted in, as `repository.ts#countOutsideCapacity` reads them. */
const OUTSIDE_STATES = ["CONFIRMED", "PENDING_DECLARATION", "WAITLIST_OFFERED"] as const satisfies readonly RegistrationStatus[];

export function breakdownOf(groups: readonly RegistrationGroup[]): RacePlanBreakdown {
  const sum = (match: (group: RegistrationGroup) => boolean) => groups.filter(match).reduce((total, group) => total + group.total, 0);
  const outsideIn = (status: (typeof OUTSIDE_STATES)[number]) => sum((g) => g.outside && g.kind === "REAL" && g.status === status);
  return {
    eliteConfirmed: sum((g) => !g.outside && g.elite && g.status === "CONFIRMED"),
    eliteDeclaration: sum((g) => !g.outside && g.elite && g.status === "PENDING_DECLARATION"),
    outsideConfirmed: outsideIn("CONFIRMED"),
    outsideDeclaration: outsideIn("PENDING_DECLARATION"),
    outsideOffered: outsideIn("WAITLIST_OFFERED"),
    waiting: sum((g) => !g.outside && g.status === "WAITLISTED"),
    test: sum((g) => !g.outside && g.kind === "TEST" && ACTIVE_STATUSES.includes(g.status)),
  };
}

/** The special guests holding a place outside the capacity, from the breakdown: what `countOutsideCapacity` counts. */
export function outsideOf(breakdown: RacePlanBreakdown): number {
  return breakdown.outsideConfirmed + breakdown.outsideDeclaration + breakdown.outsideOffered;
}

/** The places taken, by what holds each — the outlook's numbers (`capacity.ts#placesTaken`), and their sum. */
export type PlacesTakenNow = {
  confirmed: number;
  declaration: number;
  offered: number;
  invited: number;
  family: number;
  /** The allocator's `computeOccupied`: the five above, together. */
  occupied: number;
};

export type RacePlanInput = {
  /** null: no limit of places. */
  capacity: number | null;
  taken: PlacesTakenNow;
  /** The places nobody holds (the outlook's `free`); null for an event with no limit. */
  free: number | null;
  /** The official waiting list and the internal list's lines. */
  waiting: number;
  internal: number;
  /** Special guests holding a place outside the capacity (the outlook's `outside`). */
  outside: number;
  /** Of the declarations to sign, those past their deadline, as the allocator reads them (`lapsedDeclarationHolds`). */
  lapsed: number;
  breakdown: RacePlanBreakdown;
  /** Invitations sent «Pe lista de invitați speciali», open and before their deadline. */
  outsideInvitations: number;
  /** The lines of the race's elite list (§895). */
  eliteEntries: number;
  /** The volunteers ticked «Are kit», the cancelled left out (§904). */
  volunteersWithKit: number;
};

export const PLAN_ROW_KEYS = [
  "confirmed",
  "eliteConfirmed",
  "declaration",
  "lapsed",
  "eliteDeclaration",
  "offered",
  "invited",
  "family",
  "occupied",
  "free",
  "capacity",
  "outside",
  "outsideConfirmed",
  "outsideDeclaration",
  "outsideOffered",
  "outsideInvitations",
  "eliteEntries",
  "volunteersWithKit",
  "waiting",
  "internal",
] as const;

export type PlanRowKey = (typeof PLAN_ROW_KEYS)[number];

/** One line of «Pe categorii»: its words are `Admin.racePlan.rows.<key>`; `count` null is «fără limită». */
export type PlanRow = {
  key: PlanRowKey;
  count: number | null;
  /** A part of the line above it («din care …»), drawn indented. */
  part?: true;
  /** A sum (the places taken, the capacity), drawn bold. */
  total?: true;
};

export type RacePlanRows = {
  /** Inside the capacity: the five kinds, then the places taken, the free ones and the capacity. */
  inside: PlanRow[];
  /** Outside the capacity: nobody here takes a place. */
  outside: PlanRow[];
  /** The two lists: nobody here holds a place either. */
  lists: PlanRow[];
  /** Test registrations counted above (§30); said only when there are any, which is never in production. */
  test: number;
};

/** «din care …» only when it has something to say. */
function partOf(key: PlanRowKey, count: number): PlanRow[] {
  return count > 0 ? [{ key, count, part: true }] : [];
}

export function racePlanRows(input: RacePlanInput): RacePlanRows {
  const { taken, breakdown } = input;
  const inside: PlanRow[] = [
    { key: "confirmed", count: taken.confirmed },
    ...partOf("eliteConfirmed", Math.min(breakdown.eliteConfirmed, taken.confirmed)),
    { key: "declaration", count: taken.declaration },
    // A read between the two queries can only leave the allocator's lapsed count above the holds counted: never say more.
    ...partOf("lapsed", Math.min(input.lapsed, taken.declaration)),
    ...partOf("eliteDeclaration", Math.min(breakdown.eliteDeclaration, taken.declaration)),
    { key: "offered", count: taken.offered },
    { key: "invited", count: taken.invited },
    { key: "family", count: taken.family },
    { key: "occupied", count: taken.occupied, total: true },
    ...(input.capacity === null
      ? [{ key: "capacity", count: null, total: true } satisfies PlanRow]
      : [{ key: "free", count: input.free ?? Math.max(input.capacity - taken.occupied, 0) } satisfies PlanRow, { key: "capacity", count: input.capacity, total: true } satisfies PlanRow]),
  ];
  const outside: PlanRow[] = [
    { key: "outside", count: input.outside },
    ...partOf("outsideConfirmed", breakdown.outsideConfirmed),
    ...partOf("outsideDeclaration", breakdown.outsideDeclaration),
    ...partOf("outsideOffered", breakdown.outsideOffered),
    { key: "outsideInvitations", count: input.outsideInvitations },
    { key: "eliteEntries", count: input.eliteEntries },
    { key: "volunteersWithKit", count: input.volunteersWithKit },
  ];
  const lists: PlanRow[] = [
    { key: "waiting", count: input.waiting },
    { key: "internal", count: input.internal },
  ];
  return { inside, outside, lists, test: breakdown.test };
}

export const ORDER_PART_KEYS = ["places", "outside", "outsideInvitations", "volunteersWithKit", "eliteEntries", "spares"] as const;

export type OrderPartKey = (typeof ORDER_PART_KEYS)[number];

/** One total of «De comandat», with the parts it is the sum of; each part's words are `Admin.racePlan.order.parts.<key>`. */
export type OrderTotal = { total: number; parts: { key: OrderPartKey; count: number }[] };

export type OrderTotals = { kits: OrderTotal; bibs: OrderTotal };

/**
 * What to order if every place fills (§NNN), the parts written out so the club sees what each total is made of:
 *
 * - **kits** = the places + the special guests holding a place + the special guests' invitations not yet answered + the
 *   volunteers with a kit (§904);
 * - **bibs** = the places + the special guests + their invitations not yet answered + the elite list's lines (§895: a
 *   bib with a name, no place) + the desk's spare numbers still free (§444: printed ahead, with no name).
 *
 * The places are the capacity — or the places taken, when the capacity was lowered under them: every one of those still
 * gets a kit and a bib. Null for an event with no limit of places: «if every place fills» means nothing there, and the
 * page says only what is needed now (`KitCount`, the bibs given).
 */
export function orderTotals(input: {
  capacity: number | null;
  occupied: number;
  outside: number;
  outsideInvitations: number;
  volunteersWithKit: number;
  eliteEntries: number;
  /** The desk's reserved spare numbers nobody wears yet (`spareCardState().free`). */
  spares: number;
}): OrderTotals | null {
  if (input.capacity === null) return null;
  const places = Math.max(input.capacity, input.occupied);
  const sumOf = (parts: OrderTotal["parts"]): OrderTotal => ({ total: parts.reduce((sum, part) => sum + part.count, 0), parts });
  return {
    kits: sumOf([
      { key: "places", count: places },
      { key: "outside", count: input.outside },
      { key: "outsideInvitations", count: input.outsideInvitations },
      { key: "volunteersWithKit", count: input.volunteersWithKit },
    ]),
    bibs: sumOf([
      { key: "places", count: places },
      { key: "outside", count: input.outside },
      { key: "outsideInvitations", count: input.outsideInvitations },
      { key: "eliteEntries", count: input.eliteEntries },
      { key: "spares", count: input.spares },
    ]),
  };
}
