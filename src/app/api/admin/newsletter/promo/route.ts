import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { buildPromoConsentersCsv, exportPromoConsenters, promoConsentersCsvFileName } from "@/modules/newsletter/promo-consenters";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/** Every row, not the table's first ones: the file is the whole answer. */
const CSV_LIMIT = 100_000;

/**
 * «Descarcă CSV» on the newsletter page's «Participanți care au bifat oferte și beneficii» fold
 * (§562, amending §550): the name, the address, the event and the moment, in the reader's language
 * (`lang`), as a UTF-8 file with a BOM.
 *
 * The page's own gate, asserted here and again in the read (`canSendNewsletter`, BR-REQ-060-01):
 * the Organizer and the Administrator — a volunteer, the Redactor, Tehnic and a member are refused
 * whatever the link. Nothing is written but the audit row: who and how many rows, never an address
 * (§322), because a downloaded file is the one copy a withdrawal cannot reach; the guide says to
 * delete it after use.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canSendNewsletter(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const now = new Date();
  const db = getDb();
  const rows = await exportPromoConsenters(db, actor, locale, CSV_LIMIT);

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildPromoConsentersCsv(
    {
      name: t("newsletter.promo.columns.name"),
      email: t("newsletter.promo.columns.email"),
      event: t("newsletter.promo.columns.event"),
      consentedAt: t("newsletter.promo.columns.since"),
    },
    rows,
  );

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "newsletter.promo_consenters_exported",
    entityType: "newsletter",
    entityId: null,
    metadata: { rowCount: rows.length },
    now,
  });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${promoConsentersCsvFileName(day)}"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
