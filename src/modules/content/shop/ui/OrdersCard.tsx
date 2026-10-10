import AddShoppingCartIcon from "@mui/icons-material/AddShoppingCart";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import type { ShopOrderStatus } from "@/db/schema/shop";
import { clubVerbsFor, formatPrice, ORDER_NOTE_MAX, ORDER_QUANTITY_MAX, orderTotalBani, type OrderVerb } from "@/modules/content/shop/domain";
import type { AdminOrder, OrderableItem, OrdersQuery, ZoneAccount } from "@/modules/content/shop/repository";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox } from "@/shared/forms/recall";
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

/**
 * «Comenzi» (§683, its own page since §NNN): the orders, newest first, under a GET filter (status,
 * product) whose state is the address (§527's shape); the CSV of the same filter; the shop
 * manager's verbs on each row (`canManageShop`, §687), each asked first; and, at the top, «Adaugă o
 * comandă pentru un membru» (§690) for whoever may manage the shop. The member's address beside an
 * order only for a reader who already sees the members' addresses (§550, `showEmail`).
 */
export default function OrdersCard({
  orders,
  total,
  query,
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
}: {
  orders: readonly AdminOrder[];
  /** Every order the filter names, counted — `orders` stops at `ORDERS_SHOWN_MAX`. */
  total: number;
  query: OrdersQuery;
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
}) {
  const inUse = query.status !== null || query.productId !== null;
  const csvParams = new URLSearchParams({ lang: locale });
  if (query.status) csvParams.set("orderStatus", query.status);
  if (query.productId) csvParams.set("orderProduct", query.productId);
  const csvHref = `/api/admin/shop/orders?${csvParams.toString()}`;
  // The count is the filter's, not the rows drawn: past ORDERS_SHOWN_MAX the list says it stops, and the CSV has all.
  const count = t(`members.shop.orders.${countForm(total, locale)}`, { count: total });
  return (
    <Panel glyph="registrations" title={t("members.shop.ordersHeading")} aside={count} id="shop-orders" data-testid="shop-orders">
      <Stack spacing={2}>
        {mayManage && <ForMemberFold accounts={accounts} items={items} query={query} locale={locale} words={t} cancel={cancel} messages={messages} />}
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
        {total > orders.length && (
          <Typography variant="body2" color="text.secondary" data-testid="orders-more">
            {t("members.shop.ordersMore", { shown: orders.length, total })}
          </Typography>
        )}
        {orders.length === 0 ? (
          <Typography variant="body2" data-testid="orders-empty">
            {t("members.shop.ordersEmpty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.shop.ordersHeading")}>
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} query={query} locale={locale} words={t} cancel={cancel} mayManage={mayManage} showEmail={showEmail} />
            ))}
          </Stack>
        )}
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
}: {
  accounts: readonly ZoneAccount[];
  items: readonly OrderableItem[];
  query: OrdersQuery;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
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
        <AddShoppingCartIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
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
              <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
                <RecallCheckbox name="emailMember" defaultChecked={false} style={{ width: 20, height: 20 }} />
                <Typography component="span" variant="body2">
                  {t("members.shop.forMember.email")}
                </Typography>
              </Box>
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

function OrderRow({
  order,
  query,
  locale,
  words: t,
  cancel,
  mayManage,
  showEmail,
}: {
  order: AdminOrder;
  /** The list's filter, posted with each verb so the answer lands on the same list (§683). */
  query: OrdersQuery;
  locale: Locale;
  words: Words;
  cancel: string;
  mayManage: boolean;
  showEmail: boolean;
}) {
  const title = locale === "en" ? order.productTitleEn : order.productTitleRo;
  const what = `${title}${order.variantLabel ? ` — ${order.variantLabel}` : ""} × ${order.quantity}`;
  const verbs: OrderVerb[] = mayManage ? clubVerbsFor(order.status) : [];
  return (
    <Box component="li" id={`order-${order.id}`} sx={{ borderBottom: 1, borderColor: "divider", pb: 1.5, scrollMarginTop: 16 }} data-testid="shop-order">
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Typography variant="subtitle2" component="p" sx={{ fontWeight: 700 }}>
          {t("members.shop.orderNumber", { number: order.number })}
        </Typography>
        <Chip size="small" color={order.status === "CANCELLED" ? "default" : order.status === "PLACED" ? "warning" : "success"} label={t(`members.shop.status.${order.status}`)} />
        {/* Placed by the club in the member's name (§690): said on the row, as the CSV says it in its column. */}
        {order.placedBy === "CLUB" && <Chip size="small" variant="outlined" label={t("members.shop.forMember.placedByClub")} data-testid="order-placed-by-club" />}
      </Stack>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {order.memberName}
        {showEmail && order.memberEmail ? ` · ${order.memberEmail}` : ""}
        {!order.memberEmail ? ` · ${t("members.shop.accountGone")}` : ""}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {what} · {formatPrice(orderTotalBani(order), order.currency, locale)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {formatDay(order.createdAt, { locale, timeZone: CLUB_TIME_ZONE, withTime: true })}
      </Typography>
      {order.note && (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {t("members.shop.note")}: {order.note}
        </Typography>
      )}
      {order.status === "CANCELLED" && order.cancelledBy && (
        <Typography variant="body2" color="text.secondary">
          {order.cancelledBy === "MEMBER" ? t("members.shop.cancelledByMember") : t("members.shop.cancelledByClub")}
        </Typography>
      )}
      {verbs.length > 0 && (
        <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
          {verbs.map((verb) => (
            <ActionForm
              key={verb}
              action={moveShopOrderAction}
              confirm={{
                title: t(`members.shop.verbs.${verb}.title`, { number: order.number }),
                body: t(`members.shop.verbs.${verb}.body`),
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
      )}
    </Box>
  );
}
