"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  bulkCancelRegistrationsByStaff,
  cancelRegistrationByStaff,
  checkInByStaff,
  confirmRegistrationByStaff,
  correctRegisteredName,
  createRegistrationByStaff,
  deleteRegistrationByStaff,
  promoteRegistrationByStaff,
  bulkDeleteRegistrationsByStaff,
  setBibNumberByStaff,
} from "@/modules/registrations/admin-service";
import { markBibsPrinted, setBibPrinted } from "@/modules/registrations/bibs";
import { UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
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
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

/**
 * Where a desk verb sends the browser back (BR-REQ-037-08): the row it acted on, wherever that
 * row was shown — the desk's search, the page one scanned code opens, or the registration's
 * own page. Rebuilt from `getPathname` and a handful of fields, never taken from the form as a
 * path: a redirect target typed into a form is an open redirect.
 */
function returnTo(
  form: FormData,
  locale: Locale,
  registrationId: string,
): { path: string; params: Record<string, string | undefined> } {
  const back = text(form, "back");
  if (back === "desk") {
    return {
      path: getPathname({ locale, href: "/admin/checkin" }),
      params: { eventId: text(form, "eventId") || undefined, q: text(form, "q") || undefined },
    };
  }
  if (back === "code" && text(form, "code")) {
    return {
      path: getPathname({ locale, href: { pathname: "/admin/checkin/[code]", params: { code: text(form, "code") } } }),
      params: {},
    };
  }
  return { path: detailPath(locale, registrationId), params: {} };
}

/** `backTo`, for a desk verb: the page's own query first, then the outcome. */
function backToDesk(form: FormData, locale: Locale, registrationId: string, outcome: Record<string, string | undefined>): never {
  const target = returnTo(form, locale, registrationId);
  backTo(target.path, { ...target.params, ...outcome });
}

/**
 * The desk verbs (BR-REQ-037-07, BR-REQ-037-08). Every staff role, because the desk is where a
 * volunteer works — the service asserts `canWorkTheDesk` again for anything that is not this
 * action. Each redirects with the outcome so the desk reads a sentence, not a stack trace.
 */
export async function confirmRegistrationNowAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    const result = await confirmRegistrationByStaff(getDb(), actor, registrationId, new Date());
    outcome = { saved: result.status === "CONFIRMED" ? "registrationConfirmed" : "registrationWaitlisted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backToDesk(form, locale, registrationId, outcome);
}

export async function promoteRegistrationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await promoteRegistrationByStaff(getDb(), actor, registrationId, new Date());
    outcome = { saved: "registrationConfirmed" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backToDesk(form, locale, registrationId, outcome);
}

export async function setBibNumberAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  const raw = text(form, "bibNumber").trim();

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    // An empty field clears the number; anything else must be a whole number, which the
    // service checks — `Number("")` would be 0 and a lie.
    const bibNumber = raw === "" ? null : Number(raw);
    await setBibNumberByStaff(getDb(), actor, registrationId, bibNumber, new Date());
    outcome = { saved: "bibSet" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backToDesk(form, locale, registrationId, outcome);
}

export async function checkInAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  const direction = text(form, "direction") === "undo" ? "undo" : "in";

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await checkInByStaff(getDb(), actor, registrationId, direction, new Date());
    outcome = { saved: direction === "in" ? "checkedIn" : "checkinUndone" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backToDesk(form, locale, registrationId, outcome);
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
    // Every role: a walk-in on race morning is entered by the volunteer at the table
    // (BR-REQ-037-07). The service asserts the same.
    const actor = await requireStaff();
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
        listOptOut: form.get("listOptIn") !== "on",
        relayedByParticipantRequest: form.get("relayedByParticipantRequest") === "on",
        fastTrack: form.get("fastTrack") === "on",
      },
      new Date(),
    );
    outcome = { saved: "registrationCreated" };
  } catch (error) {
    /*
      Under fourteen on the race day (§NNN) is the one refusal here about a fact the volunteer
      typed and can check with the person in front of them, so it says so — the generic "check
      what you entered" would send them hunting through a form that is correct.
    */
    outcome =
      isDomainError(error) && error.fields.includes(UNDER_MINIMUM_AGE)
        ? { error: "UNDER_MINIMUM_AGE" }
        : outcomeOf(error);
  }

  // A failure goes back to the form, which still has the event preselected; a success goes to
  // where the new row is visible with the status it actually landed in — the desk, when the
  // form was opened from there, otherwise the list.
  const fromDesk = text(form, "back") === "desk";
  if (outcome.error) {
    backTo(getPathname({ locale, href: "/admin/registrations/new" }), {
      ...outcome,
      eventId,
      back: fromDesk ? "desk" : undefined,
    });
  }
  if (fromDesk) {
    backTo(getPathname({ locale, href: "/admin/checkin" }), { ...outcome, eventId });
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
/**
 * "These bibs are on paper now" (§264; the owner: "să pot marca 'BID printat'").
 *
 * A press of its own, next to the download and not inside it: the sheet is a `GET` and a GET
 * does not mutate (`AGENTS.md` §12.8) — and a PDF that downloaded is not a bib that printed.
 *
 * The scope is the event's, not a selection: `only=unprinted` marks exactly the batch the button
 * beside it downloads, which is the club's actual weekly job. Marking is idempotent, so pressing
 * it twice does not rewrite when the first batch was printed (`markBibsPrinted`).
 */
export async function markBibsPrintedAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const printed = text(form, "printed") !== "0";
  const only = text(form, "only") === "unprinted" ? ("unprinted" as const) : undefined;

  const listPath = getPathname({ locale, href: "/admin/registrations" });
  // The query and never a path, exactly as the bulk cancel below: a form-supplied path is an
  // open redirect, and this field can only choose which rows come back.
  const listQuery = text(form, "listQuery");
  const returnTo = listQuery ? `${listPath}?${listQuery}` : listPath;

  let outcome: { error?: string; saved?: string; marked?: string };
  try {
    const actor = await requireStaff();
    const { marked } = await markBibsPrinted(getDb(), { actor, eventId, scope: { only }, printed });
    outcome = { saved: printed ? "bibsPrinted" : "bibsUnprinted", marked: String(marked) };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  const query = new URLSearchParams(
    Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][],
  ).toString();
  redirect(`${returnTo}${separator}${query}#admin-alert`);
}

