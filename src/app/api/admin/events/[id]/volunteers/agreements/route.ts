import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { eventTranslations, events } from "@/db/schema/events";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { type Locale, routing } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { pdfResponse } from "@/modules/registrations/declaration-labels";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { eventAgreementsFileName, type EventAgreementsScope, renderEventVolunteerAgreementsPdf } from "@/modules/volunteers/agreement-pdf";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/** Every volunteer's agreement drawn into one file — a few reads and two pages a person — can outlast the platform's ten seconds on a big race. */
export const maxDuration = 60;

/**
 * «Contractele (PDF)» and «De semnat pe hârtie (PDF)» on the «Voluntari» list (§966; the owner, 2026-11-17: «și vreau să pot
 * printa și contractul de voluntariat, să am la fața locului»): every agreement of one event in one PDF, for the desk, in place
 * of a download per person (`renderEventVolunteerAgreementsPdf`) — each volunteer who is not cancelled, by name, with exactly
 * the pages their own file has; `?only=unsigned` the sheets to sign on paper alone. `?lang=` is the reader's language: the
 * event's slug in the file's name, and the words of a file with nobody in it.
 *
 * Whoever reads the list may take it — `canManageVolunteers`, the one-person file's own gate, asserted here again
 * (BR-REQ-060-01): the Tehnic role, a Redactor, a volunteer at the desk and a member are refused whatever the link, and a
 * malformed or unknown event is NOT_FOUND. A file with people's names leaves the site, so the download is audited once
 * (`volunteer.agreements_downloaded`, as the declarations' bundle is, §324): the event, how many agreements the file holds,
 * how many accepted and how many to sign, and `only` — never a name. A GET that writes nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const scope: EventAgreementsScope = url.searchParams.get("only") === "unsigned" ? "unsigned" : "all";

  const db = getDb();
  const [event] = await db
    .select({ id: events.id, slug: eventTranslations.slug })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(eq(events.id, id))
    .limit(1);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const file = await renderEventVolunteerAgreementsPdf(db, event.id, now, { scope, locale });
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "volunteer.agreements_downloaded",
    entityType: "event",
    entityId: event.id,
    metadata: { only: scope === "unsigned" ? "unsigned" : null, agreements: file.accepted + file.toSign, accepted: file.accepted, toSign: file.toSign },
    now,
  });
  // The club's date, as the event's other files are named by it.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return pdfResponse(file.pdf, eventAgreementsFileName(event.slug, day, scope), "attachment");
}
