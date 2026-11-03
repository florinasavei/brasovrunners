import type { RegistrationCta } from "@/modules/events/domain/registration-cta";

/**
 * «Pe site acum» (§NNN; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»): what a visitor meets on
 * the event's page this minute, said on the registrations page under «Locuri» — read off the door the public card
 * draws (`registrationCta`, the one predicate), never a second copy of its rules.
 *
 * - `DIRECT` — the button «Înscrie-te»: the first to come takes a free place.
 * - `WAITLIST` — «Intră pe lista de așteptare»: everybody from the site joins the line (no free place, somebody
 *   already waiting, or «Locurile libere le dau doar eu»), with how many are in it and its limit (null: none).
 * - `CLOSED` — no button, and why: the dates (not open yet, or closed), the tick «Înscrieri publice deschise», the
 *   free places the organizers' alone with no line to join, the line full, no line at all, the event cancelled or
 *   over, or no registration on this site.
 */
export type PublicNowReason =
  | "NOT_YET_OPEN"
  | "WINDOW_CLOSED"
  | "SWITCH"
  | "OFFERS_ONLY"
  | "WAITLIST_FULL"
  | "NO_WAITLIST"
  | "CANCELLED"
  | "COMPLETED"
  | "NOT_HERE";

export type PublicNow =
  | { kind: "DIRECT" }
  | { kind: "WAITLIST"; waiting: number; limit: number | null }
  | { kind: "CLOSED"; reason: PublicNowReason };

/** Where in the event's editor the setting behind each answer lives — the fold's id, which opens on the fragment. */
export type PublicNowSetting = "box-registration-window" | "box-places-control" | "box-registration";

export function publicNow(cta: RegistrationCta, line: { waiting: number; waitlistCapacity: number | null }): PublicNow {
  switch (cta.kind) {
    case "OPEN":
      return cta.fromWaitlist ? { kind: "WAITLIST", waiting: line.waiting, limit: line.waitlistCapacity } : { kind: "DIRECT" };
    case "FULL":
      return { kind: "WAITLIST", waiting: line.waiting, limit: line.waitlistCapacity };
    case "WAITLIST_FULL":
      return { kind: "CLOSED", reason: "WAITLIST_FULL" };
    case "FULL_NO_WAITLIST":
      return { kind: "CLOSED", reason: "NO_WAITLIST" };
    case "PAUSED":
      return { kind: "CLOSED", reason: cta.reason === "SWITCH" ? "SWITCH" : "OFFERS_ONLY" };
    case "NOT_YET_OPEN":
      return { kind: "CLOSED", reason: "NOT_YET_OPEN" };
    case "CLOSED":
      return { kind: "CLOSED", reason: "WINDOW_CLOSED" };
    case "CANCELLED":
      return { kind: "CLOSED", reason: "CANCELLED" };
    case "COMPLETED":
      return { kind: "CLOSED", reason: "COMPLETED" };
    case "EXTERNAL":
    case "NONE":
      return { kind: "CLOSED", reason: "NOT_HERE" };
  }
}

/** The editor's fold that changes the answer: the window and its tick, or the places and the line. */
export function publicNowSetting(now: PublicNow): PublicNowSetting {
  if (now.kind === "CLOSED" && (now.reason === "SWITCH" || now.reason === "NOT_YET_OPEN" || now.reason === "WINDOW_CLOSED")) return "box-registration-window";
  if (now.kind === "CLOSED" && (now.reason === "CANCELLED" || now.reason === "COMPLETED" || now.reason === "NOT_HERE")) return "box-registration";
  return "box-places-control";
}
