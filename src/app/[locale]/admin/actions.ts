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
  saveEventAndTranslations,
  transitionEvent,
} from "@/modules/content/events/service";
import {
  addTestRegistrations,
  removeTestRegistrations,
} from "@/modules/registrations/test-registrations";
import {
  assertDevStaffSwitcherEnabled,
  type DevIdentityKey,
  ensureDevStaffUser,
} from "@/modules/staff-identity/dev-switcher";
import type { EditorialStatus, StaffRole } from "@/modules/staff-identity/domain/roles";
import { DEV_STAFF_COOKIE, requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import {
  changeStaffRole,
  inviteStaffUser,
  revokeStaffUser,
} from "@/modules/staff-identity/service";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

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
function backTo(path: string, outcome: { error?: string; saved?: string }): never {
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

  return {
    kind: value("kind"),
    eventStatus: value("eventStatus"),
    timezone: value("timezone"),
    startsAtWallTime: value("startsAtWallTime"),
    endsAtWallTime: value("endsAtWallTime"),
    raceStartsAtWallTime: value("raceStartsAtWallTime"),
    latitude: value("latitude"),
    longitude: value("longitude"),
    // One value for the whole event (`DECISIONS.md` §36), so they arrive with the event half.
    locationName: value("locationName"),
    locationAddress: value("locationAddress"),
    difficultyLabel: value("difficultyLabel"),
    costText: value("costText"),
    mapUrl: value("mapUrl"),
    distanceMeters: value("distanceMeters"),
    elevationGainMeters: value("elevationGainMeters"),
    featured: form.get("event.featured") === "on",
    registrationMode: value("registrationMode"),
    capacity: value("capacity"),
    registrationOpensAtWallTime: value("registrationOpensAtWallTime"),
    registrationClosesAtWallTime: value("registrationClosesAtWallTime"),
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
      seoTitle: value("seoTitle"),
      seoDescription: value("seoDescription"),
    },
  };
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

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    const editsEventRow = text(form, "event.expectedVersion") !== "";

    await saveEventAndTranslations(getDb(), {
      actor,
      eventId,
      fields: editsEventRow ? eventFieldsFrom(form) : undefined,
      expectedVersion: editsEventRow ? Number(text(form, "event.expectedVersion")) : undefined,
      translations: routing.locales
        .map((contentLocale) => translationFieldsFrom(form, contentLocale))
        .filter((entry) => entry !== undefined),
      acknowledgeLiveEdit: form.get("acknowledgeLiveEdit") === "on",
    });
    outcome = { saved: "event" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function createEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));

  let createdId: string | undefined;
  let outcome: { error?: string; saved?: string } | undefined;
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
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // A failed create goes back to the form it came from; a successful one opens the new event,
  // which is where every field the short form did not ask for is filled in.
  if (outcome) backTo(getPathname({ locale, href: "/admin/events/new" }), outcome);
  backTo(editorPath(locale, createdId as string), { saved: "created" });
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

export async function inviteStaffAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/staff" });

  let outcome: { error?: string; saved?: string };
  try {
    // The coarse gate first, so a non-Administrator never reaches the service; the service
    // asserts it again for callers that are not this action.
    const actor = await requireStaffRole("ADMIN");
    await inviteStaffUser(getDb(), actor, {
      email: text(form, "email"),
      displayName: text(form, "displayName"),
      role: text(form, "role") as StaffRole,
      preferredLocale: toLocale(form.get("preferredLocale")),
    });
    outcome = { saved: "invited" };
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
