"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { inviteToEvent, readInvitationForecast, resendInvitation, withdrawInvitation } from "@/modules/registrations/admin-service";
import { confirmedCapacityOf, SUPPLEMENTARY_PLACE_UNCONFIRMED, supplementaryPlaceRefusalOutcome } from "@/modules/registrations/domain/capacity";
import { INVITATION_DAYS_DEFAULT, InvitationRefusal, parseInvitationLines } from "@/modules/registrations/domain/invitations";
import type { InvitationInvitee } from "@/modules/registrations/service";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { wholeDigits } from "@/shared/forms/whole-digits";

/**
 * Invitations by email (§NNN): the three presses of the «Invitații» section on an event's registrations
 * list. Each is the Administrator's (`canManageRegistrations`), asserted here, in the admin service and
 * in the service; the Organizer reads the section and is offered no verb (§289).
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event's registrations list, at the section, rebuilt from `getPathname` — never a path taken from the form. */
function sectionPath(locale: Locale, eventId: string): string {
  return `${getPathname({ locale, href: "/admin/registrations" })}?eventId=${encodeURIComponent(eventId)}`;
}

async function backToSection(locale: Locale, eventId: string, outcome: Record<string, string | undefined>): Promise<never> {
  await flashOutcome(outcome);
  const query = new URLSearchParams(Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][]).toString();
  redirect(`${sectionPath(locale, eventId)}${query ? `&${query}` : ""}#registrations-invitations`);
}

/**
 * What the send's island is handed back on a refusal: the marker and, when the refusal is about one
 * person of the list, that person's name as the Administrator typed it or the member's account carries
 * it — in the response, never in a URL (§14.5). `lines`: the typed lines that could not be read.
 * `forecast`: the capacity and the places free for invitations read again after the refusal
 * (`readInvitationForecast`), so the next press's dialog asks on the server's numbers — a refused send
 * is answered with state, not a redirect, and the page's own props would otherwise stay as they were
 * when it was drawn (the invitations review of 2026-10-03: «Apasă din nou» refused again until a reload).
 */
export type InvitationSendState = {
  error: string;
  person?: string | null;
  lines?: string;
  forecast?: { capacity: number | null; free: number | null } | null;
} | null;

/**
 * «Trimite invitațiile» (§NNN): the members ticked and the lines typed, one send. A line that is not a
 * name and an address is refused before anything is asked of the server; the service refuses the whole
 * list by the first person it cannot invite. On success, back to the section with the toast.
 */
export async function inviteAction(_previous: InvitationSendState, form: FormData): Promise<InvitationSendState> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const typed = parseInvitationLines(text(form, "typed"));
  if (typed.unread.length > 0) return { error: "INVITATION_UNREAD_LINE", lines: typed.unread.join(", ") };
  const people: InvitationInvitee[] = [
    ...form
      .getAll("member")
      .filter((value): value is string => typeof value === "string" && value !== "")
      .map((memberStaffUserId) => ({ name: "", email: "", memberStaffUserId })),
    ...typed.people.map((person) => ({ name: person.name, email: person.email })),
  ];
  const days = wholeDigits(text(form, "days")) ?? INVITATION_DAYS_DEFAULT;
  let sent: { sent: number; capacityRaisedTo: number | null };
  const db = getDb();
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    sent = await inviteToEvent(
      db,
      actor,
      eventId,
      { people, days, outsideCapacity: form.get("outside") === "1", locale: form.get("inviteLocale") === "en" ? "en" : "ro", addPlaceTo: confirmedCapacityOf(form.get("addPlace")) },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "FORBIDDEN") return { error: error.code };
    const refused = error instanceof InvitationRefusal
      ? { error: error.refusal, person: error.person }
      : supplementaryPlaceRefusalOutcome(error)
        ? { error: SUPPLEMENTARY_PLACE_UNCONFIRMED }
        : isDomainError(error)
          ? { error: error.code }
          : null;
    if (!refused) throw error;
    // The numbers the next dialog asks on, read now — for the role that may send, asserted above.
    return { ...refused, forecast: await readInvitationForecast(db, eventId, new Date()) };
  }
  return backToSection(
    locale,
    eventId,
    sent.capacityRaisedTo === null ? { saved: "invitationsSent", count: String(sent.sent) } : { saved: "invitationsSentRaised", count: String(sent.sent), capacity: String(sent.capacityRaisedTo) },
  );
}

/** The outcome a row verb redirects with: the marker of a refusal, or the toast's key. */
function refusalOf(error: unknown): { error: string } {
  if (error instanceof InvitationRefusal) return { error: error.refusal };
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

/** «Retrimite» (§NNN): a new email and link; the deadline kept, or moved to the days typed when that is later. */
export async function resendInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  let outcome: Record<string, string | undefined>;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    await resendInvitation(getDb(), actor, text(form, "invitationId"), wholeDigits(text(form, "days")), new Date());
    outcome = { saved: "invitationResent" };
  } catch (error) {
    outcome = refusalOf(error);
  }
  return backToSection(locale, eventId, outcome);
}

/** «Retrage» (§NNN): the invitation ends now and its place goes back. */
export async function withdrawInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  let outcome: Record<string, string | undefined>;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    await withdrawInvitation(getDb(), actor, text(form, "invitationId"), new Date());
    outcome = { saved: "invitationWithdrawn" };
  } catch (error) {
    outcome = refusalOf(error);
  }
  return backToSection(locale, eventId, outcome);
}
