import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { eventTranslations } from "@/db/schema/events";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { listLatestDeclarationAcceptances } from "@/modules/registrations/admin-repository";
import { buildSponsorListCsv, PROMO_LISTED_STATUSES, sponsorList, sponsorListFileName, sponsorListFormat, sponsorRecipient } from "@/modules/registrations/sponsor-list";
import { buildSponsorListWorkbook, SPONSOR_SHEET_COLUMNS, type SponsorSheetWords } from "@/modules/registrations/sponsor-sheet";
import { canExportSponsorList } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Descarcă lista pentru sponsori» (§570): `GET /api/admin/registrations/sponsor-list?event=<id>`
 * for one event, no `event` for every event — the same query and the same five columns either way
 * (`registrations/sponsor-list.ts`), in the reader's language (`lang`), as a UTF-8 file with a BOM
 * — or, with `format=xlsx` (§581), the same rows as an Excel file with every tick the person gave
 * beside the five columns (`sponsor-sheet.ts`), named `sponsori-<eveniment>-<zi>.xlsx`.
 *
 * Asserted here and again in the read (BR-REQ-060-01): the Organizer, the Administrator and the
 * Superadministrator (`canExportSponsorList`); Tehnic, the volunteer, the Redactor and a member are
 * refused whatever the link. Refused too (409) while the privacy notice in force does not say the
 * list may be given to partners — the page's disabled button is the same rule, not the rule. The
 * one write is the audit row: who, which event (or null), which file (`format`), how many rows, the registrations the file
 * held (their ids — never a name or an address) and whom it was given to when the download named
 * one (`to`, «Cui dai lista»). A registration's page reads that back as «Dată partenerilor», so the
 * club can answer the notice's art. 15 and 19 promise — which partner received whose data — long
 * after its own copy of the file is deleted (review finding).
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
  const format = sponsorListFormat(url.searchParams.get("format"));

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "registrations.sponsor_list_exported",
    entityType: "event",
    entityId: eventId ?? null,
    metadata: {
      eventId: eventId ?? null,
      // Which of the two files (§581): the same rows either way.
      format,
      count: list.rows.length,
      recipient: sponsorRecipient(url.searchParams.get("to")),
      registrationIds: list.rows.map((row) => row.registrationId),
    },
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
  const fileName = sponsorListFileName(eventId ? (slug?.slug ?? "eveniment") : null, day, format);
  const headers = { "Content-Disposition": `attachment; filename="${fileName}"`, "X-Robots-Tag": "noindex", "Cache-Control": "private, no-store" };

  if (format === "xlsx") {
    // Every tick beside the five (§581): the declaration signed is one query for the rows in the file.
    const declarations = await listLatestDeclarationAcceptances(db, list.rows.map((row) => row.registrationId));
    const workbook = await buildSponsorListWorkbook(
      {
        sheet: t("sponsors.sheet.name"),
        yes: t("sponsors.sheet.yes"),
        no: t("sponsors.sheet.no"),
        columns: Object.fromEntries(SPONSOR_SHEET_COLUMNS.map((key) => [key, t(`sponsors.sheet.columns.${key}`)])) as SponsorSheetWords["columns"],
        states: Object.fromEntries(PROMO_LISTED_STATUSES.map((status) => [status, t(`sponsors.sheet.states.${status}`)])) as SponsorSheetWords["states"],
      },
      list.rows.map((row) => ({
        ...row,
        declarationVersion: declarations.get(row.registrationId)?.version ?? null,
        declarationSignedAt: declarations.get(row.registrationId)?.acceptedAt ?? null,
      })),
    );
    return new NextResponse(new Uint8Array(workbook), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  }

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
  return new NextResponse(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
