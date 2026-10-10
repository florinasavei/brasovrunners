import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { countOrdersForAdmin, listOrderableItems, listOrdersForAdmin, listProductNames, listZoneAccountsForOrder, parseOrdersQuery } from "@/modules/content/shop/repository";
import OrdersCard from "@/modules/content/shop/ui/OrdersCard";
import ShopTabs from "@/modules/content/shop/ui/ShopTabs";
import { canManageShop, canReadShop, canSeeShopMemberAddresses } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { refusalMessages } from "@/shared/forms/refusal-messages";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; orderStatus?: string; orderProduct?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Magazin» → «Comenzi» (§683, §690; its own page since §697): the orders under their filter, the
 * CSV, the verbs, and «Adaugă o comandă pentru un membru». Read by `canReadShop`; the verbs and the
 * fold are `canManageShop`'s, asserted by every action and service (BR-REQ-060-01); the member's
 * address beside an order only for a role that already reads the members' addresses (§550).
 */
export default async function AdminShopOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadShop(actor)) notFound();

  const query = await searchParams;
  const { saved, error } = query;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const db = getDb();
  const ordersQuery = parseOrdersQuery(query);
  const mayManage = canManageShop(actor);
  const [orders, productNames, ordersTotal, accounts, items] = await Promise.all([
    listOrdersForAdmin(db, ordersQuery),
    listProductNames(db),
    countOrdersForAdmin(db, ordersQuery),
    // «Adaugă o comandă pentru un membru» (§690): the member accounts and the orderable items, read only
    // for whoever may place one — by role or by «Gestionează magazinul» (§687).
    mayManage ? listZoneAccountsForOrder(db) : Promise.resolve([]),
    mayManage ? listOrderableItems(db) : Promise.resolve([]),
  ]);
  const messages = await refusalMessages({
    memberStaffUserId: t("members.shop.forMember.member"),
    item: t("members.shop.forMember.item"),
    quantity: t("members.shop.forMember.quantity"),
    note: t("members.shop.forMember.note"),
  });

  return (
    <Stack spacing={3}>
      <ShopTabs locale={locale} active="orders" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <OrdersCard
        orders={orders}
        total={ordersTotal}
        query={ordersQuery}
        productNames={productNames}
        accounts={accounts}
        items={items}
        path={getPathname({ locale, href: "/admin/shop/orders" })}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        mayManage={mayManage}
        showEmail={canSeeShopMemberAddresses(actor.role)}
      />
    </Stack>
  );
}
