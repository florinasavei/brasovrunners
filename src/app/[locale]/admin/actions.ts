"use server";

import { cookies } from "next/headers";
import { eventListBack } from "@/modules/content/events/list-query";
import { redirect } from "next/navigation";
import { flashOutcome } from "@/shared/feedback/flash";
import { signOut } from "@/auth";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import {
  createEventAndPublish,
  deleteEvent,
  duplicateEvent,
  hardDeleteEvent,
  publishEvent,
  repeatEvent,
  saveEventAndTranslations,
  SERIES_EDIT_SCOPES,
  type SeriesEditScope,
  setRepeatPublish,
  stopRepeat,
  transitionEvent,
} from "@/modules/content/events/service";
import { eventFormFieldName, PLACE_NAMES_AS_TYPED_FIELD, THEN_FIELD, THEN_PUBLISH } from "@/modules/content/events/form-names";
import { joinDuration } from "@/modules/content/events/duration";
import { raceStartWallTime } from "@/modules/content/events/race-start";
import { type DraftPreview, renderEventDraftPreview } from "@/modules/content/events/draft-preview";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { REPEAT_CADENCES, type RepeatCadence, type Weekday, WEEKDAYS } from "@/modules/events/domain/repeat";
import { nightOverrideFromChoice } from "@/modules/events/domain/night";
import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import {
  addTestRegistrations,
  removeTestRegistrations,
} from "@/modules/registrations/test-registrations";
import { waitlistRefusalCode } from "@/modules/registrations/domain/waitlist";
import {
  assertDevStaffSwitcherEnabled,
  type DevIdentityKey,
  ensureDevStaffUser,
} from "@/modules/staff-identity/dev-switcher";
import { landingFor, signInTargetOf } from "@/modules/staff-identity/domain/landing";
import { MEMBER_ROWS_MAX, parseMemberRows } from "@/modules/staff-identity/domain/member-rows";
import { findStaffUsersAmong } from "@/modules/staff-identity/repository";
import { recordAuditEvent } from "@/modules/audit/repository";
import { countAccountLines, createMemberAccounts, type MemberAccountLine } from "@/modules/staff-identity/member-accounts";
import { invalidAddresses } from "@/modules/contact/domain/recipients";
import { canDeleteEvent, canHardDeleteEvent, canManageRegistrations, canManageStaff, canManageTestRegistrations, type EditorialStatus, isBackofficeRole, STAFF_PERMISSIONS, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { sendEventThanks } from "@/modules/notifications/event-mail";
import { BULK_RESEND_CLOSED, BULK_RESEND_LIMITED, resendDeclarationToAllPending } from "@/modules/registrations/admin-service";
import { DELIVERY_CHOICE_FIELD, deliveryChoiceOf } from "@/modules/notifications/domain/send-at-once";
import { sendNowRefusalCode } from "@/modules/notifications/send-at-once";
import { DEV_STAFF_COOKIE, requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import {
  inviteZitadelUser,
  resendZitadelInvite,
  sendZitadelPasswordReset,
  setZitadelUserActive,
} from "@/modules/staff-identity/zitadel-users";
import {
  assertMayManageAccount,
  changeStaffRole,
  inviteMembers,
  inviteStaffUser,
  resendStaffInvitation,
  revokeStaffUser,
  setStaffPermission,
} from "@/modules/staff-identity/service";
import { env } from "@/shared/config/env";
import { readBibDesignForm } from "@/modules/registrations/bib-design-query";
import { assignBibNumbers, reserveSpareBibs } from "@/modules/registrations/bibs";
import { hiddenListRefusalOf, SPARES_BEFORE_HIDDEN_LIST } from "@/modules/registrations/domain/hidden-list";
import { formatCalendarDay } from "@/i18n/dates";
import { withdrawInterest } from "@/modules/registrations/interest";
import { eraseGroupRunDeclaration, eraseGroupRunDeclarations, setGroupRunDeclarationHold } from "@/modules/group-run-declarations/service";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";

/**
 * Server Actions for the backoffice.
 *
 * Every one of them starts by asking the session who is making the request and ends by asking
 * a service whether that person may. Nothing here trusts a hidden field for identity, and
 * nothing relies on the page having checked already: BR-REQ-060-01 criterion 4 asks for
 * authorization at the server for each guarded operation, and an action reached by a replayed
 * POST never went past the page at all.
 *
 * Failures come back as an error code in the query string rather than as an exception page.
 * The code is language-neutral (AGENTS.md §14.3) and the backoffice translates it, so no SQL,
 * no stack and no internal message reaches the browser.
 *
 * **A form that carries what somebody typed answers a refusal differently** (`DECISIONS.md`
 * §315): the actions behind `ActionForm` — the event's create and save, its repeat rule, adding a
 * colleague, erasing an event, the thank-you's link, "Anunță-mă" withdrawal, the test rows'
 * count — take `useActionState`'s two arguments and *return* the refusal
 * (`shared/forms/outcome.ts#refused`) instead of redirecting, so every box comes back filled.
 * A success still redirects exactly where it always did. The forms here still answered with a
 * redirect are the ones with nothing typed in them: a button and hidden fields.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Where the browser goes next, with either a success flag or an error code. `toast` is the
 * outcome the toast reads when it must differ from the page's banner (`inviteStaffAction`).
 */
async function backTo(path: string, outcome: Record<string, string | undefined>, toast: Record<string, string | undefined> = outcome): Promise<never> {
  await flashOutcome(toast);
  const query = new URLSearchParams(
    Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][],
  ).toString();
  // `#admin-alert` so the browser lands on the outcome rather than at the top of a long page,
  // where a one-line alert about a save that failed is easy to walk straight past. Every
  // backoffice page gives that id to its alert region; it costs no JavaScript.
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}#admin-alert` : path);
}

/** The events list as the form was posted from it — its search, state, order and page (§527). */
function eventListPath(form: FormData, locale: Locale): string {
  const back = eventListBack(text(form, "back"));
  const path = getPathname({ locale, href: "/admin" });
  return back ? `${path}?${back}` : path;
}

function outcomeOf(error: unknown): { error: string } {
  // A domain error is an expected answer — forbidden, stale, invalid — and its code is what
  // the interface shows. Anything else is a bug, and is left to Next's error boundary rather
  // than being flattened into a friendly message that hides it.
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

function editorPath(locale: Locale, eventId: string): string {
  return getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } });
}

/**
 * The boxes a refusal of the event form names, as the form posts them (`form-names.ts`). The
 * minimum age is one box, `event.minAge` in «Regulamentul», for every type since §505 — a group
 * run's own box in «Traseul» (§440, §495) is gone, so no type needs its own name any more.
 */
const eventFormFieldNames = (error: DomainError) => error.fields.map((field) => eventFormFieldName(field));

/**
 * A refused «Numerele listei ascunse încep de la» (§647) as its own sentence rather than «Verifică
 * datele introduse»: inside the race's series or on the desk's spares, naming the box — and the date,
 * in the reader's language, when another date of the series refused it (a scoped save). Nothing for any
 * other error, so the caller's outcome stands. The editor's save and create, the repeat panel and the
 * events list's duplicate all read it.
 */
function hiddenListOutcome(error: unknown, locale: Locale): { error: string; errorValues?: Record<string, string> } | null {
  const refusal = hiddenListRefusalOf(error);
  if (!refusal) return null;
  if (refusal.date === null) return { error: refusal.code };
  return { error: refusal.code, errorValues: { date: formatCalendarDay(refusal.date, { locale, position: "inline" }) } };
}

/**
 * «Lista ascunsă» (§647): the event's switch, the hidden list's first number and «Numără și lista
 * ascunsă» — one marker for the three (`StartListBox`), so a form without the group, the create form
 * or a fixture, edits none of them. «Arată public numărătoarea» is not in the group — it acts on every
 * event — and carries its own marker, read beside «Arată public câți așteaptă».
 */
function hiddenListFrom(form: FormData, value: (field: string) => string) {
  if (form.get("event.hiddenList.present") !== "1") return {};
  return {
    hiddenListEnabled: form.get("event.hiddenListEnabled") === "on",
    hiddenListBibStart: value("hiddenListBibStart"),
    hiddenListCounted: form.get("event.hiddenListCounted") === "on",
  };
}