/** One bib, marked printed or not — the reprint of a single creased number (§264). */
export async function setBibPrintedAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  const printed = text(form, "printed") !== "0";

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setBibPrinted(getDb(), { actor, registrationId, printed });
    outcome = { saved: printed ? "bibsPrinted" : "bibsUnprinted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backToDesk(form, locale, registrationId, outcome);
}

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
  let voided: number[] = [];
  try {
    const actor = await requireStaffRole("ADMIN");
    ({ cancelled, failed, voided } = await bulkCancelRegistrationsByStaff(getDb(), actor, ids, reason, new Date()));
  } catch (error) {
    backTo(returnTo, outcomeOf(error));
  }

  // The printed numbers this press just made void (§311), for the banner to name: numbers only,
  // which is all the page needs to say which bibs come out of the pile.
  const separator = returnTo.includes("?") ? "&" : "?";
  const voidedQuery = voided.length > 0 ? `&voided=${voided.join(",")}` : "";
  redirect(
    `${returnTo}${separator}saved=registrationsCancelled&cancelled=${cancelled}&failed=${failed}${voidedQuery}#admin-alert`,
  );
}

/**
 * Erase everything selected (`DECISIONS.md` §287), behind the count typed by hand.
 *
 * The shape of `bulkCancelRegistrationsAction` above, with one difference that matters: the
 * confirmation is asserted by the service, not here, so the rule survives a second caller and a
 * dialog that is one day rewritten.
 */
export async function bulkDeleteRegistrationsAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const ids = form
    .getAll("registrationId")
    .filter((value): value is string => typeof value === "string" && value !== "");
  const reason = text(form, "reason");
  const confirmCount = text(form, "confirmCount");

  const listPath = getPathname({ locale, href: "/admin/registrations" });
  // Only the query, never a path: a redirect target taken from a form is an open redirect.
  const listQuery = text(form, "listQuery");
  const returnTo = listQuery ? `${listPath}?${listQuery}` : listPath;

  let erased = 0;
  let failed = 0;
  try {
    const actor = await requireStaffRole("ADMIN");
    ({ erased, failed } = await bulkDeleteRegistrationsByStaff(
      getDb(),
      actor,
      ids,
      reason,
      new Date(),
      { confirmCount },
    ));
  } catch (error) {
    backTo(returnTo, outcomeOf(error));
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}saved=registrationsErased&erased=${erased}&failed=${failed}#admin-alert`);
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

