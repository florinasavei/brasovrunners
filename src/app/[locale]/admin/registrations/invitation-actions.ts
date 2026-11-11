"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { inviteToEvent, readInvitationForecast, resendInvitation, withdrawInvitation } from "@/modules/registrations/admin-service";
import { confirmedCapacityOf, SUPPLEMENTARY_PLACE_UNCONFIRMED, supplementaryPlaceRefusalOutcome } from "@/modules/registrations/domain/capacity";
import { HIDDEN_LIST_OFF } from "@/modules/registrations/domain/hidden-list";
import { INVITATION_DAYS_DEFAULT, InvitationRefusal, parseInvitationLines, readInviteeRows } from "@/modules/registrations/domain/invitations";
import type { InvitationInvitee } from "@/modules/registrations/service";
import { inEmailPress } from "@/modules/notifications/press";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { wholeDigits } from "@/shared/forms/whole-digits";

/**
 * Invitations by email (§647): the three presses of the «Invitații» section on an event's registrations
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
 * «Trimite invitațiile» (§647): the members ticked and the lines typed, one send. A line that is not a
 * name and an address is refused before anything is asked of the server; the service refuses the whole
 * list by the first person it cannot invite. On success, back to the section with the toast.
 */
export async function inviteAction(_previous: InvitationSendState, form: FormData): Promise<InvitationSendState> {
  // An email press (`notifications/press.ts`): every row it queues carries this cause, its id and who pressed.
  return inEmailPress("registrations.invite", async (press) => {
    const locale = toLocale(form.get("uiLocale"));
    const eventId = text(form, "eventId");
    const typed = parseInvitationLines(text(form, "typed"));
    if (typed.unread.length > 0) return { error: "INVITATION_UNREAD_LINE", lines: typed.unread.join(", ") };
    // The form's rows (§737): «Nume» and «Email» per person, two lists in the same order.
    const strings = (name: string) => form.getAll(name).map((value) => (typeof value === "string" ? value : ""));
    const rows = readInviteeRows(strings("inviteeName"), strings("inviteeEmail"), strings("inviteePlaces"));
    if (rows.unread.length > 0) return { error: "INVITATION_UNREAD_ROW", lines: rows.unread.join(", ") };
    const people: InvitationInvitee[] = [
      ...form
        .getAll("member")
        .filter((value): value is string => typeof value === "string" && value !== "")
        .map((memberStaffUserId) => ({ name: "", email: "", memberStaffUserId })),
      ...rows.people.map((person) => ({ name: person.name, email: person.email, places: person.places })),
      ...typed.people.map((person) => ({ name: person.name, email: person.email })),
    ];
    const days = wholeDigits(text(form, "days")) ?? INVITATION_DAYS_DEFAULT;
    let sent: { sent: number; capacityRaisedTo: number | null };
    const db = getDb();
    try {
      const actor = await requireStaffCapability(canManageRegistrations);
      press.by(actor.id);
      sent = await inviteToEvent(
        db,
        actor,
        eventId,
        {
          people,
          days,
          outsideCapacity: form.get("outside") === "1",
          // «Elită» for the whole send (§917), beside «Pe lista de invitați speciali»: the registration each becomes is marked.
          elite: form.get("elite") === "1",
          locale: form.get("inviteLocale") === "en" ? "en" : "ro",
          addPlaceTo: confirmedCapacityOf(form.get("addPlace")),
        },
        new Date(),
      );
    } catch (error) {
      if (isDomainError(error) && error.code === "FORBIDDEN") return { error: error.code };
      const refused = error instanceof InvitationRefusal
        ? { error: error.refusal, person: error.person }
        : supplementaryPlaceRefusalOutcome(error)
          ? { error: SUPPLEMENTARY_PLACE_UNCONFIRMED }
          : isDomainError(error) && error.fields.includes(HIDDEN_LIST_OFF)
            ? { error: HIDDEN_LIST_OFF }
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
  });
}

/** The outcome a row verb redirects with: the marker of a refusal, or the toast's key. */
function refusalOf(error: unknown): { error: string } {
  if (error instanceof InvitationRefusal) return { error: error.refusal };
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

/**
 * When the page that offered the days was drawn: the form's hidden `drawnAt`, an ISO instant as
 * `Date.prototype.toISOString` writes it, or null for anything else — then the days count from the press.
 */
function drawnAtOf(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * «Retrimite» (§647): a new email and link; the deadline kept, or moved to the day chosen in «La retrimitere»
 * — its days, counted from the moment the page was drawn, so the press stores the moment the line named — when
 * that is later; but kept for a counted invitation while anyone eligible waits, and kept when it is already later
 * than the line (moved since the page was drawn) — and the toast says which.
 */
export async function resendInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  // An email press (`notifications/press.ts`): every row it queues carries this cause, its id and who pressed.
  return inEmailPress("registrations.invitationResend", async (press) => {
    const locale = toLocale(form.get("uiLocale"));
    const eventId = text(form, "eventId");
    let outcome: Record<string, string | undefined>;
    try {
      const actor = await requireStaffCapability(canManageRegistrations);
      press.by(actor.id);
      const resent = await resendInvitation(getDb(), actor, text(form, "invitationId"), wholeDigits(text(form, "days")), new Date(), drawnAtOf(text(form, "drawnAt")));
      const said = { waiting: "invitationResentKept", alreadyLater: "invitationResentAlreadyLater" } as const;
      outcome = { saved: resent.kept ? said[resent.kept] : "invitationResent" };
    } catch (error) {
      outcome = refusalOf(error);
    }
    return backToSection(locale, eventId, outcome);
  });
}

/** «Retrage» (§647): the invitation ends now and its place goes back. */
export async function withdrawInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  // An email press (`notifications/press.ts`): every row it queues carries this cause, its id and who pressed.
  return inEmailPress("registrations.invitationWithdraw", async (press) => {
    const locale = toLocale(form.get("uiLocale"));
    const eventId = text(form, "eventId");
    let outcome: Record<string, string | undefined>;
    try {
      const actor = await requireStaffCapability(canManageRegistrations);
      press.by(actor.id);
      await withdrawInvitation(getDb(), actor, text(form, "invitationId"), new Date());
      outcome = { saved: "invitationWithdrawn" };
    } catch (error) {
      outcome = refusalOf(error);
    }
    return backToSection(locale, eventId, outcome);
  });
}