/**
 * The whole event row as the form sends it — one reader, so the create form and the edit form
 * cannot drift apart in what they post. Every value stays a string here; `fields.ts` is what
 * turns "" into "not stated" and refuses the rest.
 *
 * The names are namespaced `event.*` because the editor is one form carrying the event row and
 * both languages together (the editor's boxes, `ui/boxes/`, and `ui/TranslationFields.tsx`).
 */
function eventFieldsFrom(form: FormData) {
  const value = (field: string) => text(form, `event.${field}`);
  /**
   * A date field and a 24-hour time field, joined into the wall-clock string the service has
   * always read (`WallTimeField`, `DECISIONS.md` §70). A date with no time is midnight; no
   * date is no value, whatever the time field says. The single `<field>WallTime` name is still
   * accepted for anything that posts the old shape.
   */
  const wallTime = (field: string) => {
    const single = value(`${field}WallTime`);
    if (single) return single;
    const date = value(`${field}Date`);
    if (!date) return "";
    return `${date}T${value(`${field}Time`) || "00:00"}`;
  };
  /*
    The event's own start, whose halves may each be left empty while it is to be announced (§545,
    amending §533): posted as they are — the whole value, the date alone, `THH:mm` for an hour alone,
    or "" — never with midnight for an empty hour, which would store a time nobody typed. The service
    decides what the switches excuse (`start.ts#resolveStart`).
  */
  const startWallTime = () => {
    const single = value("startsAtWallTime");
    if (single) return single;
    const date = value("startsAtDate");
    const time = value("startsAtTime");
    if (date && time) return `${date}T${time}`;
    return date || (time ? `T${time}` : "");
  };

  /**
   * The programme's rows (§117), posted as `event.schedule[i].<box>` by `ScheduleRowsEditor`;
   * gathered by index in the order the boxes came, blanks included — the service drops those.
   */
  const scheduleRows: Array<Record<string, string>> = [];
  for (const [key, entry] of form.entries()) {
    const match = /^event\.schedule\[(\d+)\]\.(date|time|endTime|ro|en|place)$/.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    scheduleRows[index] = { ...(scheduleRows[index] ?? {}), [match[2]]: entry };
  }

  /**
   * The partners (§168) and their links (§344), posted as `event.coHosts[p].name`,
   * `event.coHosts[p].descriptionRo` / `.descriptionEn` (§352) and
   * `event.coHosts[p].links[l].<box>` by `CoHostRowsEditor` — gathered by both indices, blanks
   * included; `fields.ts` drops the spare card and the spare link row, and refuses a card with
   * a link and no name, a link with no address, or a text in one language only, naming both
   * indices.
   */
  const coHosts: Array<{ name?: string; descriptionRo?: string; descriptionEn?: string; links: Array<Record<string, string>> }> = [];
  for (const [key, entry] of form.entries()) {
    if (typeof entry !== "string") continue;
    // The card's own boxes: its name, and what the partnership is in each language (§352).
    const cardMatch = /^event\.coHosts\[(\d+)\]\.(name|descriptionRo|descriptionEn)$/.exec(key);
    if (cardMatch) {
      const p = Number(cardMatch[1]);
      coHosts[p] = { ...(coHosts[p] ?? { links: [] }), [cardMatch[2]]: entry };
      continue;
    }
    const linkMatch = /^event\.coHosts\[(\d+)\]\.links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(key);
    if (linkMatch) {
      const p = Number(linkMatch[1]);
      const l = Number(linkMatch[2]);
      const partner = coHosts[p] ?? { links: [] };
      const links = [...partner.links];
      links[l] = { ...(links[l] ?? {}), [linkMatch[3]]: entry };
      coHosts[p] = { ...partner, links };
    }
  }

  /**
   * The links (§332), posted as `event.links[i].<box>` by `LinkRowsEditor` — gathered by index
   * like the two lists above, blanks included; `fields.ts` drops the spare line and refuses a
   * row whose address is not https, naming the row by this same index.
   */
  const links: Array<Record<string, string>> = [];
  for (const [key, entry] of form.entries()) {
    const match = /^event\.links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    links[index] = { ...(links[index] ?? {}), [match[2]]: entry };
  }

  return {
    type: value("type"),
    // Optional, like difficulty below: "" from the unselected dropdown means "none".
    surface: value("surface") || null,
    eventStatus: value("eventStatus"),
    timezone: value("timezone"),
    startsAtWallTime: startWallTime(),
    endsAtWallTime: wallTime("endsAt"),
    // «Durata» as hours and minutes (§433), joined into the minutes the service has read since §71.
    durationMinutes: joinDuration(value("durationHours"), value("durationMinutesPart")),
    // «Startul cursei nu e stabilit» (§590): ticked, the gun time is saved empty, whatever the boxes hold.
    raceStartsAtWallTime: raceStartWallTime(form, wallTime("raceStartsAt")),
    scheduleRows: scheduleRows.filter((row) => row !== undefined),
    stravaEventUrl: value("stravaEventUrl"),
    facebookEventUrl: value("facebookEventUrl"),
    coHosts: coHosts
      .filter((row) => row !== undefined)
      .map(({ links: cardLinks, ...card }) => ({ ...card, links: cardLinks.filter((link) => link !== undefined) })),
    // Only when the form carried the list's marker (`LinkRowsEditor`): a form without the
    // editor posts nothing, and "nothing" must read as "not editing the links", not "none".
    links: form.get("event.links.present") === "1" ? links.filter((row) => row !== undefined) : undefined,
    // "Punct de întâlnire", once per language (§362): the Romanian box, which is also the event's
    // own meeting point (§36), and the English one — only when the form carried it, so a form
    // without the box reads as "not editing the English name" rather than as a blank one.
    locationName: value("locationName"),
    locationNameEn: form.has("event.locationNameEn") ? value("locationNameEn") : undefined,
    // No box for it any more (the Locul box); the field is folded into the meeting point.
    locationAddress: null,
    // "Locația se anunță mai târziu" (§328): a switch, so an absent value is "announced" —
    // the state every event was in before the switch existed.
    locationToBeAnnounced: form.get("event.locationToBeAnnounced") === "on",
    // «Data se anunță mai târziu» (§533): read only when the form carried its marker, as §451's box.
    dateToBeAnnounced: form.get("event.dateToBeAnnounced.present") === "1" ? form.get("event.dateToBeAnnounced") === "on" : undefined,
    timeToBeAnnounced: form.get("event.timeToBeAnnounced.present") === "1" ? form.get("event.timeToBeAnnounced") === "on" : undefined,
    // Closed sets since migration `0018`. An unselected dropdown posts "", which `fields.ts`
    // reads as "the club has not said" rather than as an invalid value.
    difficulty: value("difficulty") || null,
    // The step inside the band (§526), "1" … "3" — «Nivelul»'s segment, which shows the level (§563); `fields.ts` reads "" or absent as the middle.
    difficultyStep: value("difficultyStep"),
    costType: value("costType") || null,
    costAmount: value("costAmount"),
    costUrl: value("costUrl"),
    mapUrl: value("mapUrl"),
    // «Coordonate» (§416): only when the form carried the box, so a form without it (a reader
    // who may not edit the place) reads as "not editing" rather than as a cleared pair.
    coordinates: form.has("event.coordinates") ? value("coordinates") : undefined,
    routeUrl: value("routeUrl"),
    distanceMeters: value("distanceMeters"),
    // «Aproximativ» (§598): a checkbox beside the distance; `service.ts` drops it when the distance is empty.
    distanceEstimated: form.get("event.distanceEstimated") === "on",
    elevationGainMeters: value("elevationGainMeters"),
    // «Estimativ» (§585): a checkbox beside the number; `fields.ts` drops it when the number is empty.
    elevationGainEstimated: form.get("event.elevationGainEstimated") === "on",
    // "Eveniment de noapte" (§394): the three choices in "Traseul" — "yes", "no", or "auto" (and
    // an absent value) for the sunset's own answer.
    nightOverride: nightOverrideFromChoice(value("nightOverride")),
    // «Vremea» (§666): the three radios in the place's card, read only when the form carried them —
    // a form without them (a reader who may not change the place) is "not editing it".
    weatherMode: form.has("event.weatherMode") ? value("weatherMode") : undefined,
    // The group run's optional self-declaration (§393): a checkbox in "Traseul"; unticked, or
    // disabled because the club has no approved text of that kind, posts nothing: not offered.
    offersGroupRunDeclaration: form.get("event.offersGroupRunDeclaration") === "on",
    featured: form.get("event.featured") === "on",
    // A checkbox like the one above it, and unlike it in every other way: any number of
    // events may be special (§168), so nothing is cleared when one is ticked.
    isSpecial: form.get("event.isSpecial") === "on",
    // «Doar pentru membrii BVR» (§552): read only when the form carried its marker, as §451's box —
    // a form without it is "not editing it", never "public".
    membersOnly: form.get("event.membersOnly.present") === "1" ? form.get("event.membersOnly") === "on" : undefined,
    registrationMode: value("registrationMode"),
    capacity: value("capacity"),
    // The waiting list's length (§348), only when the form carried its box: an empty box is "no
    // limit", and a form without the box is "not editing it" — `fields.ts` tells the two apart.
    waitlistCapacity: form.has("event.waitlistCapacity") ? value("waitlistCapacity") : undefined,
    // «Lista de așteptare» (§633): what the length means, in words — «Nelimitată», «Limitată…» or
    // «Fără listă». The service folds it into the length before its schema runs, so a 0 under
    // «Limitată» is unlimited and only «Fără listă» stores 0. Absent, the number keeps §348's meaning.
    waitlistMode: form.has("event.waitlistMode") ? value("waitlistMode") : undefined,
    // «Kit de participare» → «Tricou» (§554): a checkbox, read only when the form carried its marker,
    // so a form without the card is "not editing it" rather than "no shirt".
    kitShirt: form.get("event.kitShirt.present") === "1" ? form.get("event.kitShirt") === "on" : undefined,
    // «Locurile din lista de așteptare se alocă automat» (§615): a «Da»/«Nu» select, read only when the
    // form carried it — anything but its two values is "not editing it", never a switch.
    waitlistAutoOffer: form.get("event.waitlistAutoOffer") === "true" ? true : form.get("event.waitlistAutoOffer") === "false" ? false : undefined,
    // «Condiții de participare» → «Informații medicale» (§557), by the same marker.
    askHealthNote: form.get("event.askHealthNote.present") === "1" ? form.get("event.askHealthNote") === "on" : undefined,
    bibStartNumber: value("bibStartNumber"),
    bibColour: value("bibColour"),
    /*
      The bib's design (§249), and only when the form that posted actually carried the panel.

      A checkbox that is off posts nothing, so reading these keys from a form without the panel
      — the create form, a test fixture — would write every switch off and quietly redesign a
      bib nobody had touched. The panel posts a marker; without it this is `undefined`, which
      `fields.ts` reads as "not editing the design".
    */
    bibDesign:
      form.get("event.bibDesign.present") === "1"
        ? // The one reader the panel's live preview also uses, so the picture on the screen is
          // drawn from exactly what this save posts (`bib-design-query.ts`).
          readBibDesignForm((name) => text(form, name))
        : undefined,
    confirmationOpensDaysBefore: value("confirmationOpensDaysBefore"),
    confirmationDeadlineDaysBefore: value("confirmationDeadlineDaysBefore"),
    // The event's own minimum age (§329); an empty box is the club's fourteen (`fields.ts`). One
    // box in «Regulamentul» for every type since §505, a group run's included (§440's own box gone).
    minAge: value("minAge"),
    // The event's own reminder lead (§377), only when the form carried its select: the empty
    // choice is "as usual" (null), and a form without the select is "not editing it".
    reminderHoursBefore: form.has("event.reminderHoursBefore") ? value("reminderHoursBefore") : undefined,
    registrationOpensAtWallTime: wallTime("registrationOpensAt"),
    // «Înscrierile se deschid în curând» (§451): a checkbox, read only when the form carried its
    // marker — an unticked box posts nothing, and a form without the box must read as "not
    // editing it" rather than as "open", which would open a door the organizer holds shut.
    registrationOpensSoon: form.get("event.registrationOpensSoon.present") === "1" ? form.get("event.registrationOpensSoon") === "on" : undefined,
    registrationClosesAtWallTime: wallTime("registrationClosesAt"),
    declarationDocumentId: value("declarationDocumentId"),
    // A checkbox, so an absent value is HIDDEN — the safe half of a disclosure switch.
    participantListVisibility:
      form.get("event.participantListVisibility") === "on" ? "NAMES" : "HIDDEN",
    // «Lista de așteptare e publică» (§628), a checkbox beside it, read the same safe way: absent
    // is off. The service keeps it off anyway unless the list above is on (`waitlistPublicColumn`).
    waitlistPublic: form.get("event.waitlistPublic") === "on",
    // «Arată public câți așteaptă» (§634): a checkbox read only when the form carried its marker, as
    // the kit's (§554) — on by default, so a form without the box must read "not editing it", never "hidden".
    waitlistCountPublic:
      form.get("event.waitlistCountPublic.present") === "1" ? form.get("event.waitlistCountPublic") === "on" : undefined,
    // «Arată public numărătoarea» (§647): on by default, so an unticked box is `false` only beside its marker.
    participantCountPublic:
      form.get("event.participantCountPublic.present") === "1" ? form.get("event.participantCountPublic") === "on" : undefined,
    // «Lista ascunsă» (§647): the group's three, read only when the form carried its marker — a form
    // without the group is "not editing it", never "switched off" or "no series".
    ...hiddenListFrom(form, value),
    externalProvider: value("externalProvider"),
    externalRegistrationUrl: value("externalRegistrationUrl"),
  };
}

