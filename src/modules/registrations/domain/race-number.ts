import type { RegistrationStatus } from "@/db/schema/registrations";
import { canTransition, isTerminalStatus } from "./state-machine";

/**
 * The race number a screen, an email or an export shows for a registration (`DECISIONS.md` §NNN,
 * amending §214): the number it wears once it is **confirmed**, and nothing before.
 *
 * A number is drawn at the moment of confirmation and never moves (§173), so there is one column
 * and one question: has this registration been confirmed? Before that — an address not proved, a
 * declaration not signed, an offer, the waiting list — nothing is shown anywhere, «—» in the
 * backoffice. A registration that is over keeps its number retired (a cancelled confirmed runner's
 * 27 is never given again), and the backoffice and the desk still show it, struck through, so a
 * printed bib can be pulled (§311). A row not confirmed yet that wears a number anyway — a
 * cancelled confirmed registration that restarted, or a number settled before §NNN — shows none
 * until it is confirmed again, and keeps that same number then.
 *
 * Pure, and over the row alone, so a list row, a desk row, a detail page and an export all ask it
 * the same way.
 */
export function raceNumberOf(row: { status: RegistrationStatus; bibNumber: number | null }): number | null {
  if (row.bibNumber === null) return null;
  return row.status === "CONFIRMED" || isTerminalStatus(row.status) ? row.bibNumber : null;
}

/**
 * The printed numbers a cancellation among these rows would make void (`DECISIONS.md` §311),
 * lowest first: a settled number, a printed mark, and a status that can still be cancelled.
 *
 * What the registrations list names beside its bulk cancel **before** the press. The ticked set
 * lives only in the browser — the checkboxes are plain inputs of a server-rendered form, and no
 * client island is spent on counting them — so the sentence is about the rows the form is showing,
 * which is every row it could cancel; the saved banner afterwards names the ones it actually did.
 */
export function printedNumbersACancelWouldVoid(
  rows: readonly { status: RegistrationStatus; bibNumber: number | null; bibPrintedAt: Date | null }[],
): number[] {
  return rows
    .filter((row) => row.bibNumber !== null && row.bibPrintedAt !== null && canTransition(row.status, "CANCELLED"))
    .map((row) => row.bibNumber as number)
    .sort((a, b) => a - b);
}
