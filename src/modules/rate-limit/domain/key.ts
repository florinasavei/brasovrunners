import { createHash } from "node:crypto";

/**
 * A throttle bucket's key for an email identity: a hash, never the address (§322). The scope is
 * in the hash, so one address gives a different key per action. The formula is the contact
 * form's original, so its live buckets kept counting.
 */
export function emailBucketKey(scope: string, canonicalEmail: string): string {
  return createHash("sha256").update(`${scope}:${canonicalEmail}`).digest("hex");
}