/**
 * One language's fields, as `ui/TranslationFields.tsx` posts them from its boxes — the one reader for the save
 * and the create, so the two cannot drift in what they read (`eventFieldsFrom`'s sibling).
 * Every value stays a string here; `fields.ts` turns "" into "not stated" and refuses the rest.
 */
function translationInputFrom(form: FormData, locale: Locale) {
  const value = (field: string) => text(form, `translations.${locale}.${field}`);
  return {
    slug: value("slug"),
    title: value("title"),
    excerpt: value("excerpt"),
    excerptBody: value("excerptBody"),
    checklist: value("checklist"),
    body: value("body"),
    rules: value("rules"),
    schedule: value("schedule"),
    // The route / training description (§387), posted from the "Traseul" card's own tabs.
    routeDescription: value("routeDescription"),
    // No place name here: it is asked once per language in the Locul box and read with the
    // event's fields (`eventFieldsFrom`, §362).
    seoTitle: value("seoTitle"),
    seoDescription: value("seoDescription"),
    // The club's discount on an external event's own fee (`DECISIONS.md` §394), posted from the
    // cost card's own strip (`RegistrationBox`), which now renders for a words-only reader too
    // (no settings rights) as well as inside the settings editor's `CostFields`. Read only when
    // the box was actually posted, the way `reminderHoursBefore` above is — an absent box (a
    // future caller, a stale form) must leave the column alone rather than blank it; cleared
    // server-side outside EXTERNAL + PAID (`service.ts#applyTranslationSave`).
    discountNote: form.has(`translations.${locale}.discountNote`) ? value("discountNote") : undefined,
    // The club's own weather text (§666), from the place's card under «Vremea» — read only when the
    // box was posted, like the discount note: an absent box leaves the column alone, "" clears it.
    weatherNote: form.has(`translations.${locale}.weatherNote`) ? value("weatherNote") : undefined,
  };
}

/**
 * One language's text, read back out of the single form, with the row it belongs to.
 *
 * A locale the actor may not edit renders no inputs at all, so `translationId` is absent and
 * this returns `undefined` — the save then carries nothing for that language rather than an
 * empty one, which is what would overwrite somebody's text with blanks. The create form has
 * no row yet and posts no id either; it reads the fields with `translationInputFrom` directly.
 */
function translationFieldsFrom(form: FormData, locale: Locale) {
  const translationId = text(form, `translations.${locale}.translationId`);
  if (translationId === "") return undefined;

  return {
    translationId,
    expectedVersion: Number(text(form, `translations.${locale}.expectedVersion`)),
    fields: translationInputFrom(form, locale),
  };
}

/**
 * The ticked rows of the events list: `id:version` each, and a series row ticks all its dates
 * as one value joined by commas (`DECISIONS.md` §113). The version travels with the tick so a
 * bulk verb still meets the version guard (§11.5).
 */
