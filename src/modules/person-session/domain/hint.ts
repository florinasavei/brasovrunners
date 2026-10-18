/**
 * The remembered browser's two cookies, and what the readable one holds (§NNN, «Vin!» part 1).
 *
 *   `br_person`       the secret. `httpOnly`, `SameSite=Lax`, path `/`, one year. Only the server reads it, and only its
 *                     SHA-256 is stored (`person_sessions.secret_hash`).
 *   `br_person_hint`  readable by scripts, holds **no secret**: the address masked («an…@gmail.com») and the name the
 *                     person gave, so a cached page's one island can draw «Răspunzi ca an…@gmail.com» without a request.
 *                     It proves nothing: a press always goes through a server action that reads `br_person`.
 *
 * Pure, so the island (a client component) and the tests read the same rule.
 */
export const PERSON_COOKIE = "br_person";
export const PERSON_HINT_COOKIE = "br_person_hint";

/** One year, in days and in seconds: the row's `expires_at` and the cookie's life. */
export const PERSON_SESSION_DAYS = 365;
export const PERSON_SESSION_SECONDS = PERSON_SESSION_DAYS * 24 * 60 * 60;

/** The most browsers one address keeps remembered: the oldest by last use goes when a newer one is added. */
export const PERSON_SESSIONS_PER_ADDRESS = 10;

/**
 * «an…@gmail.com»: the first two characters of the local part (one, when it has one or two), an ellipsis, the domain.
 * Enough for a person to recognise their own address and not enough for anyone to learn another's.
 */
export function maskAddress(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}…@${domain}`;
}

export type PersonHint = { masked: string; name: string | null };

/**
 * The hint as the cookie's value: short JSON. It is NOT URI-encoded here: Next's `cookies().set` encodes a value on the wire itself, so
 * encoding it twice would hand the browser `%257B…` and leave the island unable to read it (found by the end-to-end spec).
 */
export function encodeHint(hint: PersonHint): string {
  return JSON.stringify({ m: hint.masked, n: hint.name });
}

/**
 * The hint from a cookie's value, or null when it is missing or not ours: the island then draws nothing. `document.cookie` gives the
 * value as it travels — URI-encoded once — so it is decoded once; a value that is not a valid URI escape is read as it stands.
 */
export function decodeHint(value: string | undefined | null): PersonHint | null {
  if (!value) return null;
  try {
    let text = value;
    try {
      text = decodeURIComponent(value);
    } catch {
      // Not a URI escape: the value as it stands.
    }
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const { m, n } = parsed as { m?: unknown; n?: unknown };
    if (typeof m !== "string" || m === "" || m.length > 400) return null;
    return { masked: m, name: typeof n === "string" && n !== "" ? n.slice(0, 80) : null };
  } catch {
    return null;
  }
}
