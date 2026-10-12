import type { RegistrationStatus } from "@/db/schema/registrations";
import { canTransition, isTerminalStatus } from "./state-machine";

/**
 * The race number a screen, an email or an export shows for a registration (`DECISIONS.md` §548,
 * amending §214): the number it wears once it is **confirmed**, and nothing before.
 *
 * A number is drawn at the moment of confirmation and never moves (§173), so there is one column
 * and one question: has this registration been confirmed? Before that — an address not proved, a
 * declaration not signed, an offer, the waiting list — nothing is shown anywhere, «—» in the
 * backoffice. A registration that is over keeps its number retired (a cancelled confirmed runner's
 * 27 is never given again), and the backoffice and the desk still show it, struck through, so a
 * printed bib can be pulled (§311). A row not confirmed yet that wears a number anyway — a
 * cancelled confirmed registration that restarted, or a number settled before §548 — shows none
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
 * How a race number is written (§735; the owner, 2026-10-12: «on the BIB designer I need to be able
 * to set how the numbers look so that they always have 3 digits, eg: 001, 002, 003, also on the
 * website and emails they should look like that»): `plain` as the number is (7, 42, 150), the
 * default and what every event printed before; `pad3` and `pad4` with leading zeros up to three or
 * four digits (007, 042, 150 — a number already as long is written as it is, never cut).
 *
 * The event's choice, in its bib design («Cum arată numărul», `bib-design.ts#numberFormat`): the bib,
 * the emails, the public list, «Înscrierile mele», the desk and the backoffice all write the number
 * through `formatRaceNumber` with it, so the runner reads one number everywhere. What is stored is
 * the integer: the order of the band, the numbers typed by hand and every comparison stay numeric.
 */
export const RACE_NUMBER_FORMATS = ["plain", "pad3", "pad4"] as const;
export type RaceNumberFormat = (typeof RACE_NUMBER_FORMATS)[number];

/** The digits a format pads to: none, three or four. */
export function raceNumberWidth(format: RaceNumberFormat | null | undefined): number {
  return format === "pad3" ? 3 : format === "pad4" ? 4 : 0;
}

/** The number as the event writes it: `7` → «007» under `pad3`; a malformed format reads as `plain`. */
export function formatRaceNumber(number: number, format: RaceNumberFormat | null | undefined): string {
  const width = raceNumberWidth(format);
  const digits = String(number);
  return width > 0 && Number.isInteger(number) && number >= 0 ? digits.padStart(width, "0") : digits;
}

/** The format as stored or posted, never a throw: anything this release does not know is `plain`. */
export function readRaceNumberFormat(value: unknown): RaceNumberFormat {
  return (RACE_NUMBER_FORMATS as readonly unknown[]).includes(value) ? (value as RaceNumberFormat) : "plain";
}

/**
 * `raceNumberOf`, written as the row's event writes it (§735) — what a screen shows beside a name —
 * or null while the registration has no number to show.
 */
export function raceNumberTextOf(row: {
  status: RegistrationStatus;
  bibNumber: number | null;
  raceNumberFormat?: RaceNumberFormat | null;
}): string | null {
  const number = raceNumberOf(row);
  return number === null ? null : formatRaceNumber(number, row.raceNumberFormat);
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
