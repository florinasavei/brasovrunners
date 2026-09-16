import type { Database } from "@/db/types";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { hashTokenSecret, isWellFormedTokenSecret } from "./domain/token-secret";

/**
 * The throttle on token validation (AGENTS.md §19.4, §13.2; BR-REQ-036-02).
 *
 * `repository.ts` named this as its own missing piece: "an unbounded endpoint that hashes and
 * queries per request is still a free amplifier". This is it.
 *
 * ## What is being defended, and what is not
 *
 * **Not enumeration.** A token secret is 32 random bytes. Guessing one is not a thing a rate
 * limit makes harder, and pretending otherwise would invite a per-IP limit — which §19.4
 * forbids as participant identity and which this table would then persist.
 *
 * **One token being hammered.** A link that reached a mailing list, a scanner in a retry loop,
 * a script replaying a captured URL: each request costs a SHA-256 and an indexed query, and
 * one of them is a serverless invocation the club pays for. The key is therefore the presented
 * token's own hash — one bucket per link, so a hammered link cannot slow anybody else's.
 *
 * ## The key is the hash, and that is not incidental
 *
 * `rate_limit_buckets.key` is stored. Keying on the secret would write into a second table the
 * one value §14.5 says must never be persisted, and would put working links in a stolen
 * backup. The hash is exactly what `email_action_tokens.token_hash` already holds, so this
 * adds no secret at rest — the same argument `token-secret.ts` makes for storing it there.
 *
 * ## Called once per request, at the route boundary
 *
 * Not inside `readActionTokenContext`/`consumeActionToken`, for two reasons that both bite.
 * `readActionTokenContext` runs in a read-only transaction and PostgreSQL refuses a write in
 * one. And `consumeAndSignDeclaration` calls `consumeActionToken` twice — once for
 * `COMPLETE_DECLARATION`, once for `WAITLIST_OFFER` (§15.7) — so a throttle in the repository
 * would charge one participant's click two attempts and halve the allowance for the only
 * surface where it is a single human action.
 *
 * It is also called outside the caller's transaction, so an attempt that ends in a rollback
 * still leaves its count behind. A throttle that a failing request erases is a throttle an
 * attacker can reset by failing.
 */
export async function tokenAttemptAllowed<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
): Promise<boolean> {
  /**
   * A malformed value is allowed through, and costs nothing to allow.
   *
   * `isWellFormedTokenSecret` refuses it in both repository entry points before any hash is
   * computed or any row is read, so there is no amplifier here to bound — and `hashTokenSecret`
   * throws on one, so there is no key to count it under either. Answering "allowed" hands it
   * straight to that shape check and the same generic refusal every other bad token gets.
   */
  if (!isWellFormedTokenSecret(secret)) return true;

  const verdict = await consumeRateLimit(db, "token-validate", hashTokenSecret(secret), now);
  return verdict.allowed;
}
