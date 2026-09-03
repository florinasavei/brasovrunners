import { domainToASCII } from "node:url";

/**
 * Email identity for participants.
 *
 * AGENTS.md §10.4, BR-REQ-032-01 to BR-REQ-032-04. This is priority-1 code: the participant
 * has no password and no account, so this function *is* their identity. `docs/PRACTICES.md`
 * §198 lists it among the code that must be read line by line rather than accepted.
 *
 * Three values come out of one address and they are not interchangeable:
 *
 *   deliveryEmail   what the participant typed, minus surrounding whitespace. Mail is sent
 *                   here, and it keeps their capitalisation because it is their address.
 *   normalizedEmail lowercased, submitted domain intact. Used for administrative search.
 *   canonicalEmail  the duplicate-detection identity, UNIQUE in the database.
 *
 * The canonical value is immutable once stored (§10.3): there is no merge path and no
 * verified-email change, so a rule loosened here can never be un-applied to existing rows.
 * Changing any behaviour below means a new version, a migration plan, and tests — never an
 * edit in place.
 *
 * What this does NOT claim: that two different addresses belong to the same human. It
 * collapses well-known aliases of one inbox, nothing more.
 */

export const CANONICALIZATION_VERSION = 1;

export type CanonicalEmail = {
  deliveryEmail: string;
  normalizedEmail: string;
  canonicalEmail: string;
  canonicalizationVersion: number;
};

export class InvalidEmailError extends Error {
  /** Stable domain error code, translated at the boundary (AGENTS.md §14.3). */
  readonly code = "VALIDATION_ERROR";

  constructor(reason: string) {
    // Deliberately excludes the address itself: this message reaches logs, and §10.4
    // forbids logging participant email beyond operational need.
    super(`Invalid email address: ${reason}`);
    this.name = "InvalidEmailError";
  }
}

/**
 * The two domains Google serves from one inbox. Kept exact: these rules apply to these two
 * strings and nothing else. A custom domain that merely looks similar keeps its dots and tags,
 * because on a custom domain `a.n.a@` and `ana@` may be two different people.
 */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const GMAIL_CANONICAL_DOMAIN = "gmail.com";

// Control characters and anything that would let one address impersonate another.
const FORBIDDEN = /[\u0000-\u001F<>()[\]\\,;:"\s]/;
// Zero-width and bidirectional marks: invisible, and two addresses differing only by one of
// these would be distinct identities that render identically.
const INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/;

export function canonicalizeEmail(input: string): CanonicalEmail {
  if (typeof input !== "string") throw new InvalidEmailError("not a string");

  // `trim` removes Unicode whitespace and line terminators, which is what §10.4 asks for.
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
  const asciiDomain = domainToASCII(domain);
  if (asciiDomain === "") throw new InvalidEmailError("domain is not valid");

  const normalizedDomain = asciiDomain.toLowerCase();
  if (!normalizedDomain.includes(".") || normalizedDomain.startsWith(".") || normalizedDomain.endsWith(".")) {
    throw new InvalidEmailError("domain must contain a dot and not begin or end with one");
  }

  // Lowercasing the local part is a deliberate product decision, not a standards one: RFC 5321
  // permits case-sensitive local parts, but no mail provider a club member uses treats them
  // that way, and treating Ana@ and ana@ as two runners would be worse than the edge case.
  const normalizedLocal = local.toLowerCase();
  const isGmail = GMAIL_DOMAINS.has(normalizedDomain);

  let canonicalLocal = normalizedLocal;
  if (isGmail) {
    // Order matters: strip the +tag first, then dots. Doing it the other way would keep dots
    // that appear inside the tag.
    canonicalLocal = canonicalLocal.split("+", 1)[0].replaceAll(".", "");
  }

  if (canonicalLocal === "") {
    // e.g. "+tag@gmail.com" or ".@gmail.com" — nothing identifying remains.
    throw new InvalidEmailError("no addressable local part remains after canonicalization");
  }

  return {
    deliveryEmail,
    // Keeps the submitted domain, so googlemail stays googlemail here (BR-REQ-032-02 c3).
    normalizedEmail: `${normalizedLocal}@${normalizedDomain}`,
    // Collapses googlemail to gmail, because it is one inbox.
    canonicalEmail: `${canonicalLocal}@${isGmail ? GMAIL_CANONICAL_DOMAIN : normalizedDomain}`,
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
