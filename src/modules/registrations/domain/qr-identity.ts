/**
 * Whose QR code this is (§NNN; the owner, 2026-09-28, walking a family of three on QA: three
 * identical squares, and nothing beside them to tell them apart). Beside every QR — the confirmed
 * email, «Gestionează înscrierea», «Înscrierile mele» — and on the club copy, which carries no QR
 * (§320), the person's name and their race number: the number once one is given, «—» before.
 *
 * The number is the registration's own race number, `bib_number`, and nothing else: a number exists
 * once the registration is confirmed (the sibling change of the same release), so there is no
 * «provisional» here to qualify it — `raceNumber ?? «—»`. Pure, so the three surfaces and the email
 * agree.
 */
export type QrIdentity = {
  name: string;
  /** The number as it is printed beside the code, or «—» while there is none. */
  number: string;
};

/** The dash a missing number reads as, on the pages and in the email alike. */
export const NO_RACE_NUMBER = "—";

export function qrIdentity(row: { registeredName: string; bibNumber: number | null }): QrIdentity {
  return {
    name: row.registeredName.trim(),
    number: row.bibNumber !== null ? String(row.bibNumber) : NO_RACE_NUMBER,
  };
}
