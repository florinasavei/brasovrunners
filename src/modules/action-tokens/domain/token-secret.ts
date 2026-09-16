import { createHash, randomBytes } from "node:crypto";

/**
 * The secret half of an email action token (AGENTS.md §13.2; BR-REQ-036-02 criterion 1).
 *
 * Priority-1 code — `docs/PRACTICES.md` §198. Read every line.
 *
 * One value exists in two forms and they must never be confused:
 *
 *   secret  32 random bytes, base64url, 43 characters. Goes into exactly one email and is
 *           never written to the database, a log, an error message, or a trace.
 *   hash    SHA-256 of the secret, hex. The only form that is stored, and the only form that
 *           is ever looked up.
 *
 * Why a hash and not encryption: a stolen database backup must not yield working links. A
 * hash cannot be reversed, and the participant's own email already holds the one copy of the
 * secret that needs to exist.
 *
 * Why no JWT: §13.2 forbids one without a reviewed reason. A JWT would put the purpose, the
 * participant and the expiry into a value the participant can read and nobody can revoke; a
 * database row can be invalidated in one statement, which is exactly what criterion 5 needs.
 */

/** §13.2 requires a minimum of 32 bytes. 256 bits of entropy is not a number to negotiate. */
export const TOKEN_SECRET_BYTES = 32;

/** 32 bytes of base64url, unpadded: ceil(32 * 8 / 6) = 43 characters. */
export const TOKEN_SECRET_LENGTH = 43;

/** SHA-256, hex encoded. Matches the CHECK constraint on `email_action_tokens.token_hash`. */
export const TOKEN_HASH_LENGTH = 64;

/**
 * base64url, exactly the length `generateTokenSecret` produces.
 *
 * Anything else is rejected before it reaches the database. That keeps a hostile URL from
 * turning into an unbounded hash computation, and means the only strings that ever reach the
 * token lookup are the shape this application issues.
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
 * The stored form of a secret.
 *
 * Throws rather than hashing anything at all, because a malformed input is a caller bug or an
 * attack, and a hash of garbage would be looked up, miss, and be reported as "invalid token" —
 * hiding both. The message deliberately contains no part of the input: it reaches logs.
 */
export function hashTokenSecret(secret: string): string {
  if (!isWellFormedTokenSecret(secret)) {
    throw new Error("Action token secret is not the expected shape");
  }
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * On §13.2's "safe constant-time hash comparison where applicable".
 *
 * It is not applicable here, and adding a `timingSafeEqual` with no caller would suggest
 * otherwise. Exactly one comparison of a token value happens in this application: PostgreSQL
 * matching `token_hash` in a single statement. That comparison is not constant time — a
 * b-tree index cannot be — and it does not need to be, because what is being compared is
 * already a SHA-256 digest. Timing tells an attacker which digest they are near, and getting
 * near a digest requires the 256-bit preimage they are trying to obtain.
 *
 * The clause applies the day something compares a secret in application memory: a webhook
 * signature (§16.5), or a `JOB_SECRET` on a job endpoint (§16.2). Neither exists yet, and
 * both must use `crypto.timingSafeEqual` when they do.
 */
