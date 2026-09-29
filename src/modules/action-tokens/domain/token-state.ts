import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";

/**
 * Whether a stored token may be acted on (BR-REQ-036-02 criteria 2 and 3). Priority-1 code
 * (`docs/PRACTICES.md` §198). Pure, for the read path and for classifying a failed consume; the
 * repository's single-statement UPDATE repeats the same rules for atomicity.
 */

/** The fields an evaluation needs; not the whole row, so the hash stays put. */
export type EvaluatedToken = {
  purpose: EmailActionTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
};

/**
 * Why a token was refused — for logs, metrics and tests only. The participant sees one generic
 * invalid-or-expired response (AGENTS.md §13.2).
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
 * The order is a rule. Purpose first, so a link replayed against another endpoint is
 * indistinguishable from a missing token. Invalidated before used only affects the logged
 * reason. Expiry last, with its own code, because a new link fixes it.
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
  // Dead at the expiry instant itself, never one millisecond past the deadline (§8).
  if (token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "TOKEN_EXPIRED", reason: "EXPIRED" };
  }
  return { ok: true };
}
