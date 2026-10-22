import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import StatusChip from "@/shared/ui/StatusChip";
import type { ShopOrderStatus } from "@/db/schema/shop";
import { clubVerbsFor, formatPrice, ORDER_NOTE_MAX, ORDER_QUANTITY_MAX, orderTotalBani, type OrderVerb } from "@/modules/content/shop/domain";
import type { AdminOrder, OrderableItem, OrdersQuery, ZoneAccount } from "@/modules/content/shop/repository";
import { type ListQuery, pageCount } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox } from "@/shared/forms/recall";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { moveShopOrderAction, placeOrderForMemberAction } from "@/app/[locale]/admin/shop/actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The order's statuses in the filter's order. */
const STATUSES: readonly ShopOrderStatus[] = ["PLACED", "PAID", "HANDED_OVER", "CANCELLED"];

/** Each club verb's glyph, by name (§170): the registry never crosses into a client island as an element. */
const VERB_GLYPH = { pay: "confirm", handOver: "checkIn", cancel: "cancel" } as const;
/** The fold's glyph (§694): the cart of an order the club places for a member, from the one registry. */
const OrderForIcon = ACTION_ICONS.orderFor;

/**
 * «Comenzi» (§683, its own page since §697): the orders, newest first, under a GET filter (status,
 * product) whose state is the address (§527's shape); the CSV of the same filter; the shop
 * manager's verbs on each row (`canManageShop`, §687), each asked first; and, at the top, «Adaugă o
 * comandă pentru un membru» (§690) for whoever may manage the shop. The member's address beside an
 * order only for a reader who already sees the members' addresses (§550, `showEmail`). The orders are
 * the backoffice's table since §846 (`AdminTable`, a block per row on a phone), paged through the
 * address like every other list; a stack of blocks before.
 */
