"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  cancelRegistrationByStaff,
  correctRegisteredName,
  createRegistrationByStaff,
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
