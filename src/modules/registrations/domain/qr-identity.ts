import type { RegistrationStatus } from "@/db/schema/registrations";
import { raceNumberOf } from "./race-number";

/**
 * Whose QR code this is (§547; the owner, 2026-09-28, walking a family of three on QA: three
 * identical squares, and nothing beside them to tell them apart). Beside every QR — the confirmed
 * email, «Gestionează înscrierea», «Înscrierile mele» — and on the club copy, which carries no QR
 * (§320), the person's name and their race number: the number once one is given, «—» before.
 *
 * The number is the one rule every surface asks, `raceNumberOf({ status, bibNumber })` (§NNN): a
 * number exists once the registration is confirmed, so there is nothing here to qualify it —
 * `raceNumber ?? «—»`. Pure, so the three surfaces and the email agree.
 */
export type QrIdentity = {
  name: string;
  /** The number as it is printed beside the code, or «—» while there is none. */
  number: string;
};

/** The dash a missing number reads as, on the pages and in the email alike. */
export const NO_RACE_NUMBER = "—";

export function qrIdentity(row: { registeredName: string; status: RegistrationStatus; bibNumber: number | null }): QrIdentity {
  const raceNumber = raceNumberOf({ status: row.status, bibNumber: row.bibNumber });
  return {
    name: row.registeredName.trim(),
    number: raceNumber !== null ? String(raceNumber) : NO_RACE_NUMBER,
  };
}