export default function OrdersCard({
  orders,
  total,
  query,
  listQuery,
  productNames,
  accounts,
  items,
  path,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
  showEmail,
  emailMembers,
}: {
  orders: readonly AdminOrder[];
  /** Every order the filter names, counted — `orders` is one page of them. */
  total: number;
  query: OrdersQuery;
  /** The list's page and its size (§846), from the address. */
  listQuery: ListQuery;
  productNames: readonly { id: string; titleRo: string; titleEn: string }[];
  /** «Adaugă o comandă pentru un membru» (§690): the member accounts and the items it offers; empty for a reader who may not. */
  accounts: readonly ZoneAccount[];
  items: readonly OrderableItem[];
  /** This page's own address, for the GET filter. */
  path: string;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
  showEmail: boolean;
  /** The shop's switch «Îi scriem membrului pe email despre comenzi» (§704): off, the fold's email tick is not drawn. */
  emailMembers: boolean;
}) {
  const inUse = query.status !== null || query.productId !== null;
  const csvParams = new URLSearchParams({ lang: locale });
  if (query.status) csvParams.set("orderStatus", query.status);
  if (query.productId) csvParams.set("orderProduct", query.productId);
  const csvHref = `/api/admin/shop/orders?${csvParams.toString()}`;
  // The count is the filter's, not the rows drawn: the table pages through them, and the CSV has all.
  const count = t(`members.shop.orders.${countForm(total, locale)}`, { count: total });
  return (
    <Panel glyph="registrations" title={t("members.shop.ordersHeading")} aside={count} id="shop-orders" data-testid="shop-orders">
      <Stack spacing={2}>
        {mayManage && <ForMemberFold accounts={accounts} items={items} query={query} locale={locale} words={t} cancel={cancel} messages={messages} emailMembers={emailMembers} />}
        <Box component="form" method="get" action={`${path}#shop-orders`} role="search" aria-label={t("members.shop.filterLabel")}>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <TextField
              select
              size="small"
              name="orderStatus"
              id="shop-orders-status"
              label={t("members.shop.filterStatus")}
              defaultValue={query.status ?? ""}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 190, flex: "1 1 190px", maxWidth: { sm: 280 } }}
            >
              <option value="">{t("members.shop.filterAll")}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`members.shop.status.${status}`)}
                </option>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              name="orderProduct"
              id="shop-orders-product"
              label={t("members.shop.filterProduct")}
              defaultValue={query.productId ?? ""}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 190, flex: "1 1 190px", maxWidth: { sm: 320 } }}
            >
              <option value="">{t("members.shop.filterAll")}</option>
              {productNames.map((product) => (
                <option key={product.id} value={product.id}>
                  {locale === "en" ? product.titleEn : product.titleRo}
                </option>
              ))}
            </TextField>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              <GlyphButton icon="filter" type="submit" variant="contained" sx={TAP_TARGET}>
                {t("members.shop.filterApply")}
              </GlyphButton>
              {inUse && (
                <GlyphButton icon="clearFilter" href={`${path}#shop-orders`} variant="outlined" sx={TAP_TARGET}>
                  {t("members.shop.filterClear")}
                </GlyphButton>
              )}
            </Stack>
          </Stack>
        </Box>
        <Box>
          <GlyphButton icon="download" href={csvHref} variant="outlined" sx={TAP_TARGET} data-testid="shop-orders-csv">
            {t("members.shop.csv")}
          </GlyphButton>
        </Box>
        <AdminTable
          caption={t("members.shop.ordersHeading")}
          tableId="shop-orders"
          columns={orderColumns({ locale, words: t, showEmail })}
          rows={orders}
          rowKey={(order) => order.id}
          // A verb lands back on its row (`#order-<id>`, the actions' redirect).
          rowId={(order) => `order-${order.id}`}
          basePath={path}
          // So paging keeps the filter.
          currentParams={{ orderStatus: query.status ?? undefined, orderProduct: query.productId ?? undefined }}
          query={listQuery}
          total={total}
          labels={{
            results: t("list.results", { count: total }),
            page: t("list.page", { page: listQuery.page, pages: pageCount(total, listQuery.perPage) }),
            previous: t("list.previous"),
            next: t("list.next"),
            perPage: t("list.perPage"),
            actions: t("list.actions"),
            sortBy: (column) => t("list.sortBy", { column }),
          }}
          empty={
            <Typography variant="body2" data-testid="orders-empty">
              {t("members.shop.ordersEmpty")}
            </Typography>
          }
          rowActions={mayManage ? (order) => <OrderVerbs order={order} query={query} locale={locale} words={t} cancel={cancel} emailMembers={emailMembers} /> : undefined}
        />
      </Stack>
    </Panel>
  );
}

/**
 * «Adaugă o comandă pentru un membru» (§690): the club types in an order it collected outside the
 * site — a member account from the select (no free-text name: an order is an account's record), the
 * product and the variant as one choice (a sold-out variant offered disabled, never with a count),
 * one to five, a note, and two ticks: whether the member gets «Comanda ta a fost primită», and whether
 * the order is marked paid at once. Native controls, asked before the write, the list's filter posted
 * back so the answer lands on the new row. Drawn for `mayManage` only; the service asserts it again.
 */
