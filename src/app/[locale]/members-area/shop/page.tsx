import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { listOrdersOfMember, listProductsForMembers, type MemberOrder, type MembersShopProduct } from "@/modules/content/shop/repository";
import { paymentWordsFor, readShopSettings } from "@/modules/content/shop/settings";
import { readShopOutcome, readShopOutcomeAtOrders } from "@/modules/content/shop/zone-outcome";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import MembersShop from "../MembersShop";
import ZoneFrame, { openZone } from "../zone";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ shop?: string | string[]; shopAt?: string | string[] }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Magazinul clubului» and «Comenzile mele» (§683): read here, per request, behind the account — the
 * products only while the privacy notice in force names `{{membersShop}}` in every language, the
 * member's own orders always. Nothing while the database is away, like the codes.
 */
async function shopOrNone(
  account: { id: string },
  locale: Locale,
  now: Date,
): Promise<{ open: boolean; products: MembersShopProduct[]; orders: MemberOrder[]; payment: string | null; emailMembers: boolean }> {
  try {
    const db = getDb();
    const open = await noticeDescribesMembersShop(db, now);
    const [products, orders, settings] = await Promise.all([
      open ? listProductsForMembers(db, locale) : Promise.resolve([]),
      listOrdersOfMember(db, account.id),
      readShopSettings(db),
    ]);
    return { open, products, orders, payment: paymentWordsFor(settings, locale), emailMembers: settings.emailMembers };
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return { open: false, products: [], orders: [], payment: null, emailMembers: true };
  }
}

/**
 * The members' zone, tab «Magazin» (§709, §683): the club's shop and the member's own orders, at
 * `/members-area/shop`. «Comandă» and «Anulează comanda» (`actions.ts`) answer back to this address
 * with `?shop=` and `?shopAt=`. The door is asserted here, on this page, as on every tab (`openZone`,
 * BR-REQ-060-01), and the order action asserts it again.
 */
export default async function MembersShopPage({ params, searchParams }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;
  const t = await getTranslations("Members");
  const shop = await shopOrNone(account, locale, new Date());
  const query = await searchParams;
  const hasShop = (shop.open && shop.products.length > 0) || shop.orders.length > 0;
  return (
    <ZoneFrame t={t} locale={locale} account={account} active="shop">
      {hasShop ? (
        <MembersShop
          products={shop.products}
          orders={shop.orders}
          payment={shop.payment}
          shopOpen={shop.open}
          outcome={readShopOutcome(query?.shop)}
          emailMembers={shop.emailMembers}
          outcomeAtOrders={readShopOutcomeAtOrders(query?.shopAt)}
          locale={locale}
        />
      ) : (
        <Typography variant="body1" sx={{ mb: 3 }} data-testid="members-shop-empty">
          {t("shopEmpty")}
        </Typography>
      )}
    </ZoneFrame>
  );
}
