import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";

/**
 * Whether a stored token may be acted on (BR-REQ-036-02 criteria 2 and 3).
 *
 * Priority-1 code — `docs/PRACTICES.md` §198. Read every line.
 *
 * Pure, and separate from the repository, so the four ways a token dies can be read in one
 * place and tested without a database. The repository expresses the same rules a second time
 * inside its single-statement UPDATE, where they have to be for atomicity; this function is
 * what the read path uses and what classifies a failed consume for the log.
 */

/** The fields any evaluation needs. Deliberately not the whole row: the hash stays put. */
export type EvaluatedToken = {
  purpose: EmailActionTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
};

/**
 * Why a token was refused.
 *
 * For logs, metrics and tests only. AGENTS.md §13.2 requires the *participant* to see one
 * generic invalid-or-expired response with a way to request a new link: telling a stranger
 * with a guessed URL whether a token exists, was used, or expired describes the system's
 * state to someone who has proven nothing.
 */
export type TokenRejectionReason =
  | "NOT_FOUND"
  | "PURPOSE_MISMATCH"
  | "INVALIDATED"
  | "ALREADY_USED"
  | "EXPIRED";

/** Stable domain error codes from AGENTS.md §14.3, translated at the boundary. */
export type TokenRejection = {
  ok: false;
  code: "TOKEN_INVALID" | "TOKEN_EXPIRED";
  reason: TokenRejectionReason;
};

export type TokenEvaluation = { ok: true } | TokenRejection;

export const TOKEN_NOT_FOUND: TokenRejection = {
  ok: false,
  code: "TOKEN_INVALID",
  reason: "NOT_FOUND",
};

/**
 * The order of these checks is a rule, not a preference.
 *
 * Purpose is checked first: a `MANAGE_REGISTRATION` link replayed against the declaration
 * endpoint must be indistinguishable from a token that does not exist, so nothing downstream
 * — not the expiry message, not a "this link was already used" hint — can confirm that the
 * value is a real token issued for something else.
 *
 * Invalidated is checked before used because a superseded token is the more common case: the
 * participant asked for a new link and clicked the old email. Both answer TOKEN_INVALID, so
 * the ordering only affects the reason recorded in the log.
 *
 * Expiry is checked last and is the one state that gets its own code, because it is the one
 * the participant can fix by asking for a new link.
 */
export function evaluateActionToken(
  token: EvaluatedToken,
  expectedPurpose: EmailActionTokenPurpose,
  now: Date,
): TokenEvaluation {
  if (token.purpose !== expectedPurpose) {
    return { ok: false, code: "TOKEN_INVALID", reason: "PURPOSE_MISMATCH" };
  }
  if (token.invalidatedAt !== null) {
    return { ok: false, code: "TOKEN_INVALID", reason: "INVALIDATED" };
  }
  if (token.usedAt !== null) {
    return { ok: false, code: "TOKEN_INVALID", reason: "ALREADY_USED" };
  }
  // Exactly at the expiry instant the token is already dead. A boundary that leans the other
  // way would let a token live for one more millisecond than the deadline it was issued with,
  // and every deadline in this system is capped by something real (§8).
  if (token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "TOKEN_EXPIRED", reason: "EXPIRED" };
  }
  return { ok: true };
}
