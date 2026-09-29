import { createHash, randomBytes } from "node:crypto";

/**
 * The secret half of an email action token (AGENTS.md §13.2; BR-REQ-036-02 criterion 1).
 * Priority-1 code (`docs/PRACTICES.md` §198).
 *
 *   secret  32 random bytes, base64url, 43 characters. Goes into exactly one email; never
 *           written to the database, a log, an error message or a trace.
 *   hash    SHA-256 of the secret, hex. The only form stored or looked up.
 *
 * A hash, so a stolen backup yields no working links; no JWT (§13.2), because a row can be
 * invalidated in one statement (criterion 5).
 */

/** §13.2's minimum: 256 bits. */
export const TOKEN_SECRET_BYTES = 32;

/** 32 bytes of base64url, unpadded: ceil(32 * 8 / 6) = 43 characters. */
export const TOKEN_SECRET_LENGTH = 43;

/** SHA-256, hex encoded. Matches the CHECK constraint on `email_action_tokens.token_hash`. */
export const TOKEN_HASH_LENGTH = 64;

/**
 * base64url, exactly the length `generateTokenSecret` produces; anything else is rejected before
 * it is hashed or looked up.
 */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh secret. The caller emails it and then forgets it; only its hash is stored. */
export function generateTokenSecret(): string {
  return randomBytes(TOKEN_SECRET_BYTES).toString("base64url");
}

export function isWellFormedTokenSecret(input: string): boolean {
  return typeof input === "string" && SECRET_PATTERN.test(input);
}

/**
 * The stored form of a secret. Throws on a malformed input — a caller bug or an attack that a
 * hash-and-miss would hide. The message contains no part of the input: it reaches logs.
 */
export function hashTokenSecret(secret: string): string {
  if (!isWellFormedTokenSecret(secret)) {
    throw new Error("Action token secret is not the expected shape");
  }
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * §13.2's constant-time comparison does not apply here: the only token comparison is PostgreSQL
 * matching an indexed SHA-256 digest, and timing near a digest does not reveal its preimage. A
 * secret compared in application memory must use `crypto.timingSafeEqual`.
 */
