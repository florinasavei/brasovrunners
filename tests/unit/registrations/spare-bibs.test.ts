import { describe, expect, it } from "vitest";
import {
  BIB_NUMBER_MAX,
  freeSpareNumbers,
  isSpareNumber,
  nextSpareCandidates,
  planSpareReservation,
  SPARE_BIBS_MAX,
  SPARE_BIBS_PER_PRINT,
  spareBandOf,
  spareNumbersOf,
  spareStateOf,
} from "@/modules/registrations/domain/spare-bibs";

/**
 * §NNN — the desk's spare bibs: the numbers a print reserves, what the allocator steps over, what
 * the reprint prints blank and what the desk suggests.
 */
describe("§NNN the reservation on the event", () => {
  it("reads the start and the count as the reserved numbers, or none", () => {
    expect(spareBandOf({ walkInBibStart: 900, walkInBibCount: 50 })).toEqual({ from: 900, to: 949 });
    expect(spareBandOf({ walkInBibStart: null, walkInBibCount: null })).toBeNull();
    // Half a pair, or an empty count, reserves nothing.
    expect(spareBandOf({ walkInBibStart: 900, walkInBibCount: null })).toBeNull();
    expect(spareBandOf({ walkInBibStart: 900, walkInBibCount: 0 })).toBeNull();
  });

  it("knows its numbers, both ends included, and which of them are free", () => {
    const band = { from: 900, to: 903 };
    expect(spareNumbersOf(band)).toEqual([900, 901, 902, 903]);
    expect([899, 900, 903, 904].map((n) => isSpareNumber(band, n))).toEqual([false, true, true, false]);
    expect(isSpareNumber(null, 900)).toBe(false);
    expect(freeSpareNumbers(band, new Set([901, 5]))).toEqual([900, 902, 903]);
    expect(freeSpareNumbers(null, new Set())).toEqual([]);
  });

  it("tells the desk: none reserved, the next free one, or every one given", () => {
    expect(spareStateOf(null, [])).toEqual({ kind: "none" });
    expect(spareStateOf({ from: 900, to: 903 }, [902, 903])).toEqual({ kind: "free", next: 902 });
    expect(spareStateOf({ from: 900, to: 903 }, [])).toEqual({ kind: "out" });
  });
});

describe("§NNN what a print reserves", () => {
  it("starts after the highest number anybody has on the first print, or at the band's start before anybody", () => {
    // Taken 1–3 and a hand-typed 57: the spares start at 58, never inside the sequence.
    expect(nextSpareCandidates({ band: null, taken: new Set([1, 2, 3, 57]), bibStartNumber: 1, limit: 3 })).toEqual([58, 59, 60]);
    // Nobody yet at a race counting from 500: the spares are 500 onwards.
    expect(nextSpareCandidates({ band: null, taken: new Set(), bibStartNumber: 500, limit: 2 })).toEqual([500, 501]);
  });

  it("extends after the reservation on a second print, stepping over any number somebody holds", () => {
    // Reserved 58–60; an online runner holds 61 (drawn after the reservation, past its end).
    expect(nextSpareCandidates({ band: { from: 58, to: 60 }, taken: new Set([1, 2, 61]), bibStartNumber: 1, limit: 3 })).toEqual([62, 63, 64]);
  });

  it("plans the reservation: the same start on an extension, the count grown to the last new number", () => {
    const first = planSpareReservation({ band: null, taken: new Set([1, 2]), bibStartNumber: 1, count: 3 });
    expect(first).toEqual({ ok: true, printed: [3, 4, 5], walkInBibStart: 3, walkInBibCount: 3 });
    const second = planSpareReservation({ band: { from: 3, to: 5 }, taken: new Set([1, 2, 6]), bibStartNumber: 1, count: 2 });
    // 6 was an online runner's before the extension reached it: it stays theirs, inside the range.
    expect(second).toEqual({ ok: true, printed: [7, 8], walkInBibStart: 3, walkInBibCount: 6 });
  });

  it("refuses a count outside one to the per-print maximum, a reservation past its ceiling, and no room under 99 999", () => {
    const base = { band: null, taken: new Set<number>(), bibStartNumber: 1 };
    expect(planSpareReservation({ ...base, count: 0 })).toEqual({ ok: false, reason: "count" });
    expect(planSpareReservation({ ...base, count: SPARE_BIBS_PER_PRINT + 1 })).toEqual({ ok: false, reason: "count" });
    expect(planSpareReservation({ ...base, count: 2.5 })).toEqual({ ok: false, reason: "count" });
    expect(planSpareReservation({ ...base, count: SPARE_BIBS_PER_PRINT }).ok).toBe(true);
    const full = { from: 1, to: SPARE_BIBS_MAX - 1 };
    expect(planSpareReservation({ ...base, band: full, count: 1 }).ok).toBe(true);
    expect(planSpareReservation({ ...base, band: full, count: 2 })).toEqual({ ok: false, reason: "size" });
    expect(planSpareReservation({ ...base, band: { from: BIB_NUMBER_MAX - 1, to: BIB_NUMBER_MAX - 1 }, count: 2 })).toEqual({
      ok: false,
      reason: "ceiling",
    });
  });
});
