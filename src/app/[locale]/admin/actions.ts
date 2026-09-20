"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  hardDeleteEvent,
  repeatEvent,
  saveEventAndTranslations,
  SERIES_EDIT_SCOPES,
  type SeriesEditScope,
  stopRepeat,
  transitionEvent,
} from "@/modules/content/events/service";
import { REPEAT_CADENCES, type RepeatCadence, type Weekday, WEEKDAYS } from "@/modules/events/domain/repeat";
import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import {
  addTestRegistrations,
  removeTestRegistrations,
} from "@/modules/registrations/test-registrations";
import {
  assertDevStaffSwitcherEnabled,
  type DevIdentityKey,
  ensureDevStaffUser,
} from "@/modules/staff-identity/dev-switcher";
import { canDeleteEvent, type EditorialStatus, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { sendEventThanks } from "@/modules/notifications/event-mail";
import { DEV_STAFF_COOKIE, requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import {
  inviteZitadelUser,
  resendZitadelInvite,
  sendZitadelPasswordReset,
  setZitadelUserActive,
} from "@/modules/staff-identity/zitadel-users";
import {
  changeStaffRole,
  inviteStaffUser,
  resendStaffInvitation,
  revokeStaffUser,
} from "@/modules/staff-identity/service";
import { env } from "@/shared/config/env";
import { assignBibNumbers } from "@/modules/registrations/bibs";
import { withdrawInterest } from "@/modules/registrations/interest";
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
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Where the browser goes next, with either a success flag or an error code. */
function backTo(path: string, outcome: Record<string, string | undefined>): never {
  const query = new URLSearchParams(
    Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][],
  ).toString();
  // `#admin-alert` so the browser lands on the outcome rather than at the top of a long page,
  // where a one-line alert about a save that failed is easy to walk straight past. Every
  // backoffice page gives that id to its alert region; it costs no JavaScript.
  redirect(query ? `${path}?${query}#admin-alert` : path);
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
 * The whole event row as the form sends it — one reader, so the create form and the edit form
 * cannot drift apart in what they post. Every value stays a string here; `fields.ts` is what
 * turns "" into "not stated" and refuses the rest.
 *
 * The names are namespaced `event.*` because the editor is one form carrying the event row and
 * both languages together (`EventFieldsForm`, `TranslationFieldsForm`).
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
   * The partners (§168), posted as `event.coHosts[i].<box>` by `CoHostRowsEditor` — gathered
   * by index like the programme's rows above, blanks included; `fields.ts` drops the spare
   * line and refuses a page with no name beside it.
   */
  const coHosts: Array<Record<string, string>> = [];
  for (const [key, entry] of form.entries()) {
    const match = /^event\.coHosts\[(\d+)\]\.(name|url)$/.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    coHosts[index] = { ...(coHosts[index] ?? {}), [match[2]]: entry };
  }

  return {
    type: value("type"),
    // Optional, like difficulty below: "" from the unselected dropdown means "none".
    surface: value("surface") || null,
    eventStatus: value("eventStatus"),
    timezone: value("timezone"),
    startsAtWallTime: wallTime("startsAt"),
    endsAtWallTime: wallTime("endsAt"),
    durationMinutes: value("durationMinutes"),
    raceStartsAtWallTime: wallTime("raceStartsAt"),
    scheduleRows: scheduleRows.filter((row) => row !== undefined),
    stravaEventUrl: value("stravaEventUrl"),
    facebookEventUrl: value("facebookEventUrl"),
    coHosts: coHosts.filter((row) => row !== undefined),
    // One value for the whole event (`DECISIONS.md` §36), so they arrive with the event half.
    locationName: value("locationName"),
    // No box for it any more (`EventFieldsForm`); the field is folded into the meeting point.
    locationAddress: null,
    // Closed sets since migration `0018`. An unselected dropdown posts "", which `fields.ts`
    // reads as "the club has not said" rather than as an invalid value.
    difficulty: value("difficulty") || null,
    costType: value("costType") || null,
    mapUrl: value("mapUrl"),
    routeUrl: value("routeUrl"),
    distanceMeters: value("distanceMeters"),
    elevationGainMeters: value("elevationGainMeters"),
    featured: form.get("event.featured") === "on",
    // A checkbox like the one above it, and unlike it in every other way: any number of
    // events may be special (§168), so nothing is cleared when one is ticked.
    isSpecial: form.get("event.isSpecial") === "on",
    registrationMode: value("registrationMode"),
    capacity: value("capacity"),
    bibStartNumber: value("bibStartNumber"),
    bibColour: value("bibColour"),
    confirmationOpensDaysBefore: value("confirmationOpensDaysBefore"),
    confirmationDeadlineDaysBefore: value("confirmationDeadlineDaysBefore"),
    registrationOpensAtWallTime: wallTime("registrationOpensAt"),
    registrationClosesAtWallTime: wallTime("registrationClosesAt"),
    declarationDocumentId: value("declarationDocumentId"),
    // A checkbox, so an absent value is HIDDEN — the safe half of a disclosure switch.
    participantListVisibility:
      form.get("event.participantListVisibility") === "on" ? "NAMES" : "HIDDEN",
    externalProvider: value("externalProvider"),
    externalRegistrationUrl: value("externalRegistrationUrl"),
  };
}

/**
 * One language's text, read back out of the single form.
 *
 * A locale the actor may not edit renders no inputs at all, so `translationId` is absent and
 * this returns `undefined` — the save then carries nothing for that language rather than an
 * empty one, which is what would overwrite somebody's text with blanks.
 */
function translationFieldsFrom(form: FormData, locale: Locale) {
  const value = (field: string) => text(form, `translations.${locale}.${field}`);
  const translationId = value("translationId");
  if (translationId === "") return undefined;

  return {
    translationId,
    expectedVersion: Number(value("expectedVersion")),
    fields: {
      slug: value("slug"),
      title: value("title"),
      excerpt: value("excerpt"),
      excerptBody: value("excerptBody"),
      checklist: value("checklist"),
      body: value("body"),
      rules: value("rules"),
      schedule: value("schedule"),
      seoTitle: value("seoTitle"),
      seoDescription: value("seoDescription"),
    },
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
export async function transitionEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await transitionEvent(getDb(), {
      actor,
      eventId,
      expectedVersion: Number(text(form, "expectedVersion")),
      to: text(form, "to") as EditorialStatus,
    });
    outcome = { saved: text(form, "to") };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
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
  const listPath = getPathname({ locale, href: "/admin" });

  const selected = selectedEventRefs(form);

  if (selected.length === 0) {
    backTo(listPath, { error: "NOTHING_SELECTED" });
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
    backTo(listPath, outcomeOf(error));
  }

  redirect(`${listPath}?saved=eventsArchived&archived=${archived}&failed=${failed}#admin-alert`);
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
  const listPath = getPathname({ locale, href: "/admin" });

  const selected = selectedEventRefs(form);
  if (selected.length === 0) backTo(listPath, { error: "NOTHING_SELECTED" });

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
    backTo(listPath, outcomeOf(error));
  }

  redirect(`${listPath}?saved=eventsPublished&published=${published}&failed=${failed}#admin-alert`);
}

/**
 * Delete the ticked events (`DECISIONS.md` §114): the whole of a test series, the drafts of a
 * season that never happened. Administrator only, refused whole for anybody else; then each
 * event through `deleteEvent`, which refuses one with a registration against it — counted and
 * skipped, never forced, because archiving is the answer for an event that happened.
 */
export async function bulkDeleteEventsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin" });

  const selected = selectedEventRefs(form);
  if (selected.length === 0) backTo(listPath, { error: "NOTHING_SELECTED" });

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
    backTo(listPath, outcomeOf(error));
  }

  redirect(`${listPath}?saved=eventsDeleted&deleted=${deleted}&failed=${failed}#admin-alert`);
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
 */
