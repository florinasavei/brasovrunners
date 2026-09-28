import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { printedNumbersACancelWouldVoid, raceNumberOf } from "@/modules/registrations/domain/race-number";

/**
 * BR-REQ-038-01, `DECISIONS.md` §548 (amending §173, §420) — the number every surface shows: a
 * confirmed registration's, a finished one's kept retired, and nothing before the confirmation.
 */
describe("§548 the race number a surface shows", () => {
  it("shows a confirmed registration's number, and none while it has none", () => {
    expect(raceNumberOf({ status: "CONFIRMED", bibNumber: 12 })).toBe(12);
    expect(raceNumberOf({ status: "CONFIRMED", bibNumber: null })).toBeNull();
  });

  it("keeps a cancelled or expired registration's number, retired, so a printed bib can be pulled", () => {
    expect(raceNumberOf({ status: "CANCELLED", bibNumber: 7 })).toBe(7);
    expect(raceNumberOf({ status: "EXPIRED", bibNumber: 8 })).toBe(8);
  });

  it("shows nothing before the confirmation, whatever the row holds", () => {
    const before: RegistrationStatus[] = ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED"];
    for (const status of before) {
      expect(raceNumberOf({ status, bibNumber: 9 }), status).toBeNull();
      expect(raceNumberOf({ status, bibNumber: null }), status).toBeNull();
    }
  });
});

/**
 * BR-REQ-038-01 criterion 16, `DECISIONS.md` §311 — what the registrations list names beside its
 * bulk cancel before the press: the printed, settled numbers among the rows the form can cancel.
 */
describe("§311 the printed numbers a bulk cancel would void", () => {
  const PRINTED = new Date("2026-11-10T09:00:00Z");
  const row = (status: RegistrationStatus, bibNumber: number | null, bibPrintedAt: Date | null = PRINTED) => ({
    status,
    bibNumber,
    bibPrintedAt,
  });

  it("names a printed, settled number on a row that can still be cancelled, lowest first", () => {
    expect(printedNumbersACancelWouldVoid([row("CONFIRMED", 27), row("CONFIRMED", 12), row("CONFIRMED", 5, null)])).toEqual([12, 27]);
    // A cancelled entry that restarted keeps its printed number; cancelling it again voids it again.
    expect(printedNumbersACancelWouldVoid([row("PENDING_DECLARATION", 9)])).toEqual([9]);
  });

  it("names nothing a cancel cannot reach, nothing unprinted and nothing without a settled number", () => {
    expect(
      printedNumbersACancelWouldVoid([
        // Already over: void already, and on the bibs panel rather than in this warning.
        row("CANCELLED", 3),
        row("EXPIRED", 4),
        // No edge to CANCELLED: an unconfirmed address lapses on its own (§33).
        row("PENDING_EMAIL_CONFIRMATION", 6),
        // Settled but not on paper, and a row with no settled number at all.
        row("CONFIRMED", 7, null),
        row("CONFIRMED", null),
      ]),
    ).toEqual([]);
  });
});
