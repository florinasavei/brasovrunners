/**
 * When registration is open for an event.
 *
 * Pure, and takes `now` as an argument rather than reading the clock. AGENTS.md §1.5 requires
 * that of every time-dependent rule: a function that calls `new Date()` internally cannot be
 * tested for the boundary cases that matter, and those boundaries are where this will be wrong.
 */

export type RegistrationMode = "NONE" | "INTERNAL" | "EXTERNAL";

export type RegistrationWindowInput = {
  registrationMode: RegistrationMode;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  /** Null while the date is to be announced (§NNN): a public read withholds it in SQL. */
  startsAt: Date | null;
  /**
   * The date is to be announced (§NNN). While true an internal registration is `NOT_YET_OPEN`
   * whatever the provisional date, the window and the clock say — a server read that holds the
   * provisional `startsAt` passes this; a public read passes `startsAt: null`, which says the same.
   */
  dateToBeAnnounced?: boolean;
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
  // A date still to be announced (§NNN) holds every registration at "soon", the club's own and the
  // organizer's form alike: nobody signs up for a day nobody has named. There is no day to count a
  // minimum age on and no start to close at, and a provisional date that passed must not close the
  // «Anunță-mă» list either.
  if (event.dateToBeAnnounced || event.startsAt === null) return "NOT_YET_OPEN";
  if (event.registrationMode === "EXTERNAL") return "EXTERNAL";

  // «Se deschid în curând» (§451): the organizer has announced the event and not the opening.
  // Nothing opens it but the organizer switching this off; no date is involved, so no clock can.
  // The close still closes it: a window that never opened is over once its closing has passed,
  // so an event that started while "soon" says closed, and its "Anunță-mă" list is dropped.
  if (event.registrationOpensSoon) return now >= (event.registrationClosesAt ?? event.startsAt) ? "CLOSED" : "NOT_YET_OPEN";

  // BR-REQ-011-01 criterion 4: absent opening means registration opens when the event is
  // published in this locale. An unpublished translation has no public page at all, so this
  // only matters for the brief window between publication and the event.
  const opensAt = event.registrationOpensAt ?? event.publishedAt;
  if (opensAt && now < opensAt) return "NOT_YET_OPEN";

  // BR-REQ-011-01 criterion 3: absent closing means the event start.
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  if (now >= closesAt) return "CLOSED";

  return "OPEN";
}

/**
 * The moment the entry list stops growing — and therefore the moment race numbers can settle
 * (`DECISIONS.md` §214).
 *
 * Deliberately *not* `registrationState(...) !== "OPEN"`. That is false for four other reasons
 * — a window that has not opened yet, a cancelled event, an external or absent registration —
 * and none of them means the list is final. The only question here is whether the closing
 * instant has passed, which is the same expression `registrationState` uses for `CLOSED`,
 * named once so the two cannot drift.
 */
export function registrationHasClosed(
  event: Pick<RegistrationWindowInput, "registrationClosesAt"> & { startsAt: Date },
  now: Date,
): boolean {
  return now >= registrationClosingInstant(event);
}

/**
 * The instant `registrationHasClosed` turns true: the close, or the start when there is none —
 * which is also when the race numbers settle and "here is your race number" goes (§214), as the
 * forecast on `/admin/emails` says it (§383).
 */
export function registrationClosingInstant(event: Pick<RegistrationWindowInput, "registrationClosesAt"> & { startsAt: Date }): Date {
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
  // «În curând» has no date to show, and neither has an event whose date is to be announced (§NNN).
  if (event.registrationOpensSoon || event.dateToBeAnnounced || event.startsAt === null) return null;
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
  return event.registrationClosesAt ?? event.startsAt;
}
