/**
 * The spare bibs for on-the-spot entries (`DECISIONS.md` §444): numbers the club prints ahead
 * with an empty name line, for the desk to hand to a walk-in with the name written on in marker.
 *
 * Why numbers of their own. On race morning a number the allocator draws for a walk-in is a number
 * nobody printed — the sheet went to the printer when registration closed — so the desk had a
 * runner at the table and no bib to give them. Pre-printed spares fix that only if the allocator
 * can never hand one of those numbers to somebody who registered online: the two people would
 * wear the same number. So the spares are reserved: every automatic draw in `bibs.ts` treats them
 * as taken, and a spare reaches a runner only when somebody at the desk chooses it.
 *
 * **The print reserves them.** The club types how many (one to `SPARE_BIBS_PER_PRINT`) and
 * presses «Tipărește»: the first print reserves that many numbers after the highest number
 * anybody has or had (worn, erased or replaced), a second print extends the reservation by the
 * next free numbers after it. So a reservation never lands on a number somebody holds, and no
 * online runner's number moves — nobody types a range that could overlap one. The event keeps the
 * reservation as a start and a count (`walk_in_bib_start`, `walk_in_bib_count`); a number inside it
 * that a runner already held when an extension reached past it stays that runner's for good, and
 * is never a spare, not even after it is released: the print records it as skipped.
 *
 * Pure and importing nothing, so the card, the desk, the sheet and the allocator read one rule.
 */

/** At most this many spares in one print: a sheet somebody carries to the desk, not a second race. */
export const SPARE_BIBS_PER_PRINT = 50;

/** At most this many numbers in an event's whole reservation, across every print. The table's CHECK says it too. */
export const SPARE_BIBS_MAX = 500;

/** The highest number a bib may carry (five digits), as `setBibNumberByStaff` refuses anything above. */
export const BIB_NUMBER_MAX = 99_999;

/** The reserved numbers, both ends included. */
export type SpareBand = { from: number; to: number };

/** The event's two columns as a band, or null when nothing was reserved (or the pair is broken). */
export function spareBandOf(event: { walkInBibStart: number | null; walkInBibCount: number | null }): SpareBand | null {
  if (event.walkInBibStart === null || event.walkInBibCount === null || event.walkInBibCount < 1) return null;
  return { from: event.walkInBibStart, to: event.walkInBibStart + event.walkInBibCount - 1 };
}

/** Whether this number is one of the event's reserved spares. */
export function isSpareNumber(band: SpareBand | null, number: number): boolean {
  return band !== null && number >= band.from && number <= band.to;
}

/** Every number of the band, lowest first. */
export function spareNumbersOf(band: SpareBand | null): number[] {
  if (!band) return [];
  return Array.from({ length: band.to - band.from + 1 }, (_, index) => band.from + index);
}

/**
 * The band's numbers nobody is wearing or holding, lowest first — what the reprint prints and what
 * the desk suggests from. `taken` is every number worn at the event and every
 * retired one (`bibs.ts#retiredBibNumbers`): a spare already given is on somebody's chest.
 */
export function freeSpareNumbers(band: SpareBand | null, taken: ReadonlySet<number>): number[] {
  return spareNumbersOf(band).filter((number) => !taken.has(number));
}

/**
 * Where the spares stand, for the desk (§444): `none` — the club reserved none, and the desk
 * behaves as it always did; `free` — the next spare to hand; `out` — reserved, and every one
 * given, which the desk says in words rather than falling silent (a volunteer would otherwise be
 * handed a number nobody printed without being told why).
 */
export type SpareState = { kind: "none" } | { kind: "free"; next: number } | { kind: "out" };

/**
 * Whether the desk's «Confirmă aici» carries a spare for this row (§444, §548): a real registration
 * that wears no number yet and has no printed bib. Since §548 nobody has a number before the
 * confirmation — an online runner included — so the spare in the volunteer's hand is the number the
 * confirmation gives, whoever typed the registration in. A row that already wears one (a cancelled
 * confirmed registration that restarted keeps its retired number, §173) keeps it, and a printed bib
 * is never swapped: it is in the pile with the runner's name on it. `confirmRegistrationByStaff`
 * refuses a handed number under the same rule, so the box and the server say one thing.
 */
export function handsSpareAtConfirm(row: { kind: string; bibNumber: number | null; bibPrintedAt: Date | null }): boolean {
  return row.kind === "REAL" && row.bibNumber === null && row.bibPrintedAt === null;
}

export function spareStateOf(band: SpareBand | null, free: readonly number[]): SpareState {
  if (!band) return { kind: "none" };
  const next = free[0];
  return next === undefined ? { kind: "out" } : { kind: "free", next };
}

