import PaymentsIcon from "@mui/icons-material/Payments";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/** The shop's three parts (§NNN): the products, the orders, the settings — each its own page under `/admin/shop`. */
export const SHOP_TABS = ["products", "orders", "settings"] as const;
export type ShopTab = (typeof SHOP_TABS)[number];

const TAB_ROUTE = {
  products: "/admin/shop",
  orders: "/admin/shop/orders",
  settings: "/admin/shop/settings",
} as const satisfies Record<ShopTab, string>;

const TAB_GLYPH = { products: StorefrontIcon, orders: ReceiptLongIcon, settings: PaymentsIcon } as const;

/**
 * «Magazin»'s row of secondary tabs (§360's shape, §NNN): «Produse», «Comenzi», «Setări». The shop
 * was one card of folds — the products, the orders and the payment words stacked on one page — and
 * the owner found it «not intuitive at all»; each part is a page now, and this row is the way between
 * them. Every reader of the shop (`canReadShop`) is offered all three: the Organizer reads them,
 * the verbs on each are drawn for `canManageShop` alone and asserted on the server.
 *
 * A Server Component of anchors, like every `SubNav`; the glyphs are elements, safe here because
 * nothing crosses into a client island.
 */
export default async function ShopTabs({ locale, active }: { locale: Locale; active: ShopTab }) {
  const t = await getTranslations("Admin");
  return (
    <SubNav
      label={t("nav.shop")}
      items={SHOP_TABS.map((tab) => {
        const Glyph = TAB_GLYPH[tab];
        return { href: getPathname({ locale, href: TAB_ROUTE[tab] }), label: t(`members.shop.tabs.${tab}`), active: tab === active, glyph: <Glyph /> };
      })}
    />
  );
}
