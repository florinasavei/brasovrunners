import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { buildOrdersCsv, ordersCsvFileName } from "@/modules/content/shop/csv";
import { listOrdersForAdmin, parseOrdersQuery } from "@/modules/content/shop/repository";
import { canReadShop, canSeeShopMemberAddresses } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/** Every order under the filter, not the list's first rows: the file is the whole answer. */
const CSV_LIMIT = 100_000;

/**
 * «Descarcă CSV» on «Magazin»'s orders (§683): the filter the list shows (`orderStatus`,
 * `orderProduct`), in the reader's language (`lang`), as a UTF-8 file with a BOM — the newsletter
 * list's route (§550), the registrations export's rules.
 *
 * Whoever reads the shop may take it — `canReadShop`, the page's own gate, asserted here again
 * (BR-REQ-060-01): the Organizer, the Administrator, the Superadministrator; a volunteer, the
 * Redactor, the Tehnic and a member are refused whatever the link. The member's address is a column
 * only for a reader who already sees members' addresses (§550). The download is recorded — who, the
 * filter's shape and how many rows, never a name or an address — because a file that leaves the site
 * is a copy the club has to account for.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canReadShop(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const query = parseOrdersQuery(Object.fromEntries(url.searchParams));
  const now = new Date();
  const db = getDb();
  const rows = await listOrdersForAdmin(db, query, CSV_LIMIT);
  const withEmail = canSeeShopMemberAddresses(actor.role);

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildOrdersCsv(
    {
      number: t("members.shop.columns.number"),
      date: t("members.shop.columns.date"),
      member: t("members.shop.columns.member"),
      email: t("members.shop.columns.email"),
      product: t("members.shop.columns.product"),
      variant: t("members.shop.columns.variant"),
      quantity: t("members.shop.columns.quantity"),
      unitPrice: t("members.shop.columns.unitPrice"),
      total: t("members.shop.columns.total"),
      status: t("members.shop.columns.status"),
      note: t("members.shop.columns.note"),
    },
    rows,
    { locale, withEmail, statusWord: (status) => t(`members.shop.status.${status}`) },
  );

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "shop.orders_exported",
    entityType: "shop_order",
    entityId: null,
    metadata: { status: query.status, product: query.productId !== null, withEmail, rowCount: rows.length },
    now,
  });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ordersCsvFileName(day)}"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
