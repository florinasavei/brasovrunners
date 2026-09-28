import type { Database } from "@/db/types";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { hashTokenSecret, isWellFormedTokenSecret } from "./domain/token-secret";

/**
 * The throttle on token validation (AGENTS.md §19.4, §13.2; BR-REQ-036-02).
 *
 * It defends against one token being hammered (a leaked link, a scanner in a loop), not
 * enumeration of 32 random bytes. Keyed on the token's hash — one bucket per link, and no new
 * secret at rest (§14.5), since `email_action_tokens` already stores that hash.
 *
 * Called once per request at the route boundary, outside the caller's transaction: the context
 * read is read-only, `consumeAndSignDeclaration` consumes twice (§15.7) and would be charged
 * double, and a count a rollback erased could be reset by failing.
 */
export async function tokenAttemptAllowed<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
): Promise<boolean> {
  /**
   * A malformed value costs nothing: both repository entry points refuse it before hashing, and
   * `hashTokenSecret` would throw, so there is no key to count it under.
   */
  if (!isWellFormedTokenSecret(secret)) return true;

  const verdict = await consumeRateLimit(db, "token-validate", hashTokenSecret(secret), now);
  return verdict.allowed;
}