export async function saveEventAndTranslationsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string; applied?: string; offered?: string };
  try {
    const actor = await requireStaff();
    const editsEventRow = text(form, "event.expectedVersion") !== "";
    // Which dates of the series (§130, §134): the dates ticked in the editor's header, or a
    // preset word; absent elsewhere. Ticks win — they are what the organizer sees.
    const ticked = form.getAll("dates").filter((value): value is string => typeof value === "string" && value !== "");
    const scope = text(form, "scope");

    const { appliedTo, offered } = await saveEventAndTranslations(getDb(), {
      actor,
      eventId,
      fields: editsEventRow ? eventFieldsFrom(form) : undefined,
      expectedVersion: editsEventRow ? Number(text(form, "event.expectedVersion")) : undefined,
      translations: routing.locales
        .map((contentLocale) => translationFieldsFrom(form, contentLocale))
        .filter((entry) => entry !== undefined),
      acknowledgeLiveEdit: form.get("acknowledgeLiveEdit") === "on",
      scope: ticked.length > 0 ? { ids: ticked } : SERIES_EDIT_SCOPES.includes(scope as (typeof SERIES_EDIT_SCOPES)[number]) ? (scope as SeriesEditScope) : "this",
    });
    // A raised capacity's offers (§147) ride on the same banner as a number; absent when none.
    outcome = {
      ...(appliedTo > 0 ? { saved: "eventSeries", applied: String(appliedTo) } : { saved: "event" }),
      offered: offered > 0 ? String(offered) : undefined,
    };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function createEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));

  let createdId: string | undefined;
  let repeated = 0;
  let outcome: { error?: string; saved?: string; created?: string } | undefined;
  try {
    const actor = await requireStaff();
    const created = await createEvent(getDb(), {
      actor,
      fields: {
        ...eventFieldsFrom(form),
        translations: {
          ro: {
            slug: text(form, "translations.ro.slug"),
            title: text(form, "translations.ro.title"),
            excerpt: text(form, "translations.ro.excerpt"),
          },
          en: {
            slug: text(form, "translations.en.slug"),
            title: text(form, "translations.en.title"),
            excerpt: text(form, "translations.en.excerpt"),
          },
        },
      },
    });
    createdId = created.id;

    // Recurrence, asked for on the creation form (`DECISIONS.md` §64): the same series the
    // event page offers, made right away, as drafts — a new event is a draft, and copies of a
    // draft are drafts. The list's "publish the ticked ones" takes the whole series live.
    // The tick decides whether this event repeats at all (§170); the cadence only says how.
    // Without it the recurrence fields are hidden, and a hidden field's value means nothing.
    const cadence = form.get("repeat.on") === "on" ? text(form, "repeat.cadence") : "";
    if (cadence && cadence !== "NONE") {
      if (!REPEAT_CADENCES.includes(cadence as RepeatCadence)) {
        throw new DomainError("VALIDATION_ERROR", "cadence: choose one of the listed cadences");
      }
      const result = await repeatEvent(getDb(), {
        actor,
        eventId: created.id,
        rule: { cadence: cadence as RepeatCadence, weekdays: weekdaysFrom(form), until: text(form, "repeat.until") || null, publish: false },
      });
      repeated = result.created;
    }
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // A failed create goes back to the form it came from; a successful one opens the new event,
  // which is where every field the short form did not ask for is filled in. A create that
  // succeeded but whose series did not opens the event too, with the series' own error.
  if (outcome && !createdId) backTo(getPathname({ locale, href: "/admin/events/new" }), outcome);
  if (outcome) backTo(editorPath(locale, createdId as string), outcome);
  backTo(editorPath(locale, createdId as string), {
    saved: "created",
    created: repeated > 0 ? String(repeated) : undefined,
  });
}

