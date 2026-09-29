/**
 * When registration is open for an event.
 *
 * Pure, and takes `now` as an argument rather than reading the clock. AGENTS.md §1.5 requires
 * that of every time-dependent rule: a function that calls `new Date()` internally cannot be
 * tested for the boundary cases that matter, and those boundaries are where this will be wrong.
 */

import { startHeldBack } from "./dated";

export type RegistrationMode = "NONE" | "INTERNAL" | "EXTERNAL";

export type RegistrationWindowInput = {
  registrationMode: RegistrationMode;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  /** Null while the date is to be announced (§533): a public read withholds it in SQL. */
  startsAt: Date | null;
  /**
   * The date is to be announced (§533). While true an internal registration is `NOT_YET_OPEN`
   * whatever the provisional date, the window and the clock say — a server read that holds the
   * provisional `startsAt` passes this; a public read passes `startsAt: null`, which says the same.
   */
  dateToBeAnnounced?: boolean;
  /** Only the time is to be announced (§533): the same answer as the date's switch. */
  timeToBeAnnounced?: boolean;
  registrationOpensAt: Date | null;
  /**
   * «Înscrierile se deschid în curând» (§451): announced with no date. While true an internal
   * registration is `NOT_YET_OPEN` whatever `registrationOpensAt` and the clock say.
   */
  registrationOpensSoon: boolean;
  /** BR-REQ-011-01 criterion 3: absent means registration closes when the event starts. */
  registrationClosesAt: Date | null;
  /** The moment this locale's translation was published, or null while it is a draft. */
  publishedAt: Date | null;
};

export type RegistrationState =
  | "NOT_APPLICABLE"
  | "EXTERNAL"
  | "NOT_YET_OPEN"
  | "OPEN"
  | "CLOSED"
  | "EVENT_CANCELLED"
  | "EVENT_COMPLETED";

export function registrationState(event: RegistrationWindowInput, now: Date): RegistrationState {
  // A cancelled or completed event never accepts registration, whatever the window says
  // (AGENTS.md §10.1, BR-REQ-020-01 criterion 3). Checked first so a cancelled event does not
  // advertise an open window.
  if (event.eventStatus === "COMPLETED") return "EVENT_COMPLETED";
  if (event.eventStatus !== "SCHEDULED") return "EVENT_CANCELLED";

  if (event.registrationMode === "NONE") return "NOT_APPLICABLE";
  // A date still to be announced (§533) holds every registration at "soon", the club's own and the
  // organizer's form alike: nobody signs up for a day nobody has named. There is no day to count a
  // minimum age on and no start to close at, and a provisional date that passed must not close the
  // «Anunță-mă» list either.
  if (startHeldBack(event) || event.startsAt === null) return "NOT_YET_OPEN";
  if (event.registrationMode === "EXTERNAL") return "EXTERNAL";

  // «Se deschid în curând» (§451): the organizer has announced the event and not the opening.
  // Nothing opens it but the organizer switching this off; no date is involved, so no clock can.
  // The close still closes it: a window that never opened is over once its closing has passed,
  // so an event that started while "soon" says closed, and its "Anunță-mă" list is dropped.
  if (event.registrationOpensSoon) return now >= registrationClosesOrStarts({ ...event, startsAt: event.startsAt }) ? "CLOSED" : "NOT_YET_OPEN";

  // BR-REQ-011-01 criterion 4: absent opening means registration opens when the event is
  // published in this locale. An unpublished translation has no public page at all, so this
  // only matters for the brief window between publication and the event.
  const opensAt = event.registrationOpensAt ?? event.publishedAt;
  if (opensAt && now < opensAt) return "NOT_YET_OPEN";

  // BR-REQ-011-01 criterion 3: absent closing means the event start.
  if (now >= registrationClosesOrStarts({ ...event, startsAt: event.startsAt })) return "CLOSED";

  return "OPEN";
}

/**
 * The instant the registration window closes, whatever state it is in now: the stated closing, or
 * the event's start when none is stated (BR-REQ-011-01 criterion 3). `registrationState` turns
 * `CLOSED` here and `openRegistrationClosing` names it, both through this one expression; the page
 * clock (`page-clock.ts`) keeps a static page no longer than this instant, open, «în curând» (§451)
 * or not yet open alike, since each of them reads differently once it has passed.
 */
export function registrationClosesOrStarts(event: Pick<RegistrationWindowInput, "registrationClosesAt"> & { startsAt: Date }): Date {
  return event.registrationClosesAt ?? event.startsAt;
}

/**
 * When registration opens, while that is still ahead (§146): the date the hero and the card
 * show, and the one the "tell me" box waits for (the calendar reads the window through
 * `calendarRegistration`, §159). Null once the window has opened, and for every event that
 * has no window to open — and for one that opens "soon" (§451), which has no date to show
 * (`registrationCta` says that one as `opensAt: null`).
 */
export function upcomingRegistrationOpening(event: RegistrationWindowInput, now: Date): Date | null {
  if (registrationState(event, now) !== "NOT_YET_OPEN") return null;
  // «În curând» has no date to show, and neither has an event whose date is to be announced (§533).
  if (event.registrationOpensSoon || startHeldBack(event) || event.startsAt === null) return null;
  return event.registrationOpensAt ?? event.publishedAt;
}

/**
 * Until when an open registration stays open (`DECISIONS.md` §308): the instant
 * `registrationState` turns `CLOSED` — the stated closing, or the event's start when none is
 * stated (BR-REQ-011-01 criterion 3) — while the state is `OPEN`, and null otherwise. The
 * listing card says it ("Înscrieri deschise până pe 14 nov., 23:59"); the owner: "I also need
 * to show when registrations are closing on the event card". Read through the same expression
 * `registrationState` uses, so the date on the card and the moment the button goes away can
 * never disagree.
 */
export function openRegistrationClosing(event: RegistrationWindowInput, now: Date): Date | null {
  if (registrationState(event, now) !== "OPEN" || event.startsAt === null) return null;
  return registrationClosesOrStarts({ ...event, startsAt: event.startsAt });
}
