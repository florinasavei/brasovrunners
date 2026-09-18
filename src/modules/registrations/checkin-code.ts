import { randomBytes } from "node:crypto";

/**
 * The code a participant shows at the desk (BR-REQ-037-08): 10 characters from an alphabet
 * with no 0/O or 1/I, so it can be read out over a counter as well as scanned. 50 bits — an
 * identifier that cannot be guessed, not a credential: the page it opens is staff-only, and
 * holding it confers nothing. Its own module because both the allocator and the email
 * renderer mint one, and the renderer must not import the allocator.
 */
export const CHECKIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CHECKIN_CODE_LENGTH = 10;

export function newCheckinCode(): string {
  const bytes = randomBytes(CHECKIN_CODE_LENGTH);
  return Array.from(bytes, (byte) => CHECKIN_CODE_ALPHABET[byte % CHECKIN_CODE_ALPHABET.length]).join("");
}

/** What a scanner or a typed code is checked against before it is looked up. */
export function isCheckinCode(value: string): boolean {
  return value.length === CHECKIN_CODE_LENGTH && [...value].every((c) => CHECKIN_CODE_ALPHABET.includes(c));
}

/** A typed code arrives lower-case or with spaces; a scanned one arrives as the whole URL. */
export function normalizeCheckinCode(value: string): string {
  const tail = value.trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return tail.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