function ForMemberFold({
  accounts,
  items,
  query,
  locale,
  words: t,
  cancel,
  messages,
  emailMembers,
}: {
  accounts: readonly ZoneAccount[];
  items: readonly OrderableItem[];
  query: OrdersQuery;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  emailMembers: boolean;
}) {
  const selectSx = { minWidth: 220, flex: "1 1 220px", maxWidth: { sm: 420 } } as const;
  const options = items.flatMap((item) => {
    const title = locale === "en" ? item.titleEn : item.titleRo;
    return item.variants.map((variant) => {
      const label = variant.label ? `${title} — ${variant.label}` : title;
      const soldOut = variant.stock !== null && variant.stock <= 0;
      return { value: `${item.id}:${variant.id}`, label: soldOut ? t("members.shop.forMember.itemSoldOut", { label }) : label, soldOut };
    });
  });
  return (
    <Box component="details" id="shop-order-for-member" sx={BOXED_DISCLOSURE_SX} data-testid="shop-order-for-member">
      <summary>
        <OrderForIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
        {t("members.shop.forMember.title")}
      </summary>
      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("members.shop.forMember.help")}
        </Typography>
        {accounts.length === 0 ? (
          <Alert severity="info">{t("members.shop.forMember.memberNone")}</Alert>
        ) : (
          <ActionForm
            action={placeOrderForMemberAction}
            messages={messages}
            scope="order-for-member"
            data-testid="order-for-member-form"
            confirm={{ title: t("members.shop.forMember.ask"), body: t("members.shop.forMember.askBody"), confirmLabel: t("members.shop.forMember.add"), cancelLabel: cancel }}
          >
            <input type="hidden" name="uiLocale" value={locale} />
            {query.status && <input type="hidden" name="orderStatus" value={query.status} />}
            {query.productId && <input type="hidden" name="orderProduct" value={query.productId} />}
            <Stack spacing={2}>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2 }}>
                <RecallField select required name="memberStaffUserId" label={t("members.shop.forMember.member")} defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={selectSx}>
                  <option value="" disabled>
                    —
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName}
                    </option>
                  ))}
                </RecallField>
                <RecallField select required name="item" label={t("members.shop.forMember.item")} defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={selectSx}>
                  <option value="" disabled>
                    —
                  </option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.soldOut}>
                      {option.label}
                    </option>
                  ))}
                </RecallField>
                <RecallField select name="quantity" label={t("members.shop.forMember.quantity")} defaultValue="1" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 110, flex: "0 1 110px" }}>
                  {Array.from({ length: ORDER_QUANTITY_MAX }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </RecallField>
              </Stack>
              <RecallField name="note" label={t("members.shop.forMember.note")} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: ORDER_NOTE_MAX } }} />
              {emailMembers ? (
                <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
                  <RecallCheckbox name="emailMember" defaultChecked={false} style={{ width: 20, height: 20 }} />
                  <Typography component="span" variant="body2">
                    {t("members.shop.forMember.email")}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("members.shop.forMember.emailOff")}
                </Typography>
              )}
              <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
                <RecallCheckbox name="markPaid" defaultChecked={false} style={{ width: 20, height: 20 }} />
                <Typography component="span" variant="body2">
                  {t("members.shop.forMember.paid")}
                </Typography>
              </Box>
              <Box>
                <GlyphSubmitButton label={t("members.shop.forMember.add")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
              </Box>
            </Stack>
          </ActionForm>
        )}
      </Stack>
    </Box>
  );
}

/**
 * The orders' columns (§846; a block per order until then): the number, the state — with «Adăugată de
 * club» and who cancelled it — the moment, the member, what and how many, the total and the note: the
 * CSV's own columns' words, so the table and the file read alike.
 */
