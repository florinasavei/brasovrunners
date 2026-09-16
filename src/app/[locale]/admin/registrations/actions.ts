"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  cancelRegistrationByStaff,
  correctRegisteredName,
  createRegistrationByStaff,
  deleteRegistrationByStaff,
} from "@/modules/registrations/admin-service";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The three administrative changes to a registration (BR-REQ-037-03, BR-REQ-037-05).
 *
 * Each one starts with `requireStaffRole("ADMIN")` — the coarse gate, so a non-Administrator
 * never reaches the service — and the service asserts the role again for callers that are not
 * these actions. BR-REQ-060-01 criterion 4: a replayed POST never went past the page's own
 * guard at all.
 *
 * Failures come back as a language-neutral code in the query string, which the backoffice
 * translates, exactly as `admin/actions.ts` does.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function detailPath(locale: Locale, registrationId: string): string {
  return getPathname({
    locale,
    href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } },
  });
}

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
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

/** An unanswered field on the staff form is absent, not empty (BR-REQ-031-04 criterion 5). */
function optional(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function createRegistrationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await createRegistrationByStaff(
      getDb(),
      actor,
      {
        eventId,
        firstName: text(form, "firstName"),
        lastName: text(form, "lastName"),
        // BR-REQ-031-04 criterion 5: blank is a legitimate answer here. `optional` turns an
        // empty field into `undefined` so the staff schema sees an absent value rather than
        // an empty string it would have to reject.
        details: {
          displayName: optional(form, "displayName"),
          birthDate: optional(form, "birthDate"),
          sex: optional(form, "sex") as "FEMALE" | "MALE" | "UNSPECIFIED" | undefined,
          nationality: optional(form, "nationality"),
          city: optional(form, "city"),
          phone: optional(form, "phone"),
          emergencyContactName: optional(form, "emergencyContactName"),
          emergencyContactPhone: optional(form, "emergencyContactPhone"),
          clubName: optional(form, "clubName"),
          clubMemberDeclared: form.get("clubMemberDeclared") === "on",
          tshirtSize: optional(form, "tshirtSize") as
            | "NONE"
            | "XS"
            | "S"
            | "M"
            | "L"
            | "XL"
            | "XXL"
            | undefined,
        },
        email: text(form, "email"),
        locale: toLocale(form.get("participantLocale")),
        listOptOut: form.get("listOptOut") === "on",
        relayedByParticipantRequest: form.get("relayedByParticipantRequest") === "on",
      },
      new Date(),
    );
    outcome = { saved: "registrationCreated" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // A failure goes back to the form, which still has the event preselected; a success goes to
  // the list, where the new row is visible with the status it actually landed in.
  if (outcome.error) {
    backTo(`${getPathname({ locale, href: "/admin/registrations/new" })}?eventId=${eventId}`, outcome);
  }
  backTo(getPathname({ locale, href: "/admin/registrations" }), outcome);
}

export async function correctRegisteredNameAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await correctRegisteredName(getDb(), actor, registrationId, text(form, "registeredName"), new Date());
    outcome = { saved: "nameCorrected" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(detailPath(locale, registrationId), outcome);
}

export async function cancelRegistrationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await cancelRegistrationByStaff(getDb(), actor, registrationId, text(form, "reason"), new Date());
    outcome = { saved: "registrationCancelled" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(detailPath(locale, registrationId), outcome);
}

/**
 * Cancel several registrations at once, with one reason (BR-REQ-037-03, §15.11).
 *
 * The one bulk verb that earns its place. Race morning produces a handful of people who told an
 * organizer they are not running, and cancelling them one at a time is five round-trips through
 * a list that re-sorts underneath you. Nothing about the operation is new: each row goes through
 * `cancelRegistrationByStaff` exactly as it does singly, so each releases its place through the
 * allocator and each writes its own `audit_logs` row. Only the typing is shared.
 *
 * Cancel and nothing else. Erasing is not offered in bulk on purpose — it is the one action that
 * takes the declaration with it, and a mis-ticked checkbox should not be able to do that to
 * twenty people at once.
 *
 * One failure does not abandon the rest: a row somebody else already cancelled would otherwise
 * silently strand the remaining ones, so each is attempted and the outcome is counted.
 */
export async function bulkCancelRegistrationsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const ids = form
    .getAll("registrationId")
    .filter((value): value is string => typeof value === "string" && value !== "");
  const reason = text(form, "reason");

  const listPath = getPathname({ locale, href: "/admin/registrations" });
  /*
    The list's own query string comes back as a field so the organizer returns to the filtered,
    sorted page they acted from. Only the query is carried, never a path: a redirect target
    taken from a form is an open redirect, and rebuilding the path here from `getPathname`
    means the field can only ever choose which rows are shown.
  */
  const listQuery = text(form, "listQuery");
  const returnTo = listQuery ? `${listPath}?${listQuery}` : listPath;

  if (ids.length === 0) {
    backTo(returnTo, { error: "NOTHING_SELECTED" });
  }

  let cancelled = 0;
  let failed = 0;
  try {
    const actor = await requireStaffRole("ADMIN");
    const db = getDb();
    const now = new Date();

    for (const registrationId of ids) {
      try {
        await cancelRegistrationByStaff(db, actor, registrationId, reason, now);
        cancelled += 1;
      } catch (error) {
        if (!isDomainError(error)) throw error;
        failed += 1;
      }
    }
  } catch (error) {
    backTo(returnTo, outcomeOf(error));
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(
    `${returnTo}${separator}saved=registrationsCancelled&cancelled=${cancelled}&failed=${failed}#admin-alert`,
  );
}

export async function deleteRegistrationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("ADMIN");
    await deleteRegistrationByStaff(getDb(), actor, registrationId, text(form, "reason"), new Date());
    outcome = { saved: "registrationDeleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // Always back to the list, never to the detail page: on success that page describes a row
  // that no longer exists, and a 404 is a poor way to learn a deletion worked.
  backTo(getPathname({ locale, href: "/admin/registrations" }), outcome);
}