function selectedEventRefs(form: FormData): Array<{ eventId: string; expectedVersion: number }> {
  return form
    .getAll("eventRef")
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .filter((reference) => reference.includes(":"))
    .map((reference) => {
      const separator = reference.lastIndexOf(":");
      return { eventId: reference.slice(0, separator), expectedVersion: Number(reference.slice(separator + 1)) };
    });
}

/** Publication is per event now, so this moves the event and not one of its languages. */
export async function transitionEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    const to = text(form, "to") as EditorialStatus;
    const move = { actor, eventId, expectedVersion: Number(text(form, "expectedVersion")) };
    // «Publică» is one press from a draft too (§423), as «Creează și publică» is: the service
    // walks the review step itself, for a role that may publish, or refuses before anything moves.
    if (to === "PUBLISHED") await publishEvent(getDb(), move);
    else await transitionEvent(getDb(), { ...move, to });
    outcome = { saved: text(form, "to") };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(path, outcome);
}

/**
 * Archive several events at once, from the list (BR-REQ-051-01).
 *
 * The one bulk verb events get. A season ends with a handful of races that are over and should
 * come off the site, and archiving them one at a time is one editor round-trip each. Publishing
 * in bulk is deliberately not offered: PUBLISHED is refused while either language is incomplete,
 * so a bulk publish would be a button whose usual outcome is a list of failures. Deleting in
 * bulk is not offered either — it is Administrator-only, it is refused for any event with a
 * registration, and it is not a thing to do to several rows on one tick.
 *
 * ## Why the checkbox carries the version
 *
 * Each row's value is `id:version`, so every archive still passes the version it was loaded with
 * and a colleague's concurrent edit still produces a CONFLICT for that row (§11.5). Reading the
 * current version here instead would have been simpler and would have quietly turned a bulk
 * archive into the one write in the backoffice that overwrites whatever it finds.
 */
export async function bulkArchiveEventsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = eventListPath(form, locale);
  const glue = listPath.includes("?") ? "&" : "?";

  const selected = selectedEventRefs(form);

  if (selected.length === 0) {
    return backTo(listPath, { error: "NOTHING_SELECTED" });
  }

  let archived = 0;
  let failed = 0;
  try {
    const actor = await requireStaff();
    const db = getDb();

    for (const { eventId, expectedVersion } of selected) {
      try {
        await transitionEvent(db, { actor, eventId, expectedVersion, to: "ARCHIVED" });
        archived += 1;
      } catch (error) {
        if (!isDomainError(error)) throw error;
        failed += 1;
      }
    }
  } catch (error) {
    return backTo(listPath, outcomeOf(error));
  }

  await flashOutcome({ saved: "eventsArchived", archived: String(archived), failed: String(failed) });
  redirect(`${listPath}${glue}saved=eventsArchived&archived=${archived}&failed=${failed}#admin-alert`);
}

/**
 * Publish the ticked events (BR-REQ-050-02 criterion 7): a recurring series is made as drafts,
 * and publishing fifty-two Mondays one page at a time is not a workflow. Each event walks the
 * ordinary transitions — DRAFT → IN_REVIEW → PUBLISHED, or the second alone — through
 * `transitionEvent`, so the role check and the both-languages-complete check hold on every
 * one, and a failure (an incomplete copy, a stale version) is counted and skipped rather than
 * stopping the rest. The same form and the same selection as archiving.
 */
export async function bulkPublishEventsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = eventListPath(form, locale);
  const glue = listPath.includes("?") ? "&" : "?";

  const selected = selectedEventRefs(form);
  if (selected.length === 0) return backTo(listPath, { error: "NOTHING_SELECTED" });

  let published = 0;
  let failed = 0;
  try {
    const actor = await requireStaff();
    const db = getDb();

    for (const { eventId, expectedVersion: loadedVersion } of selected) {
      let expectedVersion = loadedVersion;
      try {
        const [current] = await db.select({ status: events.editorialStatus }).from(events).where(eq(events.id, eventId)).limit(1);
        if (!current) throw new DomainError("NOT_FOUND", "no such event");
        if (current.status === "PUBLISHED") continue;
        if (current.status === "DRAFT" || current.status === "ARCHIVED") {
          const reviewed = await transitionEvent(db, { actor, eventId, expectedVersion, to: current.status === "ARCHIVED" ? "DRAFT" : "IN_REVIEW" });
          expectedVersion = reviewed.version;
          if (current.status === "ARCHIVED") {
            const again = await transitionEvent(db, { actor, eventId, expectedVersion, to: "IN_REVIEW" });
            expectedVersion = again.version;
          }
        }
        await transitionEvent(db, { actor, eventId, expectedVersion, to: "PUBLISHED" });
        published += 1;
      } catch (error) {
        if (!isDomainError(error)) throw error;
        failed += 1;
      }
    }
  } catch (error) {
    return backTo(listPath, outcomeOf(error));
  }

  await flashOutcome({ saved: "eventsPublished", published: String(published), failed: String(failed) });
  redirect(`${listPath}${glue}saved=eventsPublished&published=${published}&failed=${failed}#admin-alert`);
}

/**
 * Delete the ticked events (`DECISIONS.md` §114): the whole of a test series, the drafts of a
 * season that never happened. Administrator only, refused whole for anybody else; then each
 * event through `deleteEvent`, which refuses one with a registration against it — counted and
 * skipped, never forced, because archiving is the answer for an event that happened.
 */