function orderColumns({ locale, words: t, showEmail }: { locale: Locale; words: Words; showEmail: boolean }): readonly AdminColumn<AdminOrder>[] {
  return [
    {
      key: "number",
      label: t("members.shop.columns.number"),
      primary: true,
      render: (order) => (
        <Box component="span" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
          {t("members.shop.orderNumber", { number: order.number })}
        </Box>
      ),
    },
    {
      key: "status",
      label: t("members.shop.columns.status"),
      essential: true,
      render: (order) => (
        <Stack spacing={0.5} sx={{ alignItems: { xs: "flex-end", md: "flex-start" } }}>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, justifyContent: { xs: "flex-end", md: "flex-start" } }}>
            <StatusChip
              glyph={order.status === "CANCELLED" ? "cancelled" : order.status === "PLACED" ? "planned" : "done"}
              color={order.status === "CANCELLED" ? "default" : order.status === "PLACED" ? "warning" : "success"}
              label={t(`members.shop.status.${order.status}`)}
            />
            {/* Placed by the club in the member's name (§690): said on the row, as the CSV says it in its column. */}
            {order.placedBy === "CLUB" && <StatusChip glyph="club" variant="outlined" label={t("members.shop.forMember.placedByClub")} testId="order-placed-by-club" />}
          </Stack>
          {order.status === "CANCELLED" && order.cancelledBy && (
            <Typography component="span" variant="body2" color="text.secondary">
              {order.cancelledBy === "MEMBER" ? t("members.shop.cancelledByMember") : t("members.shop.cancelledByClub")}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      key: "date",
      label: t("members.shop.columns.date"),
      render: (order) => formatDay(order.createdAt, { locale, timeZone: CLUB_TIME_ZONE, withTime: true }),
    },
    {
      key: "member",
      label: t("members.shop.columns.member"),
      render: (order) => (
        <Box component="span" sx={{ overflowWrap: "anywhere" }}>
          {order.memberName}
          {showEmail && order.memberEmail ? ` · ${order.memberEmail}` : ""}
          {!order.memberEmail ? ` · ${t("members.shop.accountGone")}` : ""}
        </Box>
      ),
    },
    {
      key: "product",
      label: t("members.shop.columns.product"),
      render: (order) => (
        <Box component="span" sx={{ overflowWrap: "anywhere" }}>
          {`${locale === "en" ? order.productTitleEn : order.productTitleRo}${order.variantLabel ? ` — ${order.variantLabel}` : ""} × ${order.quantity}`}
        </Box>
      ),
    },
    {
      key: "total",
      label: t("members.shop.columns.total"),
      align: "right",
      render: (order) => <Box component="span" sx={{ whiteSpace: "nowrap" }}>{formatPrice(orderTotalBani(order), order.currency, locale)}</Box>,
    },
    {
      key: "note",
      label: t("members.shop.columns.note"),
      hideBelow: "lg",
      render: (order) =>
        order.note ? (
          <Box component="span" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere", color: "text.secondary" }}>
            {order.note}
          </Box>
        ) : (
          "—"
        ),
    },
  ];
}

/** The shop manager's verbs on one order (`canManageShop`, §687), each asked first; none on an order with nowhere to go. */
function OrderVerbs({
  order,
  query,
  locale,
  words: t,
  cancel,
  emailMembers,
}: {
  order: AdminOrder;
  /** The list's filter, posted with each verb so the answer lands on the same list (§683). */
  query: OrdersQuery;
  locale: Locale;
  words: Words;
  cancel: string;
  emailMembers: boolean;
}) {
  const verbs: OrderVerb[] = clubVerbsFor(order.status);
  if (verbs.length === 0) return null;
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, justifyContent: { md: "flex-end" } }}>
      {verbs.map((verb) => (
        <ActionForm
          key={verb}
          action={moveShopOrderAction}
          confirm={{
            title: t(`members.shop.verbs.${verb}.title`, { number: order.number }),
            body: t(verb === "pay" && !emailMembers ? "members.shop.verbs.pay.bodyNoEmail" : `members.shop.verbs.${verb}.body`),
            confirmLabel: t(`members.shop.verbs.${verb}.label`),
            cancelLabel: cancel,
            destructive: verb === "cancel",
          }}
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="verb" value={verb} />
          {query.status && <input type="hidden" name="orderStatus" value={query.status} />}
          {query.productId && <input type="hidden" name="orderProduct" value={query.productId} />}
          <GlyphButton icon={VERB_GLYPH[verb]} type="submit" variant="outlined" color={verb === "cancel" ? "error" : "primary"} sx={{ minHeight: 44 }}>
            {t(`members.shop.verbs.${verb}.label`)}
          </GlyphButton>
        </ActionForm>
      ))}
    </Stack>
  );
}
