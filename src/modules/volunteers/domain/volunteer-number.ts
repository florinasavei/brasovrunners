/*
  A volunteer's number as people read it (§1023, amending §948; the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001
  V002 la toti voluntarii automat!»): the event's own volunteers' series — 1, 2, 3, … in the order the organizers confirm them
  (`event_volunteers.volunteer_number`, `volunteer-numbers.ts#drawVolunteerNumber`) — written «V» and at least three digits:
  «V001», «V012», «V123», «V1000». Pure: the «Voluntari» list and the person's chip, the plan, the volunteers' CSV and Excel, the
  raffle's files and its tab all write it through `formatVolunteerNumber`, so a volunteer reads one number everywhere.

  The «V» is what keeps the two series apart for a reader: a volunteer's 1 is «V001», a runner's 1 is «1» (or «001» as the event
  writes it, §735) — two different people, and no list ever compares the two (`domain/raffle.ts#compareRaffleRows` puts the race
  numbers first, then the V numbers).
*/

/** The letter before a volunteer's number: «V» in both languages — «voluntar», «volunteer». */
export const VOLUNTEER_NUMBER_PREFIX = "V";

/** The digits a volunteer's number is padded to: three, so a list of «V007»…«V120» lines up; a longer one is written whole. */
export const VOLUNTEER_NUMBER_DIGITS = 3;

/** The highest number the public form takes as a volunteer's: five digits, as a race number (`domain/raffle.ts#RAFFLE_NUMBER_MAX`). */
const VOLUNTEER_NUMBER_TYPED_MAX = 99_999;

/** `7` → «V007», `12` → «V012», `1000` → «V1000». A value that is no positive whole number is written as it is, never padded. */
export function formatVolunteerNumber(number: number): string {
  const digits = String(number);
  return Number.isInteger(number) && number > 0 ? `${VOLUNTEER_NUMBER_PREFIX}${digits.padStart(VOLUNTEER_NUMBER_DIGITS, "0")}` : `${VOLUNTEER_NUMBER_PREFIX}${digits}`;
}

/** The number written, or null for a volunteer who has none yet (not confirmed). */
export function volunteerNumberText(number: number | null | undefined): string | null {
  return number === null || number === undefined ? null : formatVolunteerNumber(number);
}

/**
 * A volunteer's number as somebody types it — on the raffle's public form with «Sunt voluntar» ticked: «V007», «v7», «V 7», «007»
 * or «7» are all 7; anything else — no digits, a letter other than the one «V», a sign, a fraction, nought, more than five digits —
 * is null. The «V» is optional because a phone's numeric keypad has none.
 */
export function volunteerNumberFrom(value: string): number | null {
  const match = /^\s*[Vv]?\s*(\d{1,5})\s*$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= VOLUNTEER_NUMBER_TYPED_MAX ? number : null;
}