export async function bulkDeleteEventsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = eventListPath(form, locale);
  const glue = listPath.includes("?") ? "&" : "?";

  const selected = selectedEventRefs(form);
  if (selected.length === 0) return backTo(listPath, { error: "NOTHING_SELECTED" });

  let deleted = 0;
  let failed = 0;
  try {
    const actor = await requireStaff();
    if (!canDeleteEvent(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not delete events`);
    const db = getDb();

    for (const { eventId } of selected) {
      try {
        await deleteEvent(db, { actor, eventId });
        deleted += 1;
      } catch (error) {
        if (!isDomainError(error)) throw error;
        failed += 1;
      }
    }
  } catch (error) {
    return backTo(listPath, outcomeOf(error));
  }

  await flashOutcome({ saved: "eventsDeleted", deleted: String(deleted), failed: String(failed) });
  redirect(`${listPath}${glue}saved=eventsDeleted&deleted=${deleted}&failed=${failed}#admin-alert`);
}

/**
 * The editor's one save (BR-REQ-051-01).
 *
 * One form, one button, one transaction: the event row and every language the actor may edit,
 * or a CONFLICT and nothing at all. It replaced a settings save and one save per language,
 * which was three separate chances to lose an edit and two version guards that went stale the
 * moment the first save succeeded.
 *
 * `event.expectedVersion` is absent for an Author, who sees no settings panel; the service then
 * writes no event row rather than assuming a version.
 *
 * A refusal — a field the browser could not check, a stale version — comes back as the form's
 * state with every box still filled, the acknowledgement tick included (§315); a save that
 * went through redirects to the editor with its banner, as it always has.
 */
export async function saveEventAndTranslationsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: {
    error?: string;
    saved?: string;
    applied?: string;
    offered?: string;
    announced?: string;
    notice?: string;
    queued?: string;
    moved?: string;
    movedTo?: string;
    movedSent?: string;
  };
  try {
    const actor = await requireStaff();
    const editsEventRow = text(form, "event.expectedVersion") !== "";
    // Which dates of the series (§130, §134): the dates ticked in the editor's header, or a
    // preset word; absent elsewhere. Ticks win — they are what the organizer sees.
    const ticked = form.getAll("dates").filter((value): value is string => typeof value === "string" && value !== "");
    const scope = text(form, "scope");

    const { appliedTo, offered, placeAnnounced, holdsMoved, notice } = await saveEventAndTranslations(getDb(), {
      actor,
      eventId,
      fields: editsEventRow ? eventFieldsFrom(form) : undefined,
      expectedVersion: editsEventRow ? Number(text(form, "event.expectedVersion")) : undefined,
      translations: routing.locales
        .map((contentLocale) => translationFieldsFrom(form, contentLocale))
        .filter((entry) => entry !== undefined),
      acknowledgeLiveEdit: form.get("acknowledgeLiveEdit") === "on",
      scope: ticked.length > 0 ? { ids: ticked } : SERIES_EDIT_SCOPES.includes(scope as (typeof SERIES_EDIT_SCOPES)[number]) ? (scope as SeriesEditScope) : "this",
      /*
        "Anunță participanții despre schimbare" and its note, and the cancellation's reason and
        its "tell them" box (§331). Read as posted and judged by the service — the role, the
        reason required on a cancellation, the five hundred characters, both languages or
        neither (§354, bilingual everywhere) — so a replayed POST meets the same rules as the
        page. An unticked box posts nothing, which is "no". The note and the reason are one box
        per language; the cancellation is there when either of its boxes was drawn.
      */
      notice: { notify: form.get("notice.notify") === "on", note: { ro: text(form, "notice.noteRo"), en: text(form, "notice.noteEn") } },
      cancellation:
        form.has("cancel.reasonRo") || form.has("cancel.reasonEn")
          ? { reason: { ro: text(form, "cancel.reasonRo"), en: text(form, "cancel.reasonEn") }, notify: form.get("cancel.notify") === "on" }
          : undefined,
      // The Locul box ran in the browser (§362): its English name is the organizer's as it stands.
      placeNamesAsTyped: form.get(PLACE_NAMES_AS_TYPED_FIELD) === "1",
    });
    // A raised capacity's offers (§147) ride on the same banner as a number; absent when none.
    // So does what the participants were told (§331): the kind and the count, never who.
    outcome = {
      ...(appliedTo > 0 ? { saved: "eventSeries", applied: String(appliedTo) } : { saved: "event" }),
      offered: offered > 0 ? String(offered) : undefined,
      // The reserved places the window's move carried (§665): how many, to when, whether they were emailed — a count and an instant, never who.
      ...(holdsMoved.moved > 0
        ? {
            moved: String(holdsMoved.moved),
            movedTo: holdsMoved.to?.toISOString(),
            movedSent: holdsMoved.queued > 0 ? "1" : undefined,
          }
        : {}),
      // The save that announced the place (§328): the banner says it is public now. A flag, never
      // the place itself — nothing typed goes in a URL. When the organizer also told the
      // participants, the notice's own banner says so, and "nobody was written to" would be false.
      announced: placeAnnounced && notice?.kind !== "update" ? "1" : undefined,
      ...(notice?.kind === "update" ? { notice: "update", queued: String(notice.queued) } : {}),
      ...(notice?.kind === "nothingToTell" ? { notice: "none" } : {}),
      ...(notice?.kind === "cancelled" ? { notice: notice.notified ? "cancelled" : "cancelledQuiet", queued: String(notice.queued) } : {}),
      // An event with no registrations here had no box to untick: its own sentence, not "unticked".
      ...(notice?.kind === "cancelledNobodyToTell" ? { notice: "cancelledNobody" } : {}),
    };
  } catch (error) {
    return { ...refused(error, form, { fieldNames: eventFormFieldNames }), ...hiddenListOutcome(error, locale) };
  }

  return backTo(path, outcome);
}

/**
 * **«Previzualizare» before saving (§579)**: the editor's form, as it stands, drawn as the listing
 * card and the event page in one language — through the save's own readers here
 * (`eventFieldsFrom`, `translationFieldsFrom`, `translationInputFrom`) and the save's own steps
 * without the write (`draft-preview.tsx`). Posted by the preview frame (`EventDraftFrame`) from the
 * page `/<locale>/preview/draft`, so the request's language is the language drawn.
 *
 * One function call per press, nothing in idle (the owner's «costuri minime»): no row, no audit, no
 * cache entry filled or expired, no email, no revalidation, no redirect. The role is asserted here,
 * before anything is read (BR-REQ-060-01) — the card that offers the button is a courtesy.
 * `private, no-store` is the proxy's on every staff path the frame is served from (`private-paths.ts`),
 * and Next answers an action uncached.
 */
export async function previewEventDraftAction(form: FormData): Promise<DraftPreview> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return { outcome: "forbidden" };
    throw error;
  }
  const eventId = text(form, "eventId") || null;
  // The create page posts no id and every box; the editor posts the settings only with their
  // version (a reader who may not change them posts none) and each language with its row id.
  const editsEventRow = eventId === null || text(form, "event.expectedVersion") !== "";
  return renderEventDraftPreview(getDb(), {
    actor,
    eventId,
    fields: editsEventRow ? eventFieldsFrom(form) : undefined,
    translations: Object.fromEntries(
      routing.locales.flatMap((contentLocale) => {
        if (eventId === null) return [[contentLocale, translationInputFrom(form, contentLocale)]];
        const posted = translationFieldsFrom(form, contentLocale);
        return posted ? [[contentLocale, posted.fields]] : [];
      }),
    ),
    placeNamesAsTyped: form.get(PLACE_NAMES_AS_TYPED_FIELD) === "1",
    locale: toLocale(form.get("previewLocale")),
  });
}

/**
 * A new event — and, on the second button, published in the same breath (§315; the owner:
 * "ar trebui sa pot crea si publica dintr-un foc!").
 *
 * A refusal returns the form's state so every box comes back as typed (§315): the settings,
 * both languages with their rich texts, the repeat rule, the programme's rows. Nothing about
 * the event is in the URL. A create that went through opens the new event's page, as it
 * always did — with the banner saying whether it was also published, and if not, why not
 * (`createEventAndPublish` commits the draft and hands back the guard's refusal).
 *
 * The series is made inside the create's transaction, so a refused rule — an end on or before
 * the event's start — writes nothing and comes back like any other refusal, the repeat
 * settings included, rather than leaving an event behind and a redirect to it.
 */
export async function createEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let outcome: { saved: string; created?: string; notPublished?: string };
  let createdId: string;
  try {
    const actor = await requireStaff();

    // Recurrence, asked for on the creation form (`DECISIONS.md` §64): the same series the
    // event page offers, made with the event. The tick decides whether this event repeats at
    // all (§170); the cadence only says how. Without it the recurrence fields are hidden, and a
    // hidden field's value means nothing. The rest of the rule is `repeatEvent`'s to judge.
    const cadence = form.get("repeat.on") === "on" ? text(form, "repeat.cadence") : "";
    if (cadence && cadence !== "NONE" && !REPEAT_CADENCES.includes(cadence as RepeatCadence)) {
      throw new DomainError("VALIDATION_ERROR", "cadence: choose one of the listed cadences", ["repeat.cadence"]);
    }
    const repeats = cadence !== "" && cadence !== "NONE";

    // The create form renders the editor's own language panels, so each language is read
    // with the save's reader — the rich summary, the description, the folds — and not a
    // title-slug-excerpt triple of its own that would drift from the editor by the next field.
    const result = await createEventAndPublish(getDb(), {
      actor,
      fields: {
        ...eventFieldsFrom(form),
        translations: {
          ro: translationInputFrom(form, "ro"),
          en: translationInputFrom(form, "en"),
        },
      },
      // An event created already cancelled says why, in both languages (§448, §331): the service
      // requires it for `CANCELLED` and ignores it otherwise; nobody is told — nobody is registered.
      cancellation:
        form.has("cancel.reasonRo") || form.has("cancel.reasonEn")
          ? { reason: { ro: text(form, "cancel.reasonRo"), en: text(form, "cancel.reasonEn") }, notify: false }
          : undefined,
      // The second button's marker: "create and publish". The service asks the role itself.
      publish: text(form, THEN_FIELD) === THEN_PUBLISH,
      repeat: repeats
        ? {
            cadence: cadence as RepeatCadence,
            weekdays: weekdaysFrom(form),
            until: text(form, "repeat.until") || null,
            // "Publică datele noi automat" (§350), ticked by default: the rule stores it, and the
            // dates go live only while the event is live too.
            publish: form.get("repeat.publish") === "on",
          }
        : null,
    });
    createdId = result.event.id;
    outcome = {
      saved: result.published ? "createdPublished" : "created",
      created: result.repeated > 0 ? String(result.repeated) : undefined,
      // Why the second button did not publish: the code, never a word of what was typed. The
      // editor names what is missing in its own alert (§170).
      notPublished: result.refusal?.code,
    };
  } catch (error) {
    // Nothing was written — the create, the publication and the series are one transaction —
    // so the form comes back with everything typed.
    return { ...refused(error, form, { fieldNames: eventFormFieldNames }), ...hiddenListOutcome(error, locale) };
  }

  return backTo(editorPath(locale, createdId), outcome);
}

