import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { printedNumbersACancelWouldVoid } from "@/modules/registrations/domain/race-number";

/**
 * BR-REQ-038-01 criterion 16, `DECISIONS.md` §308 — what the registrations list names beside its
 * bulk cancel before the press: the printed, settled numbers among the rows the form can cancel.
 */
describe("§308 the printed numbers a bulk cancel would void", () => {
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