/**
 * The first number a spare may not reach (§647, amending §444), or null: the hidden list's own series
 * when it sits above the race's (`hidden-list.ts#hiddenListBibStartOf`). The spares then stay between
 * the race's numbers and the hidden list's, so an invitation's number is never pushed up by a print and
 * a walk-in never wears a number inside the hidden list's series. A hidden series below the race's is
 * no bound: the spares come after the race's numbers, far from it.
 */
export function spareStopOf(bibStartNumber: number, hiddenStart: number | null): number | null {
  return hiddenStart !== null && hiddenStart > bibStartNumber ? hiddenStart : null;
}

/**
 * The numbers the next print would reserve, lowest first, at most `limit` of them: after the
 * highest number anybody has — or the band's own start less one, before anybody has one — on a
 * first print; the next free numbers after the band's end on a second. Every one of them free by
 * construction: the first print starts above everything taken, and the extension skips what is.
 * `limit` is how many the caller may ask for, so the card can say the exact range of every count
 * from the same function the write uses.
 *
 * `stop` (§647, `spareStopOf`): the hidden list's first number when its series sits above the race's.
 * The first print's «highest» is then taken over the numbers below it only, and no candidate reaches
 * it, so fewer than asked — or none — come back when the room between the two series is short.
 */
export function nextSpareCandidates(input: {
  band: SpareBand | null;
  taken: ReadonlySet<number>;
  bibStartNumber: number;
  limit: number;
  stop?: number | null;
}): number[] {
  const end = input.stop != null ? Math.min(BIB_NUMBER_MAX, input.stop - 1) : BIB_NUMBER_MAX;
  let candidate: number;
  if (input.band) {
    candidate = input.band.to + 1;
  } else {
    let highest = Math.max(0, input.bibStartNumber - 1);
    for (const number of input.taken) if (number > highest && number <= end) highest = number;
    candidate = highest + 1;
  }
  const out: number[] = [];
  for (; out.length < input.limit && candidate <= end; candidate += 1) {
    if (!input.taken.has(candidate)) out.push(candidate);
  }
  return out;
}

/** Why a print could not reserve what it was asked for, in words the card turns into a sentence. */
export type SpareRefusal = "count" | "ceiling" | "size" | "hiddenList";

/**
 * What a print of `count` spares reserves (§444), or why it cannot: the numbers to print (all of
 * them free), and the event's reservation after it — the same start on an extension, the count
 * grown to reach the last new number. Refused for a count outside 1–`SPARE_BIBS_PER_PRINT`
 * (`count`), for too few numbers left under 99 999 (`ceiling`), for too few left before the hidden
 * list's own series (`hiddenList`, `stop`, §647), and for a reservation that would pass
 * `SPARE_BIBS_MAX` (`size`).
 */
export function planSpareReservation(input: {
  band: SpareBand | null;
  taken: ReadonlySet<number>;
  bibStartNumber: number;
  count: number;
  stop?: number | null;
}):
  | { ok: true; printed: number[]; skipped: number[]; walkInBibStart: number; walkInBibCount: number }
  | { ok: false; reason: SpareRefusal } {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > SPARE_BIBS_PER_PRINT) return { ok: false, reason: "count" };
  const printed = nextSpareCandidates({ ...input, limit: input.count });
  if (printed.length < input.count) return { ok: false, reason: input.stop != null && input.stop <= BIB_NUMBER_MAX ? "hiddenList" : "ceiling" };
  const start = input.band?.from ?? printed[0];
  const last = printed[printed.length - 1];
  const total = last - start + 1;
  if (total > SPARE_BIBS_MAX) return { ok: false, reason: "size" };
  /*
    The numbers the extension stepped over (§444): inside the reservation from now on, and never a
    spare. Somebody held each when the print reached past it, so none is on the blank sheet; the
    print's audit row keeps them, and `bibs.ts#skippedSpareNumbers` reads them back as taken for
    good — released later (an expired hold), such a number is nobody's rather than a "free spare"
    the desk would suggest with no bib printed for it. A first print skips nothing: it starts
    above every number taken.
  */
  const printedSet = new Set(printed);
  const skipped: number[] = [];
  if (input.band) {
    for (let number = input.band.to + 1; number < last; number += 1) if (!printedSet.has(number)) skipped.push(number);
  }
  return { ok: true, printed, skipped, walkInBibStart: start, walkInBibCount: total };
}

/**
 * The range the print's banner names (§444), from the address it redirected to: two whole numbers
 * of one to five digits, the first not above the second — or null, and no banner. The query
 * string is typed by anybody, and the banner's link and sentence carry these numbers.
 */
export function spareRangeOfQuery(from: string | undefined, to: string | undefined): SpareBand | null {
  if (from === undefined || to === undefined || !/^\d{1,5}$/.test(from) || !/^\d{1,5}$/.test(to)) return null;
  const range = { from: Number(from), to: Number(to) };
  return range.from >= 1 && range.from <= range.to ? range : null;
}
