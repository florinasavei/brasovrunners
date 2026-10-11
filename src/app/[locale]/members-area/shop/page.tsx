import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { listOrdersOfMember, listProductsForMembers, type MemberOrder, type MembersShopProduct } from "@/modules/content/shop/repository";
import { paymentWordsFor, readShopSettings } from "@/modules/content/shop/settings";
import { readShopOutcome, readShopOutcomeAtOrders } from "@/modules/content/shop/zone-outcome";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import MembersShop, { ShopOutcomeAlert } from "../MembersShop";
import ZoneFrame, { frameParts, openZone } from "../zone";

type Props = { params: Promise<{ locale: string }>; searchParams?: Promise<{ shop?: string | string[]; shopAt?: string | string[] }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Magazinul clubului» and «Comenzile mele» (§683): read here, per request, behind the account — the
 * products only while the privacy notice in force names `{{membersShop}}` in every language, the
 * member's own orders always. `"away"` while the database is (§447).
 */
async function shopOrNone(
  account: { id: string },
  locale: Locale,
  now: Date,
): Promise<{ open: boolean; products: MembersShopProduct[]; orders: MemberOrder[]; payment: string | null; emailMembers: boolean } | "away"> {
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
    return "away";
  }
}

/**
 * The members' zone, tab «Magazin» (§715, §683): the club's shop and the member's own orders, at
 * `/members-area/shop`. «Comandă» and «Anulează comanda» (`actions.ts`) answer back to this address
 * with `?shop=` and `?shopAt=`. The door is asserted here, on this page, as on every tab (`openZone`,
 * BR-REQ-060-01), and the order action asserts it again.
 *
 * The frame's reads start together with the shop's rather than after them, and the 404 is decided
 * once both are in: the common case, a shop to draw, pays one round of reads, not two.
 */
export default async function MembersShopPage({ params, searchParams }: Props) {
  const opened = await openZone((await params).locale);
  if ("resting" in opened) return opened.resting;
  const { locale, account } = opened;
  const t = await getTranslations("Members");
  const now = new Date();
  const [shop, parts, query] = await Promise.all([shopOrNone(account, locale, now), frameParts(account, locale, now, true), searchParams]);
  const outcome = readShopOutcome(query?.shop);
  /*
    The zone draws no shop before the privacy notice names `{{membersShop}}` (BR-REQ-053-01): no tab,
    and no page at this address either, unless the member has orders of their own to see. The one
    exception is the answer to a press (`?shop=`) made on a page drawn before the notice changed —
    «Produsul nu mai e în magazin…» — which would otherwise end on a 404 where the button led: it is
    drawn in the frame, with no «Magazin» tab to lead back here (§715), for that request alone. With
    no answer in the address the 404 stays.
  */
  if (shop !== "away" && !shop.open && shop.orders.length === 0) {
    if (!outcome) notFound();
    return (
      <ZoneFrame t={t} locale={locale} account={account} active="shop" parts={{ ...parts, shop: false }}>
        <ShopOutcomeAlert outcome={outcome} emailMembers={shop.emailMembers} t={t} />
      </ZoneFrame>
    );
  }
  return (
    <ZoneFrame t={t} locale={locale} account={account} active="shop" parts={parts}>
      {shop === "away" ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("zoneAway")}
        </Alert>
      ) : (shop.open && shop.products.length > 0) || shop.orders.length > 0 ? (
        <MembersShop
          products={shop.products}
          orders={shop.orders}
          payment={shop.payment}
          shopOpen={shop.open}
          outcome={outcome}
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