export async function duplicateEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));

  let copyId: string | undefined;
  let outcome: { error?: string; saved?: string } | undefined;
  try {
    const actor = await requireStaff();
    const copy = await duplicateEvent(getDb(), { actor, eventId: text(form, "eventId") });
    copyId = copy.id;
  } catch (error) {
    outcome = outcomeOf(error);
  }

  if (outcome) backTo(getPathname({ locale, href: "/admin" }), outcome);
  backTo(editorPath(locale, copyId as string), { saved: "duplicated" });
}

/** The ticked days of the week, ISO numbered, from the repeat fields (`RepeatFields`). */
function weekdaysFrom(form: FormData): Weekday[] {
  return form
    .getAll("weekday")
    .map((value) => Number(value))
    .filter((value): value is Weekday => (WEEKDAYS as readonly number[]).includes(value));
}

export async function repeatEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; created?: string };
  try {
    const actor = await requireStaff();
    // The tick is the answer to "does this repeat" (§170). The button that posts this form is
    // hidden until it is ticked, and this is the same rule asserted where it decides.
    if (form.get("repeatOn") !== "on") {
      throw new DomainError("VALIDATION_ERROR", "tick 'repeat this event' before creating a series");
    }
    const cadence = text(form, "cadence");
    if (!REPEAT_CADENCES.includes(cadence as RepeatCadence)) {
      throw new DomainError("VALIDATION_ERROR", "cadence: choose one of the listed cadences");
    }
    const result = await repeatEvent(getDb(), {
      actor,
      eventId,
      rule: { cadence: cadence as RepeatCadence, weekdays: weekdaysFrom(form), until: text(form, "until") || null, publish: form.get("publish") === "on" },
    });
    outcome = { saved: "eventsRepeated", created: String(result.created) };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // Back to the source: it now says how it repeats, and the list has the dates.
  backTo(editorPath(locale, eventId), outcome);
}

