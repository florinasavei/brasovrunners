/**
 * When the club's domain expires, and how loudly to say so (§NNN).
 *
 * The owner, 2026-09-26: the `.ro` is dropped (search engines would see two addresses for one
 * site), the `.com` stays, and "we must remember to renew it for several years". Nothing the
 * software can ask tells it when a domain expires — a registrar's answer is WHOIS, which is not
 * an API anybody should depend on — so the two facts are configuration, read from the
 * environment: the day the domain was registered, and how many years have been paid from that
 * day in total. Their sum is the expiry, and the rest is arithmetic.
 *
 * Pure, over the two values and the clock, so the thresholds are tested without a deployment:
 * more than ninety days left is fine; ninety or fewer is amber on `/admin/tasks`; thirty or
 * fewer is red there and `degraded` on `/api/health`, whose 503 is the monitors' alarm (§98) —
 * a lapsed domain takes the site, the email links and the sending domain down together.
 */

import { CLUB_TIME_ZONE } from "@/i18n/dates";

/** Amber from here: time enough to renew at leisure, not enough to forget it again. */
export const DOMAIN_RENEWAL_AMBER_DAYS = 90;
/** Red on the board and a 503 on `/api/health` from here: renew this week. */
export const DOMAIN_RENEWAL_RED_DAYS = 30;

export type DomainRenewal =
  /** `DOMAIN_REGISTERED_ON` is unset: nothing to count from, and the board says so. */
  | { status: "unknown" }
  | {
      /** `ok` over 90 days; `soon` 90 to 31; `urgent` 30 to 0; `expired` past the day. */
      status: "ok" | "soon" | "urgent" | "expired";
      /** The expiry day, `YYYY-MM-DD` — a calendar day at the registrar, not an instant. */
      expiresOn: string;
      /** Whole days from today (in the club's zone) to the expiry day; negative once past. */
      daysLeft: number;
    };

const DAY_MS = 86_400_000;

/** Today's calendar day in the club's zone, `YYYY-MM-DD` (`en-CA` formats it that way). */
function clubToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The registration day plus the years paid. A domain registered on 29 February renews on
 * 28 February in a common year, which is what registrars do; `Date.UTC` would roll it to
 * 1 March, so the day is clamped to the month's last.
 */
export function domainExpiresOn(registeredOn: string, years: number): string {
  const [year, month, day] = registeredOn.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const expiry = new Date(Date.UTC(targetYear, month - 1, Math.min(day, lastDay)));
  return expiry.toISOString().slice(0, 10);
}

export function domainRenewal(registeredOn: string | undefined, years: number, now: Date): DomainRenewal {
  if (!registeredOn) return { status: "unknown" };
  const expiresOn = domainExpiresOn(registeredOn, years);
  const daysLeft = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${clubToday(now)}T00:00:00Z`)) / DAY_MS);
  const status =
    daysLeft < 0
      ? "expired"
      : daysLeft <= DOMAIN_RENEWAL_RED_DAYS
        ? "urgent"
        : daysLeft <= DOMAIN_RENEWAL_AMBER_DAYS
          ? "soon"
          : "ok";
  return { status, expiresOn, daysLeft };
}
