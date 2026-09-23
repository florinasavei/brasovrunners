import type { TurnstileVerdict } from "@/modules/registrations/turnstile";

/**
 * Does a contact message that got past every gate still look like a program's? (BR-REQ-070-04;
 * the owner, 2026-09-23: "la cel de contact cred ca imi mai trebuie ceva captcha pt ca primesc
 * spam cu SEO stuff".)
 *
 * **Why this exists instead of a stricter gate.** The SEO spam arrived through the production
 * form with every defence switched on, and it was supposed to: a plain HTTP script never runs
 * the widget, so it posts no token, and no token is `unavailable`, which passes (§216) — a
 * person with JavaScript off, a blocked script or a Cloudflare outage posts exactly the same
 * nothing, and §205 says that person must reach the club. The script leaves the hidden field
 * empty and posts well after the one-second floor (§217). All three gates pass by design, and a
 * fourth captcha would pass the same way. So the answer is not to refuse: it is to **mark** —
 * the message is delivered, its subject says "[posibil spam]", and the club filters on that.
 *
 * Pure: no database, no environment, no clock. Two reasons make a message suspicious, each one
 * a thing a person can check by reading the footer:
 *
 * - **The challenge was on and no token came with the post.** Not "Cloudflare did not answer":
 *   a token that was sent and could not be verified is a Cloudflare bad day, and a bad day must
 *   not mark every message. That stays an ordinary pass with a signal of its own.
 * - **The sender's domain imitates the club's**: it contains the club's name — the label before
 *   the club's own domain ending, from `APP_BASE_URL` — and it is neither the club's domain nor
 *   a subdomain of it. `search-club.example`, `club-seo.com`, `clubexample.net`,
 *   `club.example.lookalike.net` imitate; `club.example` and `mail.club.example` are the club.
 *
 * Everything else is a **signal**: printed in the footer so the club can judge, never on its own
 * a reason. And never an IP address, as a key or a value (`AGENTS.md` §19.4): nothing here is
 * given one.
 */

export type SuspicionReason =
  /** The club's challenge was on and the post carried no token at all: the widget never ran. */
  | { kind: "no-token" }
  /**
   * A token Cloudflare looked at and rejected. The action refuses that as a field error before
   * the service is reached (§216); it is a reason here so a caller that did not is still told.
   */
  | { kind: "token-rejected" }
  /** The sender's address is at a domain that borrows the club's name without being the club's. */
  | { kind: "imitates-club"; senderDomain: string };

/** What the anti-bot challenge said, as the footer reports it. */
export type BotCheckSignal =
  /** Switched off in the backoffice, or its keys are not on this deployment: nothing was asked. */
  | "off"
  | "passed"
  /** On, and the post had no token — the first reason above. */
  | "no-token"
  /** A token was sent and Cloudflare did not answer (a timeout, a 5xx): a pass, not a reason. */
  | "no-answer"
  | "rejected";

export type ContactSignals = {
  botCheck: BotCheckSignal;
  /** Whole seconds from the page's render to the post; `null` when no readable render time came with it (§217). */
  elapsedSeconds: number | null;
  /** How many links the message holds — written with `http://`, `https://` or `www.`. */
  linkCount: number;
  /** Their hosts, each once, in the order they appear, at most `MAX_LINK_HOSTS`. */
  linkHosts: string[];
  /** How many distinct hosts there were in all, so the footer can say the list was cut. */
  linkHostCount: number;
  /**
   * The hidden field. Empty on nearly everything that gets this far; the one filled value the
   * trap lets through is a browser's autofill of the sender's own address (§282), and anything
   * else is reported as it is rather than assumed away.
   */
  honeypot: "empty" | "sender-address" | "filled";
};

export type ContactSuspicion = {
  suspicious: boolean;
  reasons: SuspicionReason[];
  signals: ContactSignals;
};

export type ContactSuspicionInput = {
  /** The club's switch is on *and* both Turnstile keys are on this deployment (§97, §254). */
  botCheckOn: boolean;
  /** A token came with the post, whatever Cloudflare then said about it. */
  tokenPresent: boolean;
  turnstileVerdict: TurnstileVerdict;
  /** Milliseconds from the page's render to the post; `null` when there was nothing to time. */
  elapsedMs: number | null;
  senderEmail: string;
  message: string;
  /** What the hidden field held, if anything. */
  honeypot?: string;
  /** This deployment's hostname, from `APP_BASE_URL` (`AGENTS.md` §8); `null` turns the imitation rule off. */
  clubHost: string | null;
};

/** Enough hosts to recognise a campaign, few enough to stay one line. */
export const MAX_LINK_HOSTS = 5;

