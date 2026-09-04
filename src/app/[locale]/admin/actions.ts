"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  saveEventFields,
  saveEventTranslation,
  transitionTranslation,
} from "@/modules/content/events/service";
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

export async function saveTranslationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = getPathname({
    locale,
    href: { pathname: "/admin/events/[id]", params: { id: eventId } },
  });

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

export async function transitionAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const path = getPathname({
    locale,
    href: { pathname: "/admin/events/[id]", params: { id: eventId } },
  });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await transitionTranslation(getDb(), {
      actor,
      translationId: text(form, "translationId"),
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
  const path = getPathname({
    locale,
    href: { pathname: "/admin/events/[id]", params: { id: eventId } },
  });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await saveEventFields(getDb(), {
      actor,
      eventId,
      fields: {
        startsAtWallTime: text(form, "startsAtWallTime"),
        raceStartsAtWallTime: text(form, "raceStartsAtWallTime"),
        mapUrl: text(form, "mapUrl"),
        featured: form.get("featured") === "on",
      },
    });
    outcome = { saved: "event" };
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
 * action exists but can do nothing, which is the honest state until the staff login lands.
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

export async function signOutAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  (await cookies()).delete(DEV_STAFF_COOKIE);
  backTo(getPathname({ locale, href: "/sign-in" }), {});
}