export async function duplicateEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let copyId: string | undefined;
  let outcome: { error?: string; saved?: string } | undefined;
  try {
    const actor = await requireStaff();
    const copy = await duplicateEvent(getDb(), { actor, eventId: text(form, "eventId") });
    copyId = copy.id;
  } catch (error) {
    // A copy is refused by the source's hidden list (§647): its sentence, which names the box — never a date.
    outcome = hiddenListOutcome(error, locale) ?? outcomeOf(error);
  }

  if (outcome) return backTo(eventListPath(form, locale), outcome);
  return backTo(editorPath(locale, copyId as string), { saved: "duplicated" });
}

/** The ticked days of the week, ISO numbered, from the repeat fields (`RepeatFields`). */
function weekdaysFrom(form: FormData): Weekday[] {
  return form
    .getAll("weekday")
    .map((value) => Number(value))
    .filter((value): value is Weekday => (WEEKDAYS as readonly number[]).includes(value));
}

/**
 * A standing series from an existing event (§122), from the editor's repeat panel. A refusal — an
 * end before the event, say — comes back as the form's state with the tick, the cadence, the end
 * and the weekdays as they were chosen (§315); a series made lands on the editor as before.
 */
export async function repeatEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; created?: string };
  try {
    const actor = await requireStaff();
    // The tick is the answer to "does this repeat" (§170). The button that posts this form is
    // hidden until it is ticked, and this is the same rule asserted where it decides.
    if (form.get("repeatOn") !== "on") {
      throw new DomainError("VALIDATION_ERROR", "tick 'repeat this event' before creating a series", ["repeatOn"]);
    }
    const cadence = text(form, "cadence");
    if (!REPEAT_CADENCES.includes(cadence as RepeatCadence)) {
      throw new DomainError("VALIDATION_ERROR", "cadence: choose one of the listed cadences", ["cadence"]);
    }
    const result = await repeatEvent(getDb(), {
      actor,
      eventId,
      rule: { cadence: cadence as RepeatCadence, weekdays: weekdaysFrom(form), until: text(form, "until") || null, publish: form.get("publish") === "on" },
    });
    outcome = { saved: "eventsRepeated", created: String(result.created) };
  } catch (error) {
    // Every date carries the source's hidden list (§647): a refusal of it says which box to move — a
    // box of the event's settings, not of this panel, so the summary links none of the panel's.
    const hidden = hiddenListOutcome(error, locale);
    return hidden ? { ...refused(error, form), ...hidden, fields: [] } : refused(error, form);
  }

  // Back to the source: it now says how it repeats, and the list has the dates.
  return backTo(editorPath(locale, eventId), outcome);
}

/** The series ends here: no further dates are made; the ones that exist stay (§122). */
export async function stopRepeatAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await stopRepeat(getDb(), { actor, eventId });
    outcome = { saved: "repeatStopped" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(editorPath(locale, eventId), outcome);
}

/**
 * The series' automatic publication, on or off (§341): whether the dates made from now on go
 * live as they are made. Posted from the Recurență box on any date of the series (§350, the
 * editor's boxes): the tick "Publică datele noi automat" is the rule's new flag — ticked posts
 * `publish=on`, unticked posts nothing — and "Salvează setarea" sends it. The service resolves the
 * date to the series' source and asserts the role (switching it on asks for the role that
 * publishes); a draft source is not refused — the switch is stored and waits until the source is
 * live (`setRepeatPublish`).
 *
 * Also posted from the events list's draft line, "Publică automat de acum" (§351), which aims it
 * at the source with `publish=on` and `returnTo=list`: that press lands back on the list, where
 * the line it came from still shows the dates already created. Only the word `list` is read,
 * never an address, so nothing posted can choose where the redirect goes — anything else is the
 * editor, as before.
 */
export async function setRepeatPublishAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const publish = text(form, "publish") === "on";
  const back = text(form, "returnTo") === "list" ? getPathname({ locale, href: "/admin" }) : editorPath(locale, eventId);
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setRepeatPublish(getDb(), { actor, eventId, publish });
    outcome = { saved: publish ? "repeatPublishOn" : "repeatPublishOff" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(back, outcome);
}

/**
 * Race numbers for every confirmed registration of the event that has none yet
 * (BR-REQ-038-01). Lands back on the editor, where the sheet is downloaded from.
 */
export async function assignBibNumbersAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; assigned?: string; total?: string; notConfirmed?: string; test?: string };
  try {
    const actor = await requireStaff();
    const result = await assignBibNumbers(getDb(), { actor, eventId });
    outcome = {
      saved: "bibsAssigned",
      assigned: String(result.assigned),
      total: String(result.total),
      // Why nothing happened, when nothing happened (§286). Counts, never anybody's name.
      notConfirmed: String(result.notConfirmed),
      test: String(result.test),
    };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(editorPath(locale, eventId), outcome);
}

/**
 * «Tipărește» on the spares' section (§444): reserve that many numbers for the desk, under the
 * event's lock, and come back to the editor with the range — the page's banner carries the link
 * to the sheet of exactly those numbers. Behind the confirmation that names the first number;
 * `expectFrom` is that number, and a registration that moved it since is refused (CONFLICT) and
 * the card, drawn again, names the new start.
 */
export async function reserveSpareBibsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const expected = Number(text(form, "expectFrom"));

  let outcome: { error?: string; saved?: string; count?: string; from?: string; to?: string };
  try {
    const actor = await requireStaff();
    const result = await reserveSpareBibs(getDb(), {
      actor,
      eventId,
      // `Number("")` is 0, which the service refuses as a count, naming the box.
      count: Number(text(form, "count")),
      expectFrom: Number.isInteger(expected) && expected > 0 ? expected : undefined,
    });
    outcome = { saved: "sparesReserved", count: String(result.count), from: String(result.from), to: String(result.to) };
  } catch (error) {
    // No room before the hidden list's own series (§647): its sentence, which names the box to move.
    outcome = isDomainError(error) && error.fields.includes(SPARES_BEFORE_HIDDEN_LIST) ? { error: SPARES_BEFORE_HIDDEN_LIST } : outcomeOf(error);
  }
  return backTo(editorPath(locale, eventId), outcome);
}

/**
 * The thank-you after the race (`DECISIONS.md` §82): once per event, to everyone who was
 * checked in, with an optional link. Behind a confirmation on the page; audited by the service.
 * A refused link comes back in its box (§315): a results address is long, and pasting it again
 * from another tab is exactly what the owner asked forms to stop making people do.
 */
export async function sendEventThanksAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; recipients?: string };
  try {
    const actor = await requireStaff();
    const result = await sendEventThanks(getDb(), actor, { eventId, url: text(form, "url") }, new Date());
    // The real rows (§30): the number the dialog stated, never the test rows written to beside them.
    outcome = { saved: "thanksSent", recipients: String(result.real) };
  } catch (error) {
    return refused(error, form);
  }
  return backTo(editorPath(locale, eventId), outcome);
}

/**
 * «Retrimite declarația tuturor care nu au semnat» (§606): a fresh signing link to every pending
 * registration of the event, in one press. Administrator only — asked here, at the door, and again in
 * the service (BR-REQ-060-01). The banner names what was queued and what was skipped and why; a press
 * refused by a closed event or by the event's hourly limit lands on the sentence the button's «i»
 * said before the press (§592).
 */
export async function resendDeclarationToAllAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  let outcome: Record<string, string>;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const result = await resendDeclarationToAllPending(getDb(), actor, eventId, new Date());
    outcome = {
      saved: "declarationResent",
      queued: String(result.queued),
      recent: String(result.skippedRecent),
      limited: String(result.skippedLimited),
      testQueued: String(result.test.queued),
    };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = {
      error: error.fields.includes(BULK_RESEND_CLOSED) ? "BULK_RESEND_CLOSED" : error.fields.includes(BULK_RESEND_LIMITED) ? "BULK_RESEND_LIMITED" : error.code,
    };
  }
  return backTo(`${editorPath(locale, eventId)}`, outcome);
}