/** The series ends here: no further dates are made; the ones that exist stay (§122). */
export async function stopRepeatAction(form: FormData): Promise<void> {
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
  backTo(editorPath(locale, eventId), outcome);
}

/**
 * Race numbers for every confirmed registration of the event that has none yet
 * (BR-REQ-038-01). Lands back on the editor, where the sheet is downloaded from.
 */
export async function assignBibNumbersAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; assigned?: string; total?: string };
  try {
    const actor = await requireStaff();
    const result = await assignBibNumbers(getDb(), { actor, eventId });
    outcome = { saved: "bibsAssigned", assigned: String(result.assigned), total: String(result.total) };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(editorPath(locale, eventId), outcome);
}

/**
 * The thank-you after the race (`DECISIONS.md` §82): once per event, to everyone who was
 * checked in, with an optional link. Behind a confirmation on the page; audited by the service.
 */
export async function sendEventThanksAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string; recipients?: string };
  try {
    const actor = await requireStaff();
    const result = await sendEventThanks(getDb(), actor, { eventId, url: text(form, "url") }, new Date());
    outcome = { saved: "thanksSent", recipients: String(result.recipients) };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(editorPath(locale, eventId), outcome);
}

export async function deleteEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string };
  try {
    // The coarse gate first, so a non-Administrator never reaches the service; the service
    // asserts it again, and refuses any event that has a registration against it.
    const actor = await requireStaffRole("ADMIN");
    await deleteEvent(getDb(), { actor, eventId });
    outcome = { saved: "deleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // Deleted or not, the event list is where there is something to look at — the editor for a
  // deleted event is a 404.
  backTo(getPathname({ locale, href: "/admin" }), outcome);
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
 * On a refusal the browser goes back to the erase page with the code, so the screen that
 * explains what would be destroyed is what the organizer reads the refusal on. On success
 * there is no event to go back to, so the list is where it lands.
 */
export async function hardDeleteEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const erasePath = getPathname({
    locale,
    href: { pathname: "/admin/events/[id]/erase", params: { id: eventId } },
  });

  let erased = 0;
  try {
    const actor = await requireStaffRole("ADMIN");
    const result = await hardDeleteEvent(getDb(), {
      actor,
      eventId,
      typedTitle: text(form, "typedTitle"),
      reason: text(form, "reason"),
      now: new Date(),
    });
    erased = result.registrationsErased;
  } catch (error) {
    backTo(erasePath, outcomeOf(error));
  }

  redirect(
    `${getPathname({ locale, href: "/admin" })}?saved=eventErased&erased=${erased}#admin-alert`,
  );
}

export async function addTestRegistrationsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await addTestRegistrations(getDb(), actor, {
      eventId,
      count: Number(text(form, "count")),
      locale,
    });
    outcome = { saved: "testRegistrationsAdded" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function removeTestRegistrationsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await removeTestRegistrations(getDb(), actor, eventId);
    outcome = { saved: "testRegistrationsRemoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

/**
 * Withdrawal from "Anunță-mă" (§146), as the notice promises: an Administrator types the
 * address the person wrote from, and the row goes by its canonical identity. The address is
 * posted, never put in the URL; the outcome is a flag.
 */
export async function withdrawInterestAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    await requireStaffRole("ADMIN");
    const removed = await withdrawInterest(getDb(), eventId, text(form, "email"));
    outcome = { saved: removed ? "interestRemoved" : "interestNotFound" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function inviteStaffAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: Record<string, string | undefined>;
  try {
    // The coarse gate first, so a non-Administrator never reaches the service; the service
    // asserts it again for callers that are not this action.
    const actor = await requireStaffRole("ADMIN");
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
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

/** The invitation again, for somebody whose first one is lost (§123). */
export async function resendStaffInviteAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  try {
    const actor = await requireStaffRole("ADMIN");
    // The platform's own invitation again (§141), then Zitadel's password link where the key is set (§123).
    const member = await resendStaffInvitation(getDb(), actor, text(form, "email"));
    const invite = env.STAFF_AUTH_MODE === "provider" ? await resendZitadelInvite(member.email) : ({ kind: "unconfigured" } as const);
    outcome = { saved: "reinvited", invite: invite.kind, ...(invite.kind === "failed" ? { reason: invite.reason.slice(0, 120) } : {}) };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(path, outcome);
}

/**
 * The password link, for somebody who has signed in before and cannot now (§171).
 *
 * Zitadel sends the mail and owns the code. Nothing here reads, sets or transports a password,
 * and the allowlist is untouched: this is about the account, not about who is staff.
 */
export async function sendStaffPasswordResetAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  try {
    await requireStaffRole("ADMIN");
    const result =
      env.STAFF_AUTH_MODE === "provider"
        ? await sendZitadelPasswordReset(text(form, "email"))
        : ({ kind: "unconfigured" } as const);
    outcome = { saved: "passwordReset", account: result.kind, ...(result.kind === "failed" ? { reason: result.reason.slice(0, 120) } : {}) };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(path, outcome);
}

/**
 * The account at the provider, off or on (§171).
 *
 * Deliberately not folded into "withdraw access": that removes the `staff_users` row, which is
 * what stops the backoffice letting somebody in (`AGENTS.md` §13), and it is the right verb for
 * a colleague who changed job inside the club. This one is for a colleague who left.
 */
export async function setStaffAccountActiveAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });
  let outcome: Record<string, string | undefined>;
  try {
    await requireStaffRole("ADMIN");
    const active = form.get("active") === "1";
    const result =
      env.STAFF_AUTH_MODE === "provider"
        ? await setZitadelUserActive(text(form, "email"), active)
        : ({ kind: "unconfigured" } as const);
    outcome = {
      saved: active ? "accountReactivated" : "accountDeactivated",
      account: result.kind,
      ...(result.kind === "failed" ? { reason: result.reason.slice(0, 120) } : {}),
    };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(path, outcome);
}

export async function changeStaffRoleAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await changeStaffRole(getDb(), actor, text(form, "staffUserId"), text(form, "role") as StaffRole);
    outcome = { saved: "role" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function revokeStaffAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await revokeStaffUser(getDb(), actor, text(form, "staffUserId"));
    outcome = { saved: "revoked" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
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
  try {
    assertDevStaffSwitcherEnabled();
    const staffUser = await ensureDevStaffUser(getDb(), text(form, "identity") as DevIdentityKey);

    (await cookies()).set(DEV_STAFF_COOKIE, staffUser.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } catch (error) {
    outcome = outcomeOf(error);
  }

  if (outcome) backTo(getPathname({ locale, href: "/sign-in" }), outcome);
  backTo(getPathname({ locale, href: "/admin" }), {});
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
  (await cookies()).delete(DEV_STAFF_COOKIE);

  if (env.STAFF_AUTH_MODE === "provider") {
    // `signOut` performs the redirect itself.
    await signOut({ redirectTo: getPathname({ locale, href: "/sign-in" }) });
  }

  backTo(getPathname({ locale, href: "/sign-in" }), {});
}
