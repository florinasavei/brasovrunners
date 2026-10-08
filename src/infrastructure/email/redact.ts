/**
 * The one redactor for a provider's own words before anything stores them (§14.5, §16.1, §670): the
 * send's refusal body (`mailgun-adapter.ts`) and the delivery webhook's SMTP text alike. A receiving
 * server's answer quotes the recipient often — whole («<ana@example.com>: user unknown») or only the
 * local part («ana.popescu… does not exist») — and a long opaque run may be a token from a link the
 * message carried. None of it may reach `last_error` or `provider_detail`, which staff read and logs
 * and backups carry.
 *
 * Redacted first, cut after: cutting first can leave half an address that no pattern recognises.
 * Deliberately greedy: a false positive costs a word of context, a false negative stores somebody's
 * address.
 */

/** Anything shaped like an address. */
const EMAIL_SHAPED = /[^\s<>"'()[\],;]+@[^\s<>"'()[\],;]+\.[^\s<>"'(),;\]]+/g;
/** A secret-length opaque run — a token's 43 characters, a provider id: never worth keeping. */
const SECRET_LIKE = /[A-Za-z0-9_-]{32,}/g;
/** An IPv4 literal (a sending or receiving host). */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** An IPv6 literal — three colons at least, so a clock time («10:00:00») is never taken for one. */
const IPV6 = /\b(?:[0-9a-f]{0,4}:){3,7}[0-9a-f]{0,4}\b/gi;

export const PROVIDER_TEXT_MAX = 200;

export type RedactOptions = {
  /** Strings that must never be stored, whatever they look like — the API key. */
  secrets?: readonly string[];
  /** The address the text is about: its local part is redacted too, when a server quotes it alone. */
  recipient?: string | null;
  /** The longest result; `PROVIDER_TEXT_MAX` when absent. */
  max?: number;
};

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The provider's text, with nothing in it that names a person or opens anything; `""` for nothing. */
export function redactProviderText(text: string | null | undefined, options: RedactOptions = {}): string {
  if (typeof text !== "string") return "";
  let redacted = text.replace(/\s+/g, " ");
  for (const secret of options.secrets ?? []) if (secret) redacted = redacted.replaceAll(secret, "<redacted>");
  redacted = redacted.replace(EMAIL_SHAPED, "<address>");
  const local = options.recipient?.trim().split("@")[0] ?? "";
  // Three characters at least, bounded by what cannot be part of a local part: «an» inside «cannot» is not a name.
  if (local.length >= 3) {
    redacted = redacted.replace(new RegExp(`(^|[^A-Za-z0-9._+-])${escapeForPattern(local)}(?=$|[^A-Za-z0-9._+-])`, "gi"), "$1<address>");
  }
  redacted = redacted.replace(IPV4, "<ip>").replace(IPV6, "<ip>").replace(SECRET_LIKE, "[redacted]");
  return redacted.trim().slice(0, options.max ?? PROVIDER_TEXT_MAX).trim();
}