export async function deleteEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string };
  try {
    // The coarse gate first, so a non-Administrator never reaches the service; the service
    // asserts it again, and refuses any event that has a registration against it.
    const actor = await requireStaffCapability(canDeleteEvent);
    await deleteEvent(getDb(), { actor, eventId });
    outcome = { saved: "deleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // Deleted or not, the event list is where there is something to look at — the editor for a
  // deleted event is a 404 — and the list as it was left, filtered and ordered (§527).
  return backTo(eventListPath(form, locale), outcome);
}

/**
 * The hard delete (`/admin/events/[id]/erase`): the event **and everyone registered for it**.
 *
 * A separate action from `deleteEventAction` on purpose, and not reachable from the bulk bar:
 * "delete the ticked events" that could also erase participants is how somebody loses a season
 * in one click. Everything that makes this safe is in the service — the role, the typed title,
 * the reason, the audit rows, the single transaction — and nothing here repeats it, because a
 * check written in an action is a check a replayed POST walks past.
 *
 * A refusal is the form's returned state (§315): the browser never leaves the erase page, so
 * the screen that explains what would be destroyed is what the organizer reads the refusal on,
 * with the reason still in its box and the typed title asked again. On success there is no
 * event to go back to, so the list is where it lands.
 */
export async function hardDeleteEventAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let erased = 0;
  try {
    const actor = await requireStaffCapability(canHardDeleteEvent);
    const result = await hardDeleteEvent(getDb(), {
      actor,
      eventId,
      typedTitle: text(form, "typedTitle"),
      reason: text(form, "reason"),
      now: new Date(),
    });
    erased = result.registrationsErased;
  } catch (error) {
    // The reason comes back; the typed title never does (§315) — it is the guard, and it is
    // meant to be typed again (`NEVER_KEPT`).
    return refused(error, form);
  }

  await flashOutcome({ saved: "eventErased", erased: String(erased) });
  redirect(
    `${getPathname({ locale, href: "/admin" })}?saved=eventErased&erased=${erased}#admin-alert`,
  );
}

/** Test rows through the real queue (§30). A refused count comes back as typed (§315). */
export async function addTestRegistrationsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let stoppedAt: number | null = null;
  try {
    const actor = await requireStaffCapability(canManageTestRegistrations);
    const result = await addTestRegistrations(getDb(), actor, {
      eventId,
      count: Number(text(form, "count")),
      locale,
    });
    if (result.stoppedAtWaitlistLimit) stoppedAt = result.created;
  } catch (error) {
    // The places and the waiting list full before the first row (§348): said as such, the count
    // still in its box — the marker is a rule about the event, not a box the summary could name.
    const full = waitlistRefusalCode(error);
    const refusal = refused(error, form);
    return full ? { ...refusal, error: full, fields: [] } : refusal;
  }

  // Stopped part-way at the waiting list's limit (§348): how many went in, and why the rest did not.
  if (stoppedAt !== null) return backTo(path, { saved: "testRegistrationsStopped", created: String(stoppedAt) });
  return backTo(path, { saved: "testRegistrationsAdded" });
}

export async function removeTestRegistrationsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageTestRegistrations);
    await removeTestRegistrations(getDb(), actor, eventId);
    outcome = { saved: "testRegistrationsRemoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(path, outcome);
}

/**
 * Withdrawal from "Anunță-mă" (§146), as the notice promises: an Administrator types the
 * address the person wrote from, and the row goes by its canonical identity. The address is
 * posted, never put in the URL; the outcome is a flag. An address the canonicalizer refuses — one
 * the browser's `type="email"` lets through, such as `a@b` — comes back in its box with the
 * summary pointing at it (§315), rather than on a page that has forgotten what was typed.
 */
export async function withdrawInterestAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    await requireStaffCapability(canManageRegistrations);
    const removed = await withdrawInterest(getDb(), eventId, text(form, "email"));
    outcome = { saved: removed ? "interestRemoved" : "interestNotFound" };
  } catch (error) {
    return refused(error, form);
  }

  return backTo(path, outcome);
}

/**
 * An Administrator erases one group run's self-declaration (§393): the reason typed, the audit row
 * first (who and why, never who had signed). The coarse gate here and the service's own, which is
 * the one that holds (BR-REQ-060-01). A reason left empty comes back in its box (§315).
 */
export async function eraseGroupRunDeclarationAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    await eraseGroupRunDeclaration(getDb(), actor, { id: text(form, "declarationId"), reason: text(form, "reason") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  return backTo(path, { saved: "groupRunDeclarationErased" });
}

/**
 * «Păstrează: reclamație / litigiu în curs» on one group-run declaration, or its release (§556): the
 * Administrator's, with a reason; the service asks the role again and writes the audit row.
 */
export async function groupRunDeclarationHoldAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);
  const hold = text(form, "hold") === "1";
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    await setGroupRunDeclarationHold(getDb(), actor, { eventId, id: text(form, "declarationId"), hold, reason: text(form, "reason") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  return backTo(path, { saved: hold ? "declarationHeld" : "declarationReleased" });
}

/**
 * An Administrator erases the ticked signatures of a run in one press (§532): the ids the confirm
 * dialog counted, one reason, each through the single erase's own path. A set that changed since
 * the page was drawn is refused whole and says so; the toast names how many went.
 */
export async function eraseGroupRunDeclarationsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);
  let erased: number;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const ids = form.getAll("declarationIds").filter((value): value is string => typeof value === "string");
    ({ erased } = await eraseGroupRunDeclarations(getDb(), actor, { eventId, ids, reason: text(form, "reason") }, new Date()));
  } catch (error) {
    return refused(error, form);
  }
  return backTo(path, { saved: "groupRunDeclarationsErased", erased: String(erased) });
}

/** Adding a colleague (§123). A refused address or name comes back in its box (§315). */
export async function inviteStaffAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: Record<string, string | undefined>;
  let toast: Record<string, string | undefined>;
  try {
    // The coarse gate first, so a non-Administrator never reaches the service; the service
    // asserts it again for callers that are not this action.
    const actor = await requireStaffCapability(canManageStaff);
    const member = await inviteStaffUser(getDb(), actor, {
      email: text(form, "email"),
      displayName: text(form, "displayName"),
      role: text(form, "role") as StaffRole,
      preferredLocale: toLocale(form.get("preferredLocale")),
    });
    // The allowlist row exists; now the account and its invitation, where Zitadel is the
    // provider and a key is set (§123). Locally the switcher is the provider: nothing to send.
    const invite =
      env.STAFF_AUTH_MODE === "provider"
        ? await inviteZitadelUser({ email: member.email, displayName: member.displayName, locale: member.preferredLocale as Locale })
        : ({ kind: "unconfigured" } as const);
    outcome = { saved: "invited", invite: invite.kind, ...(invite.kind === "failed" ? { reason: invite.reason.slice(0, 120) } : {}) };
    // Without Zitadel as the provider the allowlist row is the whole verb, and "added to the team"
    // is true: the toast says so. Under the provider `unconfigured` means no key, and the banner
    // says why nobody was invited — no green tick (`notice.ts`, PROVIDER_DONE).
    toast = env.STAFF_AUTH_MODE === "provider" ? outcome : { saved: "invited" };
  } catch (error) {
    return refused(error, form);
  }

  return backTo(path, outcome, toast);
}

/**
 * «Adaugă mai mulți membri» (§524): one row per person, the role `MEMBER`, the whole list or nobody.
 *
 * A refusal names the rows (§457): the ones that are not addresses (`INVALID_ADDRESSES`), the ones
 * already on the team with a backoffice role (`MEMBERS_ON_TEAM`), or the ceiling of
 * `MEMBER_ROWS_MAX` (`TOO_MANY_ADDRESSES`), and every row comes back in the box as typed (§315).
 *
 * After the one transaction, the Zitadel accounts where Zitadel is the provider (§123): a few at a
 * time, every call bounded, every member one line of the report — created, invited, failed with the
 * reason — written to one audit row whose id the result page reads back, so nothing is half-done
 * silently. An address already a member is taken again rather than refused: pressing again with the
 * failed addresses retries their accounts, with no second row and no second platform invitation.
 */
