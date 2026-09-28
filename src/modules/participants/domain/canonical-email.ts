/**
 * IDNA through `new URL()`, not `node:url` (§234): Next's browser shim of `domainToASCII`
 * answers `""`, which made every address throw on the client (`EmailTwice`, §206). `new URL()`
 * converts to punycode in Node and every browser alike, and throws where the shim returned `""`.
 */
function domainToPunycode(domain: string): string {
  try {
    // The scheme is only a carrier; `hostname` is the punycode form, lowercased.
    return new URL(`http://${domain}`).hostname;
  } catch {
    return "";
  }
}

/**
 * Email identity for participants (AGENTS.md §10.4, BR-REQ-032-01 to BR-REQ-032-04). Priority-1
 * code (`docs/PRACTICES.md` §198): with no password or account, this *is* their identity.
 *
 *   deliveryEmail   what was typed, trimmed; mail goes here, capitalisation kept.
 *   normalizedEmail lowercased, submitted domain intact; for administrative search.
 *   canonicalEmail  the duplicate-detection identity, UNIQUE in the database.
 *
 * The canonical value is immutable once stored (§10.3), so any change of behaviour is a new
 * version with a migration plan, never an edit in place. It collapses known aliases of one
 * inbox; it does not claim two addresses are one human.
 */

/**
 * Version 2 (§74): Gmail dots are kept, so `a.savei@gmail.com` and `asavei@gmail.com` are two
 * participants; the plus tag is still stripped and `googlemail.com` still collapses. Migration
 * `0030` re-canonicalized every version-1 row.
 */
export const CANONICALIZATION_VERSION = 2;

export type CanonicalEmail = {
  deliveryEmail: string;
  normalizedEmail: string;
  canonicalEmail: string;
  /**
   * The inbox the mail lands in: canonical with Gmail dots removed too. The QA delivery
   * allowlist compares on this, since it protects whose inbox receives mail.
   */
  inboxEmail: string;
  canonicalizationVersion: number;
};

export class InvalidEmailError extends Error {
  /** Stable domain error code, translated at the boundary (AGENTS.md §14.3). */
  readonly code = "VALIDATION_ERROR";

  constructor(reason: string) {
    // Excludes the address: this message reaches logs (§10.4).
    super(`Invalid email address: ${reason}`);
    this.name = "InvalidEmailError";
  }
}

/**
 * Exact: a custom domain keeps its dots and tags, since there `a.n.a@` and `ana@` may be two people.
 */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const GMAIL_CANONICAL_DOMAIN = "gmail.com";

// Control characters and anything that would let one address impersonate another.
const FORBIDDEN = /[\u0000-\u001F<>()[\]\\,;:"\s]/;
// Zero-width and bidirectional marks: invisible, so two addresses could render identically.
const INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/;

export function canonicalizeEmail(input: string): CanonicalEmail {
  if (typeof input !== "string") throw new InvalidEmailError("not a string");

  // `trim` removes Unicode whitespace and line terminators, as §10.4 asks.
  const deliveryEmail = input.trim();

  if (deliveryEmail === "") throw new InvalidEmailError("empty");
  if (INVISIBLE.test(deliveryEmail)) throw new InvalidEmailError("contains invisible characters");

  // Exactly one mailbox, and no display-name form such as `Ana <ana@example.ro>`.
  const at = deliveryEmail.lastIndexOf("@");
  if (at <= 0 || at === deliveryEmail.length - 1) {
    throw new InvalidEmailError("must be exactly one address of the form local@domain");
  }

  const local = deliveryEmail.slice(0, at);
  const domain = deliveryEmail.slice(at + 1);

  if (local.includes("@")) throw new InvalidEmailError("more than one address");
  if (FORBIDDEN.test(local) || FORBIDDEN.test(domain)) {
    throw new InvalidEmailError("contains a forbidden character");
  }
  if (local.length > 64) throw new InvalidEmailError("local part too long");
  if (deliveryEmail.length > 254) throw new InvalidEmailError("address too long");

  // Internationalised domains become punycode so two spellings of one domain compare equal.
  const asciiDomain = domainToPunycode(domain);
  if (asciiDomain === "") throw new InvalidEmailError("domain is not valid");

  const normalizedDomain = asciiDomain.toLowerCase();
  if (!normalizedDomain.includes(".") || normalizedDomain.startsWith(".") || normalizedDomain.endsWith(".")) {
    throw new InvalidEmailError("domain must contain a dot and not begin or end with one");
  }

  // A product decision, not RFC 5321: no provider club members use has case-sensitive local
  // parts, and treating Ana@ and ana@ as two runners would be worse.
  const normalizedLocal = local.toLowerCase();
  const isGmail = GMAIL_DOMAINS.has(normalizedDomain);

  let canonicalLocal = normalizedLocal;
  if (isGmail) {
    // The +tag goes; the dots stay (version 2, §74): dotted spellings let the club rehearse with
    // distinct identities landing in one inbox, while a plus tag still cannot enter a race twice.
    canonicalLocal = canonicalLocal.split("+", 1)[0];
  }

  if (canonicalLocal === "" || canonicalLocal.replaceAll(".", "") === "") {
    // e.g. "+tag@gmail.com" or ".@gmail.com" — nothing identifying remains.
    throw new InvalidEmailError("no addressable local part remains after canonicalization");
  }

  return {
    deliveryEmail,
    // Keeps the submitted domain, so googlemail stays googlemail here (BR-REQ-032-02 c3).
    normalizedEmail: `${normalizedLocal}@${normalizedDomain}`,
    // Collapses googlemail to gmail, because it is one inbox.
    canonicalEmail: `${canonicalLocal}@${isGmail ? GMAIL_CANONICAL_DOMAIN : normalizedDomain}`,
    inboxEmail: `${isGmail ? canonicalLocal.replaceAll(".", "") : canonicalLocal}@${isGmail ? GMAIL_CANONICAL_DOMAIN : normalizedDomain}`,
    canonicalizationVersion: CANONICALIZATION_VERSION,
  };
}

/** True when the address can be canonicalized. Use at a form boundary before persisting. */
export function isValidEmail(input: string): boolean {
  try {
    canonicalizeEmail(input);
    return true;
  } catch {
    return false;
  }
}
