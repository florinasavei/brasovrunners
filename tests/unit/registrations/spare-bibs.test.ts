import { readFileSync } from "node:fs";
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
  handsSpareAtConfirm,
  spareRangeOfQuery,
} from "@/modules/registrations/domain/spare-bibs";

/**
 * §444 — the desk's spare bibs: the numbers a print reserves, what the allocator steps over, what
 * the reprint prints blank and what the desk suggests.
 */
describe("§444 the reservation on the event", () => {
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

describe("§444 what a print reserves", () => {
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
    expect(first).toEqual({ ok: true, printed: [3, 4, 5], skipped: [], walkInBibStart: 3, walkInBibCount: 3 });
    const second = planSpareReservation({ band: { from: 3, to: 5 }, taken: new Set([1, 2, 6]), bibStartNumber: 1, count: 2 });
    // 6 was an online runner's before the extension reached it: it stays theirs, inside the range,
    // and the plan names it as stepped over — never a spare, since no blank bib carries it.
    expect(second).toEqual({ ok: true, printed: [7, 8], skipped: [6], walkInBibStart: 3, walkInBibCount: 6 });
  });

  it("names every number an extension stepped over, and none past the last it printed", () => {
    // Reserved 2–3; online runners hold 4, 5 and 8; three more spares: 6, 7, 9 — 4, 5, 8 skipped.
    const plan = planSpareReservation({ band: { from: 2, to: 3 }, taken: new Set([1, 4, 5, 8, 12]), bibStartNumber: 1, count: 3 });
    expect(plan).toEqual({ ok: true, printed: [6, 7, 9], skipped: [4, 5, 8], walkInBibStart: 2, walkInBibCount: 8 });
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

describe("§444 the print's banner", () => {
  it("reads a numeric range from the address, so the banner and its sheet link render", () => {
    // The redirect after «Tipărește» carries `from` and `to` as digits: the banner must appear.
    expect(spareRangeOfQuery("900", "949")).toEqual({ from: 900, to: 949 });
    expect(spareRangeOfQuery("7", "7")).toEqual({ from: 7, to: 7 });
    expect(spareRangeOfQuery("1", "99999")).toEqual({ from: 1, to: 99_999 });
  });

  it("shows nothing for a range that is not two numbers, or runs backwards", () => {
    expect(spareRangeOfQuery(undefined, "949")).toBeNull();
    expect(spareRangeOfQuery("900", undefined)).toBeNull();
    // The letter the lost backslash matched, and anything that is not digits alone.
    expect(spareRangeOfQuery("d", "d")).toBeNull();
    expect(spareRangeOfQuery("9a", "949")).toBeNull();
    expect(spareRangeOfQuery("900", "123456")).toBeNull();
    expect(spareRangeOfQuery("0", "5")).toBeNull();
    expect(spareRangeOfQuery("949", "900")).toBeNull();
  });

  it("is what the event page's banner is gated on", () => {
    const page = readFileSync("src/app/[locale]/admin/events/[id]/page.tsx", "utf8");
    expect(page).toContain('saved === "sparesReserved" ? spareRangeOfQuery(spareFrom, spareTo) : null');
    expect(page).toMatch(/\{reservedRange && \(\s*<Alert[\s\S]*?data-testid="spares-reserved"/);
  });
});

describe("§444 «Confirmă aici» hands a spare only to a walk-in", () => {
  const walkIn = { kind: "REAL", source: "STAFF", bibNumber: null, provisionalBibNumber: 3, bibPrintedAt: null };

  it("offers the spare to a staff walk-in, although the entry drew a provisional number like every row", () => {
    expect(handsSpareAtConfirm(walkIn)).toBe(true);
    // A row holding no number at all is a walk-in whatever its origin: nothing to keep.
    expect(handsSpareAtConfirm({ ...walkIn, source: "PUBLIC", provisionalBibNumber: null })).toBe(true);
  });

  it("leaves an online runner's provisional number theirs: no spare box, the confirmation adopts it", () => {
    expect(handsSpareAtConfirm({ ...walkIn, source: "PUBLIC", provisionalBibNumber: 57 })).toBe(false);
  });

  it("never swaps a printed or settled bib, and a test registration wears none", () => {
    const printed = new Date("2026-11-20T18:00:00Z");
    expect(handsSpareAtConfirm({ ...walkIn, source: "PUBLIC", bibNumber: 57, provisionalBibNumber: null, bibPrintedAt: printed })).toBe(false);
    expect(handsSpareAtConfirm({ ...walkIn, bibPrintedAt: printed })).toBe(false);
    expect(handsSpareAtConfirm({ ...walkIn, bibNumber: 57, provisionalBibNumber: null })).toBe(false);
    expect(handsSpareAtConfirm({ ...walkIn, kind: "TEST" })).toBe(false);
  });

  it("is what the desk row's spare box and its «out» sentence are gated on", () => {
    const desk = readFileSync("src/modules/registrations/ui/DeskRow.tsx", "utf8");
    expect(desk).toContain('spare.kind !== "none" && handsSpareAtConfirm(row) && (');
    expect(desk).toContain("sparesOut && handsSpareAtConfirm(row) &&");
    expect(desk).not.toContain('row.bibNumber === null && row.kind === "REAL"');
  });
});
