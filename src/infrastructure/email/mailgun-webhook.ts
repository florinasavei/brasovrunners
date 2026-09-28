import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mailgun webhook signature verification (AGENTS.md §16.5): hex `HMAC-SHA256(signingKey,
 * timestamp + token)`. A stale timestamp is refused too, since the HMAC does not stop a replay.
 */

const MAX_SIGNATURE_AGE_SECONDS = 15 * 60;

export type MailgunSignature = { timestamp: string; token: string; signature: string };

export function isValidMailgunSignature(
  signingKey: string,
  { timestamp, token, signature }: MailgunSignature,
  now: Date = new Date(),
): boolean {
  if (!/^\d+$/.test(timestamp) || !token || !signature) return false;

  const ageSeconds = now.getTime() / 1000 - Number(timestamp);
  if (ageSeconds < 0 || ageSeconds > MAX_SIGNATURE_AGE_SECONDS) return false;

  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
