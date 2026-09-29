import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { eventTranslations } from "@/db/schema/events";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { buildSponsorListCsv, sponsorList, sponsorListFileName } from "@/modules/registrations/sponsor-list";
import { canExportSponsorList } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Descarcă lista pentru sponsori» (§NNN): `GET /api/admin/registrations/sponsor-list?event=<id>`
 * for one event, no `event` for every event — the same query and the same five columns either way
 * (`registrations/sponsor-list.ts`), in the reader's language (`lang`), as a UTF-8 file with a BOM.
 *
 * Asserted here and again in the read (BR-REQ-060-01): the Organizer, the Administrator and the
 * Superadministrator (`canExportSponsorList`); Tehnic, the volunteer, the Redactor and a member are
 * refused whatever the link. Refused too (409) while the privacy notice in force does not say the
 * list may be given to partners — the page's disabled button is the same rule, not the rule. The
 * one write is the audit row: who, which event (or null) and how many rows, never a row.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canExportSponsorList(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const eventParam = url.searchParams.get("event");
  if (eventParam !== null && eventParam !== "" && !UUID.test(eventParam)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const eventId = eventParam || undefined;

  const now = new Date();
  const db = getDb();
  const list = await sponsorList(db, actor, { eventId, locale, now });
  if (!list.offered) return NextResponse.json({ error: "NOTICE_MISSING" }, { status: 409 });

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildSponsorListCsv(
    {
      firstName: t("sponsors.columns.firstName"),
      lastName: t("sponsors.columns.lastName"),
      email: t("sponsors.columns.email"),
      event: t("sponsors.columns.event"),
      consentedAt: t("sponsors.columns.consentedAt"),
    },
    list.rows,
  );

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "registrations.sponsor_list_exported",
    entityType: "event",
    entityId: eventId ?? null,
    metadata: { eventId: eventId ?? null, count: list.rows.length },
    now,
  });

  const [slug] = eventId
    ? await db
        .select({ slug: eventTranslations.slug })
        .from(eventTranslations)
        .where(and(eq(eventTranslations.eventId, eventId), eq(eventTranslations.locale, locale)))
        .limit(1)
    : [];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sponsorListFileName(eventId ? (slug?.slug ?? "eveniment") : null, day)}"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