/**
 * Shorter than this, the club's label matches too many strangers' domains to mean anything:
 * `co` of a `co.uk` host, `qa`, a three-letter name. The rule is then off, never "everything".
 */
const MIN_LABEL_LENGTH = 4;

/**
 * Hosting providers' shared domains, where the last two labels are the provider's and not the
 * club's — a preview deployment on one would otherwise call every sender at the provider "the
 * club" and hunt for the provider's name in everybody else's.
 */
const SHARED_HOSTING_DOMAINS = ["vercel.app"];

export type ClubIdentity = {
  /** The club's own domain: the host's last two labels, as `/admin/tasks` reads its apex. */
  domain: string;
  /** The label before the ending, hyphens dropped — the name an imitation borrows. */
  label: string;
};

/**
 * The club's domain and name from this deployment's hostname, or `null` when there is nothing
 * worth matching: `localhost`, an IP address, a bare name, a provider's shared domain, or a
 * label too short to be a name. Deliberately the last two labels and no public-suffix list —
 * the club is on a `.com` and will be on a `.ro`, and a `co.uk`-shaped host switches the rule
 * off rather than matching every "co".
 */
export function clubIdentity(host: string | null | undefined): ClubIdentity | null {
  const hostname = (host ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!hostname.includes(".")) return null;
  // IPv4 as digits and dots; IPv6 as URL's bracketed form (or bare, with colons).
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":") || hostname.startsWith("[")) return null;
  const labels = hostname.split(".");
  const domain = labels.slice(-2).join(".");
  if (SHARED_HOSTING_DOMAINS.includes(domain)) return null;
  const label = (labels.at(-2) ?? "").replace(/-/g, "");
  if (label.length < MIN_LABEL_LENGTH) return null;
  return { domain, label };
}

/** The part after the last `@`, lowercased, without a trailing dot. */
function domainOf(email: string): string {
  return email
    .slice(email.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

/**
 * Does this domain borrow the club's name without being the club's? The club's own domain and
 * every subdomain of it are the club; anything else holding the name — hyphens ignored, so
 * `club-example.net` counts as well as `clubexample.net` — is an imitation.
 */
export function imitatesClub(senderDomain: string, club: ClubIdentity): boolean {
  if (senderDomain === club.domain || senderDomain.endsWith(`.${club.domain}`)) return false;
  return senderDomain.replace(/-/g, "").includes(club.label);
}

/** `http://`, `https://` or `www.`, up to whitespace or a character that ends a link in prose. */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+/gi;

function linksIn(message: string): Pick<ContactSignals, "linkCount" | "linkHosts" | "linkHostCount"> {
  const hosts: string[] = [];
  let linkCount = 0;
  for (const raw of message.match(LINK) ?? []) {
    // A sentence's full stop or comma is not part of the address it follows.
    const link = raw.replace(/[.,;:!?]+$/, "");
    let host: string;
    try {
      host = new URL(/^www\./i.test(link) ? `http://${link}` : link).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host) continue;
    linkCount += 1;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { linkCount, linkHosts: hosts.slice(0, MAX_LINK_HOSTS), linkHostCount: hosts.length };
}

function botCheckSignal(input: ContactSuspicionInput): BotCheckSignal {
  if (!input.botCheckOn || input.turnstileVerdict === "not_configured") return "off";
  if (!input.tokenPresent) return "no-token";
  if (input.turnstileVerdict === "passed") return "passed";
  if (input.turnstileVerdict === "failed") return "rejected";
  return "no-answer";
}

function honeypotSignal(honeypot: string | undefined, senderEmail: string): ContactSignals["honeypot"] {
  const trap = (honeypot ?? "").trim().toLowerCase();
  if (trap === "") return "empty";
  return trap === senderEmail.trim().toLowerCase() ? "sender-address" : "filled";
}

export function contactSuspicion(input: ContactSuspicionInput): ContactSuspicion {
  const botCheck = botCheckSignal(input);
  const reasons: SuspicionReason[] = [];
  if (botCheck === "no-token") reasons.push({ kind: "no-token" });
  if (botCheck === "rejected") reasons.push({ kind: "token-rejected" });

  const club = clubIdentity(input.clubHost);
  const senderDomain = domainOf(input.senderEmail);
  if (club && senderDomain !== "" && imitatesClub(senderDomain, club)) {
    reasons.push({ kind: "imitates-club", senderDomain });
  }

  const elapsedSeconds =
    input.elapsedMs === null || !Number.isFinite(input.elapsedMs) ? null : Math.max(0, Math.round(input.elapsedMs / 1000));

  return {
    suspicious: reasons.length > 0,
    reasons,
    signals: {
      botCheck,
      elapsedSeconds,
      ...linksIn(input.message),
      honeypot: honeypotSignal(input.honeypot, input.senderEmail),
    },
  };
}
