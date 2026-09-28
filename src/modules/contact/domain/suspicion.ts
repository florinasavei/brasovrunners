import type { TurnstileVerdict } from "@/modules/registrations/turnstile";

/**
 * Does a contact message that passed every gate still look automated? (BR-REQ-070-04, §310.)
 *
 * A script posts no token (`unavailable` passes, §216), an empty trap and a late post (§217), so
 * the message is marked "[posibil spam]" and delivered, never refused. Pure. Two reasons mark it:
 * the challenge was on and no token came (a token Cloudflare could not verify is not one), or the
 * sender's domain holds the club's name without being the club's domain or a subdomain of it.
 * Everything else is a footer signal only. Never an IP address (`AGENTS.md` §19.4).
 */

export type SuspicionReason =
  /** The club's challenge was on and the post carried no token at all: the widget never ran. */
  | { kind: "no-token" }
  /** Cloudflare rejected the token; the action normally refuses this first (§216). */
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
  linkCount: number;
  /** Distinct hosts in order of appearance, at most `MAX_LINK_HOSTS`. */
  linkHosts: string[];
  linkHostCount: number;
  /** The trap lets through only autofill of the sender's own address (§282). */
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
  tokenPresent: boolean;
  turnstileVerdict: TurnstileVerdict;
  /** Milliseconds from the page's render to the post; `null` when there was nothing to time. */
  elapsedMs: number | null;
  senderEmail: string;
  message: string;
  honeypot?: string;
  /** This deployment's hostname, from `APP_BASE_URL` (`AGENTS.md` §8); `null` turns the imitation rule off. */
  clubHost: string | null;
};

/** Enough hosts to recognise a campaign, few enough to stay one line. */
export const MAX_LINK_HOSTS = 5;

/** A shorter label (`co`, `qa`) matches too many strangers; the rule is then off. */
const MIN_LABEL_LENGTH = 4;

/** Shared hosting domains: their last two labels are the provider's, not the club's. */
const SHARED_HOSTING_DOMAINS = ["vercel.app"];

export type ClubIdentity = {
  /** The host's last two labels. */
  domain: string;
  /** The label before the ending, hyphens dropped — the name an imitation borrows. */
  label: string;
};

/**
 * `null` for localhost, an IP, a bare name, a shared hosting domain or a short label. No
 * public-suffix list on purpose: a `co.uk`-shaped host switches the rule off.
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

function domainOf(email: string): string {
  return email
    .slice(email.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

/** The club's domain and its subdomains are the club; any other domain holding the label (hyphens ignored) imitates it. */
export function imitatesClub(senderDomain: string, club: ClubIdentity): boolean {
  if (senderDomain === club.domain || senderDomain.endsWith(`.${club.domain}`)) return false;
  return senderDomain.replace(/-/g, "").includes(club.label);
}

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