export async function inviteMembersAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  const rows = parseMemberRows(text(form, "members"));

  let outcome: Record<string, string | undefined>;
  let toast: Record<string, string | undefined>;
  try {
    const actor = await requireStaffCapability(canManageStaff);
    const { added, existing } = await inviteMembers(getDb(), actor, { rows, preferredLocale: toLocale(form.get("preferredLocale")) });
    const lines: MemberAccountLine[] =
      env.STAFF_AUTH_MODE === "provider"
        ? await createMemberAccounts([...added, ...existing], (member) =>
            inviteZitadelUser({ email: member.email, displayName: member.displayName, locale: member.preferredLocale as Locale }),
          )
        : [];
    const counts = countAccountLines(lines);
    const report = await recordAuditEvent(getDb(), {
      actorStaffUserId: actor.id,
      action: "staff.members_invited",
      entityType: "staff_user",
      entityId: null,
      metadata: { added: added.length, existing: existing.length, ...counts, accounts: lines },
      now: new Date(),
    });
    outcome = {
      saved: "membersInvited",
      count: String(added.length),
      ...(existing.length > 0 ? { retried: String(existing.length) } : {}),
      ...(counts.failed > 0 ? { failed: String(counts.failed) } : {}),
      ...(lines.length > 0 ? { report } : {}),
    };
    // A green tick only when every account exists; otherwise the banner and the report say which did not.
    toast = counts.failed > 0 ? {} : outcome;
  } catch (error) {
    const refusal = refused(error, form);
    if (refusal.error === "VALIDATION_ERROR") {
      const invalid = invalidAddresses(rows.map((row) => row.email));
      if (invalid.length > 0) return { ...refusal, error: "INVALID_ADDRESSES", errorValues: { addresses: invalid.join(", ") } };
      if (rows.length > MEMBER_ROWS_MAX) return { ...refusal, error: "TOO_MANY_ADDRESSES", errorValues: { max: String(MEMBER_ROWS_MAX) } };
    }
    if (refusal.error === "CONFLICT") {
      const onTeam = (
        await findStaffUsersAmong(
          getDb(),
          rows.map((row) => row.email),
        )
      )
        .filter((row) => isBackofficeRole(row.role))
        .map((row) => row.email);
      if (onTeam.length > 0) return { ...refusal, error: "MEMBERS_ON_TEAM", errorValues: { addresses: onTeam.join(", ") } };
    }
    return refusal;
  }

  return backTo(path, outcome, toast);
}

/** The invitation again, for somebody whose first one is lost (§123). */
export async function resendStaffInviteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  // The toast's sentence: «pleacă acum» when the press sent it past the scheduled pass (§540).
  let toast: Record<string, string | undefined> | undefined;
  try {
    const actor = await requireStaffCapability(canManageStaff);
    // The platform's own invitation again (§141), then Zitadel's password link where the key is set (§123).
    // «Trimite acum» or «Pune la coadă» (§540): the dialog's answer, the queue when none was offered.
    const delivery = deliveryChoiceOf(form.get(DELIVERY_CHOICE_FIELD));
    const member = await resendStaffInvitation(getDb(), actor, text(form, "email"), new Date(), delivery);
    const invite = env.STAFF_AUTH_MODE === "provider" ? await resendZitadelInvite(member.email) : ({ kind: "unconfigured" } as const);
    outcome = { saved: "reinvited", invite: invite.kind, ...(invite.kind === "failed" ? { reason: invite.reason.slice(0, 120) } : {}) };
    // The provider's answer rides along: a failed or unconfigured Zitadel invite holds the green toast back (§171, §288).
    if (delivery === "now") toast = { ...outcome, saved: "reinvitedNow" };
  } catch (error) {
    // A «now» the day's allowance cannot hold says so in its own sentence (§80, §540).
    outcome = isDomainError(error) ? { error: sendNowRefusalCode(error) } : outcomeOf(error);
  }
  return backTo(path, outcome, toast);
}

/**
 * The password link, for somebody who has signed in before and cannot now (§171).
 *
 * Zitadel sends the mail and owns the code. Nothing here reads, sets or transports a password,
 * and the allowlist is untouched: this is about the account, not about who is staff.
 */
export async function sendStaffPasswordResetAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  try {
    const actor = await requireStaffCapability(canManageStaff);
    // A colleague on the list, and one this actor may manage — never a Superadministrator's
    // account for an Administrator (§450); the provider is asked for the row's own address.
    const member = await assertMayManageAccount(getDb(), actor, text(form, "email"));
    const result =
      env.STAFF_AUTH_MODE === "provider"
        ? await sendZitadelPasswordReset(member.email)
        : ({ kind: "unconfigured" } as const);
    outcome = { saved: "passwordReset", account: result.kind, ...(result.kind === "failed" ? { reason: result.reason.slice(0, 120) } : {}) };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(path, outcome);
}

/**
 * The account at the provider, off or on (§171).
 *
 * Deliberately not folded into "withdraw access": that removes the `staff_users` row, which is
 * what stops the backoffice letting somebody in (`AGENTS.md` §13), and it is the right verb for
 * a colleague who changed job inside the club. This one is for a colleague who left.
 */
export async function setStaffAccountActiveAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  try {
    const actor = await requireStaffCapability(canManageStaff);
    const active = form.get("active") === "1";
    // The same question as the password link (§450): an Administrator who could switch the
    // owner's account off could lock the platform's settings away from everybody.
    const member = await assertMayManageAccount(getDb(), actor, text(form, "email"));
    const result =
      env.STAFF_AUTH_MODE === "provider"
        ? await setZitadelUserActive(member.email, active)
        : ({ kind: "unconfigured" } as const);
    outcome = {
      saved: active ? "accountReactivated" : "accountDeactivated",
      account: result.kind,
      ...(result.kind === "failed" ? { reason: result.reason.slice(0, 120) } : {}),
    };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(path, outcome);
}

export async function changeStaffRoleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageStaff);
    await changeStaffRole(getDb(), actor, text(form, "staffUserId"), text(form, "role") as StaffRole);
    outcome = { saved: "role" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(path, outcome);
}

/**
 * «Gestionează magazinul» on a colleague's row of «Echipa» (§NNN): ticked or unticked, asked first,
 * then a toast. The permission is a closed set — never a name taken from the POST — and the service
 * asserts `canGrantPermission` again on the row it reads (BR-REQ-060-01).
 */
export async function setStaffPermissionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  const posted = text(form, "permission");
  const on = text(form, "on") === "1";

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageStaff);
    const permission = STAFF_PERMISSIONS.find((known) => known === posted);
    if (!permission) throw new DomainError("VALIDATION_ERROR", "no such permission");
    await setStaffPermission(getDb(), actor, { targetId: text(form, "staffUserId"), permission, on });
    outcome = { saved: on ? "staffPermissionGranted" : "staffPermissionRevoked" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(path, outcome);
}

export async function revokeStaffAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageStaff);
    await revokeStaffUser(getDb(), actor, text(form, "staffUserId"));
    outcome = { saved: "revoked" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(path, outcome);
}

/**
 * Sign in as one of the synthetic development identities (AGENTS.md §13.1).
 *
 * Guarded twice: `assertDevStaffSwitcherEnabled` refuses unless `STAFF_AUTH_MODE` is the
 * switcher, and that mode fails at startup outside local and test. In qa and production this
 * action exists but can do nothing — there, sign-in is Zitadel.
 */
export async function signInAsDevIdentityAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));

  let outcome: { error?: string; saved?: string } | undefined;
  let landing: "/admin" | "/members-area" = "/admin";
  try {
    assertDevStaffSwitcherEnabled();
    const staffUser = await ensureDevStaffUser(getDb(), text(form, "identity") as DevIdentityKey);

    (await cookies()).set(DEV_STAFF_COOKIE, staffUser.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    // Where the provider's sign-in would land (§524): the page the person came from, and a member
    // always the members' zone.
    landing = landingFor(staffUser.role, signInTargetOf(text(form, "to")));
  } catch (error) {
    outcome = outcomeOf(error);
  }

  if (outcome) return backTo(getPathname({ locale, href: "/sign-in" }), outcome);
  return backTo(getPathname({ locale, href: landing }), {});
}

/**
 * Sign out of whichever mechanism issued the session.
 *
 * Both, in order, rather than one or the other: the dev cookie is deleted unconditionally
 * because a stale one left behind on a machine that has since switched modes is a session
 * nobody meant to keep, and Auth.js's own `signOut` is what clears the JWT it issued. Deleting
 * the cookie alone left a signed-in Zitadel session with a sign-out button that did nothing.
 */
export async function signOutAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  // Signing out of the members' zone lands on the members' page, not the team's door (§524).
  const after = signInTargetOf(text(form, "from")) === "members" ? "/members" : "/sign-in";
  (await cookies()).delete(DEV_STAFF_COOKIE);

  if (env.STAFF_AUTH_MODE === "provider") {
    // `signOut` performs the redirect itself.
    await signOut({ redirectTo: getPathname({ locale, href: after }) });
  }

  return backTo(getPathname({ locale, href: after }), {});
}
