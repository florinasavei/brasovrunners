import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import { costUrlHost } from "@/modules/events/domain/cost";
import type { PublicEventPage } from "@/modules/events/repository";
import { dayIn, effectiveMinimumAge, latestBirthDateFor } from "./domain/age";
import { confirmationWindow } from "./domain/hold-deadlines";

/** The anchor a field is reached by from the error summary. Prefixed so it cannot collide. */
export const fieldId = (name: string) => `f-${name}`;

/** The form's own id, so the refusal's button can submit it from outside (§282). */
export const REGISTRATION_FORM_ID = "registration-form";

/**
 * The columns of an event the registration form reads — no more. The public page's read
 * (`findPublishedEventBySlug`) and the editor's draft (`preview-view.ts#previewPageOf`, §579) both
 * carry them, so one form is drawn from either. Dated: a form is only drawn for an announced start
 * (§533).
 */
export type RegistrationFormEvent = Pick<
  PublicEventPage,
  | "id"
  | "title"
  | "timezone"
  | "locationToBeAnnounced"
  | "locationName"
  | "costType"
  | "costAmount"
  | "costUrl"
  | "rulesJson"
  | "kitShirt"
  | "askHealthNote"
  | "minAge"
  | "participantListVisibility"
  | "waitlistPublic"
  | "confirmationOpensDaysBefore"
  | "confirmationDeadlineDaysBefore"
  | "reminderHoursBefore"
> &
  Partial<Pick<PublicEventPage, "offersMemberBib">> & { startsAt: Date };

/**
 * Which boxes the form draws for this event, and the bounds its boxes enforce — everything the
 * form takes from the event's own settings, computed in one place.
 */
export type RegistrationFormView = {
  event: RegistrationFormEvent;
  /** The event's minimum age (§329), never under fourteen (§515). */
  minAge: number;
  /** The race's own day in its own zone: the birth date's echo counts the age on it (§467). */
  eventDay: string;
  /** The birth date's bounds: 120 years back, and the latest date that still reaches `minAge` (§321). */
  birthDate: { earliest: string; latest: string };
  /** The event wrote rules of its own (§195): the read-and-tick panel, else a plain box linking its page. */
  hasRules: boolean;
  /** «Kit de participare» → «Tricou» (§554): the size is asked only when the event gives a shirt. */
  askShirt: boolean;
  /** «Informații medicale» (§557): the health note's fold only when the event asks it. */
  askHealth: boolean;
  /** The members' race number (§NNN): «Vreau numărul de membru» under the member tick, only when offered. */
  askMemberBib: boolean;
  /** The event publishes a start list (§143): the «Vreau să apar» tick is asked. */
  publishesList: boolean;
  /**
   * The published list may also draw the waiting list (§628, «Lista de așteptare e publică»): the
   * tick's caption names the «Pe lista de așteptare» stage only then (`listOptInStatesKey`).
   */
  listShowsWaitlist: boolean;
  /** The host a runner recognises in the cost's link (§343), or null. */
  costHost: string | null;
  /** The participation window's days while it is still ahead (§104), for the five steps. */
  stepsWindow: { opensDays: number; deadlineDays: number } | null;
};

/**
 * **One reading of what the form asks (§579's amendment: the form in the preview).** The register
 * page calls it with the published event; the editor's «Previzualizare» with the unsaved draft. Pure:
 * the event's columns and the clock, nothing read.
 */
export function formViewOf(event: RegistrationFormEvent, now: Date): RegistrationFormView {
  const minAge = effectiveMinimumAge(event.minAge);
  const eventDay = dayIn(event.startsAt, event.timezone);
  /*
    BR-REQ-031-04 criterion 4 and the minimum age (§321), expressed where the browser can enforce
    them too. The upper bound is the latest birth date that still reaches this event's own
    minimum (`events.min_age`, §329) on the race's own day in the race's own zone — computed here,
    for this event, from the arithmetic the server refuses with — so the picker never offers a
    date the submission would be turned back for. Today stays a bound as well, for the event
    absurdly far ahead that would allow a future date.
  */
  const today = now.toISOString().slice(0, 10);
  const youngestAllowed = latestBirthDateFor(minAge, eventDay);
  const latest = youngestAllowed < today ? youngestAllowed : today;
  const earliest = new Date(Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  // The third step of the wizard (§104): "confirm a week before" only while that week is ahead.
  const window = confirmationWindow(event);
  const stepsWindow =
    window && window.opensAt.getTime() > now.getTime()
      ? { opensDays: event.confirmationOpensDaysBefore, deadlineDays: event.confirmationDeadlineDaysBefore }
      : null;
  return {
    event,
    minAge,
    eventDay,
    birthDate: { earliest, latest },
    hasRules: !isRichTextEmpty(readRichText(event.rulesJson)),
    // A copy saved before the column existed has none, and asks nothing.
    askShirt: event.kitShirt === true,
    askHealth: event.askHealthNote === true,
    askMemberBib: event.offersMemberBib === true,
    publishesList: event.participantListVisibility === "NAMES",
    listShowsWaitlist: event.participantListVisibility === "NAMES" && event.waitlistPublic === true,
    costHost: event.costUrl ? costUrlHost(event.costUrl) : null,
    stepsWindow,
  };
}

/**
 * The caption under «Vreau să apar» while the privacy notice describes the states (§396): which of
 * the two sentences (§628). The form never promises a stage the list will not print, so an event whose
 * waiting list is not public says «Înscris, în așteptarea confirmării» and «Confirmat» only.
 */
export function listOptInStatesKey(view: Pick<RegistrationFormView, "listShowsWaitlist">): "listOptInStates" | "listOptInStatesNoWaitlist" {
  return view.listShowsWaitlist ? "listOptInStates" : "listOptInStatesNoWaitlist";
}