/**
 * Erase one registration from the list, with its name typed out (BR-REQ-037-06, §180).
 *
 * The owner, three times: "vreau sa pot sterge si participantii". He is the club's data
 * controller and the rows are his. What was missing was never the permission — it was the
 * *reach*: erasure existed only on a registration's own page, so clearing eighty test rows was
 * eighty round trips through a list that re-sorts underneath you.
 *
 * A second entrance, not a second erase. Every word of what erasing means —
 * releasing the place through the allocator, the audit row written before the delete and
 * outliving it, the declaration acceptance going in the same transaction, the participant going
 * with their last registration — is `deleteRegistrationByStaff` and is untouched. This function
 * adds exactly two things the detail page does not need:
 *
 * 1. **The typed name is compulsory here.** `deleteRegistrationAction` accepts a ticked box
 *    because you reached that page by choosing that person. A list row is one line from its
 *    neighbour, so the confirmation has to be one a reflex cannot answer. It is read here and
 *    checked in the service against the row the deletion is built on — never against a second
 *    fetch that could disagree with it. Refusing the empty case *before* the service is not a
 *    duplicate of that check: it is what stops an empty field spending a database round trip,
 *    and the service refuses it too.
 * 2. **It comes back to the list you were on.** Only the query travels, in a field; the path is
 *    rebuilt from `getPathname` here, so the field can choose which rows are shown and can never
 *    become an open redirect — the same rule `bulkCancelRegistrationsAction` follows.
 *
 * One row at a time, on purpose. See the note on `bulkCancelRegistrationsAction`: cancelling in
 * bulk is recoverable — the person registers again — and erasing is not.
 */
export async function eraseRegistrationFromListAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  const confirmName = text(form, "confirmName");
  const listPath = getPathname({ locale, href: "/admin/registrations" });

  /*
    Merged into the list's own query rather than appended to it. `backTo` builds a query string
    and joins it with a bare "?", which is right for the paths it was written for — a detail page
    with no query of its own — and wrong for a return to a filtered, sorted, paginated list,
    where it would produce `?eventId=…?error=…` and lose both.
  */
  const params = new URLSearchParams(text(form, "listQuery"));
  const land = (outcome: Record<string, string | undefined>): never => {
    for (const [key, value] of Object.entries(outcome)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    redirect(query ? `${listPath}?${query}#admin-alert` : `${listPath}#admin-alert`);
  };

  /*
    Refused before the database is touched, and the panel reopens on the same row.

    Not a duplicate of the service's own check: that one compares against the registration, this
    one is what stops an empty field spending a round trip. Both have to exist, because the
    `required` attribute on the field is a courtesy the browser may not be running.

    What does *not* come back is the reason that was typed. Carrying it would mean putting a free
    line of somebody's prose into a query string, and from there into the server log, the browser
    history and any referrer — for an action whose entire purpose is to remove a person's data.
    Re-typing a few words is the cheaper of the two.
  */
  if (confirmName.trim() === "") {
    land({ error: "ERASE_NAME_MISMATCH", erase: registrationId || undefined, saved: undefined });
  }

  try {
    const actor = await requireStaffRole("ADMIN");
    await deleteRegistrationByStaff(getDb(), actor, registrationId, text(form, "reason"), new Date(), {
      confirmName,
    });
  } catch (error) {
    const failure = outcomeOf(error);
    // A mistyped name is the one failure that is about what was typed rather than about the
    // registration, so it says so and leaves the panel open on the same row — with the reason
    // to type again, for the reason above. Every other code stays what the service called it.
    const mistyped = isDomainError(error) && error.fields.includes("confirmName");
    land({
      error: mistyped ? "ERASE_NAME_MISMATCH" : failure.error,
      erase: mistyped ? registrationId : undefined,
      saved: undefined,
    });
  }

  land({ saved: "registrationDeleted", error: undefined, erase: undefined });
}

/**
 * "Send now" — drain the outbox from the list page, within the day's allowance
 * (`DECISIONS.md` §80). Lands back on the list with the count it sent, or the refusal.
 */
export async function sendOutboxNowAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin/registrations" });
  const listQuery = text(form, "listQuery");
  const returnTo = listQuery ? `${listPath}?${listQuery}` : listPath;

  let sent = 0;
  try {
    const actor = await requireStaffRole("ADMIN");
    const result = await sendOutboxNow(getDb(), actor, new Date());
    sent = result.sent;
  } catch (error) {
    backTo(returnTo, outcomeOf(error));
  }
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=outboxSent&sent=${sent}#admin-alert`);
}

