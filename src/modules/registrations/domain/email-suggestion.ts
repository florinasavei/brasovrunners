/**
 * "Did you mean gmail.com?" — the check that would have caught the addresses that actually
 * lost this club people (`DECISIONS.md` §233).
 *
 * ## Why validity is not the useful question
 *
 * Every address that has cost a registration here was **syntactically perfect**. QA's outbox
 * holds three bounced messages to `…@gmail.con` (§206), and one of the owner's own attempts
 * went to `prinicipal33.com`, which Mailgun refused with "No MX for prinicipal33.com". A
 * `type="email"` check accepts both, the server accepts both, and the person is told to go and
 * read an inbox that will never receive anything. Nothing downstream can recover them: a
 * resend goes to the same wrong address, and the club never learns they tried.
 *
 * So the valuable check is not "is this an address" but "is this the address you meant", and
 * the only moment it is cheap is while they are looking at it.
 *
 * ## Why a table and not a distance function
 *
 * An edit-distance suggestion against a list of popular domains is the usual approach and it
 * guesses: it will offer `gmail.com` to somebody at a real company domain one letter away, and
 * a suggestion that is wrong teaches people to dismiss the next one. This table only fires on
 * spellings that are **not domains at all** — nobody's mail is at `gmail.con` — so it is never
 * wrong about a real address, only silent about a typo it has not seen.
 *
 * It is deliberately a suggestion and never a refusal. `prinicipal33.com` is not in here and
 * cannot be: it is a plausible domain, and the only thing that knows it has no mail server is
 * DNS. Refusing what this cannot verify would turn a typo into a lockout, which §205 forbids.
 */

/** Misspellings of the big providers. Every key is a string that is nobody's real domain. */
const DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.comm": "gmail.com",
  "yahoo.con": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.cm": "yahoo.com",
  "hotmail.con": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "iclould.com": "icloud.com",
  "icloud.con": "icloud.com",
  "yandex.con": "yandex.com",
};

/**
 * Endings that are not top-level domains at all, whatever the name in front of them.
 *
 * `.con` is the one that matters — it is `.com` with a slipped finger and it is not delegated,
 * so an address ending in it can never be delivered to anybody. The others are the same
 * mistake made differently.
 */
const TLD_TYPOS: Readonly<Record<string, string>> = {
  con: "com",
  cmo: "com",
  ocm: "com",
  comm: "com",
  vom: "com",
  xom: "com",
  rp: "ro",
  ri: "ro",
};

/**
 * The address the person probably meant, or `null` when there is nothing to suggest.
 *
 * Pure and case-preserving in the local part: `Ana.Pop@GMAIL.CON` suggests
 * `Ana.Pop@gmail.com`, because the name before the `@` is theirs to capitalise and the domain
 * is not.
 */
export function suggestEmail(address: string): string | null {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  // No domain to be wrong about. An address this malformed is the browser's problem, not ours.
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();

  const whole = DOMAIN_TYPOS[domain];
  if (whole) return `${local}@${whole}`;

  const lastDot = domain.lastIndexOf(".");
  if (lastDot > 0) {
    const tld = domain.slice(lastDot + 1);
    const fixed = TLD_TYPOS[tld];
    // Only when the correction changes something: `.com` is not a typo of `.com`.
    if (fixed && fixed !== tld) return `${local}@${domain.slice(0, lastDot)}.${fixed}`;
  }

  return null;
}
