"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  saveEventFields,
  saveEventTranslation,
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
  redirect(query ? `${path}?${query}` : path);
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
 */
function eventFieldsFrom(form: FormData) {
  return {
    kind: text(form, "kind"),
    eventStatus: text(form, "eventStatus"),
    timezone: text(form, "timezone"),
    startsAtWallTime: text(form, "startsAtWallTime"),
    endsAtWallTime: text(form, "endsAtWallTime"),
    raceStartsAtWallTime: text(form, "raceStartsAtWallTime"),
    latitude: text(form, "latitude"),
    longitude: text(form, "longitude"),
    mapUrl: text(form, "mapUrl"),
    distanceMeters: text(form, "distanceMeters"),
    elevationGainMeters: text(form, "elevationGainMeters"),
    featured: form.get("featured") === "on",
    registrationMode: text(form, "registrationMode"),
    capacity: text(form, "capacity"),
    registrationOpensAtWallTime: text(form, "registrationOpensAtWallTime"),
    registrationClosesAtWallTime: text(form, "registrationClosesAtWallTime"),
    declarationDocumentId: text(form, "declarationDocumentId"),
    externalProvider: text(form, "externalProvider"),
    externalRegistrationUrl: text(form, "externalRegistrationUrl"),
  };
}

export async function saveTranslationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = editorPath(locale, text(form, "eventId"));

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await saveEventTranslation(getDb(), {
      actor,
      translationId: text(form, "translationId"),
      expectedVersion: Number(text(form, "expectedVersion")),
      acknowledgeLiveEdit: form.get("acknowledgeLiveEdit") === "on",
      fields: {
        slug: text(form, "slug"),
        title: text(form, "title"),
        excerpt: text(form, "excerpt"),
        locationName: text(form, "locationName"),
        locationAddress: text(form, "locationAddress"),
        difficultyLabel: text(form, "difficultyLabel"),
        costText: text(form, "costText"),
        seoTitle: text(form, "seoTitle"),
        seoDescription: text(form, "seoDescription"),
      },
    });
    outcome = { saved: "translation" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
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

export async function saveEventAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = editorPath(locale, eventId);

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await saveEventFields(getDb(), {
      actor,
      eventId,
      expectedVersion: Number(text(form, "expectedVersion")),
      fields: eventFieldsFrom(form),
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
            slug: text(form, "ro.slug"),
            title: text(form, "ro.title"),
            excerpt: text(form, "ro.excerpt"),
            locationName: text(form, "ro.locationName"),
          },
          en: {
            slug: text(form, "en.slug"),
            title: text(form, "en.title"),
            excerpt: text(form, "en.excerpt"),
            locationName: text(form, "en.locationName"),
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
