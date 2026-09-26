/**
 * The spare bibs for on-the-spot entries (`DECISIONS.md` §NNN): numbers the club prints ahead
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
 * anybody has (settled, provisional or erased), a second print extends the reservation by the
 * next free numbers after it. So a reservation never lands on a number somebody holds, and no
 * online runner's number moves — nobody types a range that could overlap one. The event keeps the
 * reservation as a start and a count (`walk_in_bib_start`, `walk_in_bib_count`); a number inside it
 * that an online runner already held when an extension reached past it stays that runner's.
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
 * the desk suggests from. `taken` is every settled and provisional number at the event and every
 * erased one (`bibs.ts#erasedBibNumbers`): a spare already given is on somebody's chest.
 */
export function freeSpareNumbers(band: SpareBand | null, taken: ReadonlySet<number>): number[] {
  return spareNumbersOf(band).filter((number) => !taken.has(number));
}

/**
 * Where the spares stand, for the desk (§NNN): `none` — the club reserved none, and the desk
 * behaves as it always did; `free` — the next spare to hand; `out` — reserved, and every one
 * given, which the desk says in words rather than falling silent (a volunteer would otherwise be
 * handed a number nobody printed without being told why).
 */
export type SpareState = { kind: "none" } | { kind: "free"; next: number } | { kind: "out" };

export function spareStateOf(band: SpareBand | null, free: readonly number[]): SpareState {
  if (!band) return { kind: "none" };
  const next = free[0];
  return next === undefined ? { kind: "out" } : { kind: "free", next };
}

/**
 * The numbers the next print would reserve, lowest first, at most `limit` of them: after the
 * highest number anybody has — or the band's own start less one, before anybody has one — on a
 * first print; the next free numbers after the band's end on a second. Every one of them free by
 * construction: the first print starts above everything taken, and the extension skips what is.
 * `limit` is how many the caller may ask for, so the card can say the exact range of every count
 * from the same function the write uses.
 */
export function nextSpareCandidates(input: {
  band: SpareBand | null;
  taken: ReadonlySet<number>;
  bibStartNumber: number;
  limit: number;
}): number[] {
  let candidate: number;
  if (input.band) {
    candidate = input.band.to + 1;
  } else {
    let highest = Math.max(0, input.bibStartNumber - 1);
    for (const number of input.taken) if (number > highest) highest = number;
    candidate = highest + 1;
  }
  const out: number[] = [];
  for (; out.length < input.limit && candidate <= BIB_NUMBER_MAX; candidate += 1) {
    if (!input.taken.has(candidate)) out.push(candidate);
  }
  return out;
}

/** Why a print could not reserve what it was asked for, in words the card turns into a sentence. */
export type SpareRefusal = "count" | "ceiling" | "size";

/**
 * What a print of `count` spares reserves (§NNN), or why it cannot: the numbers to print (all of
 * them free), and the event's reservation after it — the same start on an extension, the count
 * grown to reach the last new number. Refused for a count outside 1–`SPARE_BIBS_PER_PRINT`
 * (`count`), for too few numbers left under 99 999 (`ceiling`), and for a reservation that would
 * pass `SPARE_BIBS_MAX` (`size`).
 */
export function planSpareReservation(input: {
  band: SpareBand | null;
  taken: ReadonlySet<number>;
  bibStartNumber: number;
  count: number;
}):
  | { ok: true; printed: number[]; walkInBibStart: number; walkInBibCount: number }
  | { ok: false; reason: SpareRefusal } {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > SPARE_BIBS_PER_PRINT) return { ok: false, reason: "count" };
  const printed = nextSpareCandidates({ ...input, limit: input.count });
  if (printed.length < input.count) return { ok: false, reason: "ceiling" };
  const start = input.band?.from ?? printed[0];
  const last = printed[printed.length - 1];
  const total = last - start + 1;
  if (total > SPARE_BIBS_MAX) return { ok: false, reason: "size" };
  return { ok: true, printed, walkInBibStart: start, walkInBibCount: total };
}
