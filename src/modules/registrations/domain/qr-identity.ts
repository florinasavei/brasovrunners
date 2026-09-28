import { raceNumberOf } from "./race-number";

/**
 * Whose QR code this is (§NNN; the owner, 2026-09-28, walking a family of three on QA: three
 * identical squares, and nothing beside them to tell them apart). Beside every QR — the confirmed
 * email, «Gestionează înscrierea», «Înscrierile mele» — and on the club copy, which carries no QR
 * (§320), the person's name and their race number: the number once one is given, «—» before.
 *
 * Data-driven on purpose: whether a number exists before the confirmation is the numbering's
 * business (§173, §214, §420), and this reads the two columns through `raceNumberOf` and nothing
 * else, so it says whatever the row holds. Pure, so the three surfaces and the email agree.
 */
export type QrIdentity = {
  name: string;
  /** The number as it is printed beside the code, or «—» while there is none. */
  number: string;
  /** True for a number held before the close, which can still move (§214). */
  provisional: boolean;
};

/** The dash a missing number reads as, on the pages and in the email alike. */
export const NO_RACE_NUMBER = "—";

export function qrIdentity(row: { registeredName: string; bibNumber: number | null; provisionalBibNumber: number | null }): QrIdentity {
  const number = raceNumberOf(row);
  return {
    name: row.registeredName.trim(),
    number: number ? String(number.value) : NO_RACE_NUMBER,
    provisional: number !== null && !number.settled,
  };
}
