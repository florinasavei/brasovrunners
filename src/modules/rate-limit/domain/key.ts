import { createHash } from "node:crypto";

/**
 * A throttle bucket's key for an email identity: a hash, never the address (§NNN).
 *
 * The bucket only ever needs equality — "is this the same identity as the last request" — so
 * the address itself has no reason to sit in `rate_limit_buckets` for the day the row lives.
 * The contact form hashed its key from the start ("the notice says no copy is kept"); the
 * registration form, the link request and "Înscrierile mele" stored the canonical address in
 * plain text, which the privacy notice's "anti-abuse counters: one day" did not describe.
 *
 * The scope is in the hash, so one address gives a different key per guarded action and a row
 * of one scope says nothing about another. The formula is the contact form's own, unchanged, so
 * its live buckets keep counting across the deploy that moved it here.
 */
export function emailBucketKey(scope: string, canonicalEmail: string): string {
  return createHash("sha256").update(`${scope}:${canonicalEmail}`).digest("hex");
}
