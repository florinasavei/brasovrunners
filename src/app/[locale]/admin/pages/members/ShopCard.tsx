import AddCircleIcon from "@mui/icons-material/AddCircle";
import AddShoppingCartIcon from "@mui/icons-material/AddShoppingCart";
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import StorefrontIcon from "@mui/icons-material/Storefront";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import type { ShopOrderStatus } from "@/db/schema/shop";
import {
  clubVerbsFor,
  formatPrice,
  minorAsTyped,
  ORDER_NOTE_MAX,
  ORDER_QUANTITY_MAX,
  orderTotalBani,
  type OrderVerb,
  SHOP_CURRENCIES,
  type ShopCurrency,
  STOCK_MAX,
  VARIANT_LABEL_MAX,
  VARIANTS_MAX,
  variantLinesAsTyped,
} from "@/modules/content/shop/domain";
import { loadedStockJson, PAYMENT_WORDS_MAX, PRODUCT_DESCRIPTION_MAX, PRODUCT_TITLE_MAX } from "@/modules/content/shop/fields";
import type { AdminOrder, AdminShopProduct, OrderableItem, OrdersQuery, ZoneAccount } from "@/modules/content/shop/repository";
import type { ShopSettings } from "@/modules/content/shop/settings";
import TeamPhotoField, { type TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField, { RecallCheckbox, RecallHidden } from "@/shared/forms/recall";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  createShopProductAction,
  deleteShopProductAction,
  moveShopOrderAction,
  moveShopProductAction,
  placeOrderForMemberAction,
  saveShopProductAction,
  saveShopSettingsAction,
} from "./actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The order's statuses in the filter's order. */
const STATUSES: readonly ShopOrderStatus[] = ["PLACED", "PAID", "HANDED_OVER", "CANCELLED"];

/** Each currency's word in «Moneda», by its code — typed on `ShopCurrency`, so a third currency is a compile error here (§686). */
const CURRENCY_WORD: Record<ShopCurrency, "currencyRon" | "currencyEur"> = { RON: "currencyRon", EUR: "currencyEur" };

/** Each club verb's glyph, by name (§170): the registry never crosses into a client island as an element. */
const VERB_GLYPH = { pay: "confirm", handOver: "checkIn", cancel: "cancel" } as const;

/**
 * «Magazin» / "Shop" (§683): the members' shop, rendered by its own top-bar section «Magazin»
 * (`/admin/shop`, §687; the file stays where §683 put it) — the catalogue, how the club is paid and
 * who hears of an order, and the orders.
 *
 * Read by `canReadShop` (whoever reads the participant list, §289, or holds the grant): the
 * Organizer reads all of it; every verb is `canManageShop`'s (`mayManage`) — the Administrator by
 * rank, or a colleague given «Gestionează magazinul» on «Echipa» (§687) — and its service asserts it
 * again against the same actor (BR-REQ-060-01).
 * Every write the members see asks first and toasts (§384); moving a product does not ask, as the
 * codes' arrows do not. The member's address beside an order only for a reader who already sees the
 * members' addresses (§550, `showEmail`).
 */
export default function ShopCard({
  products,
  settings,
  orders,
  ordersTotal,
  ordersQuery,
  productNames,
  accounts,
  items,
  noticeDescribes,
  storage,
  path,
  locale,
  words: t,
  cancel,
  messages,
  photoLabels,
  mayManage,
  showEmail,
}: {
  products: readonly AdminShopProduct[];
  settings: ShopSettings;
  orders: readonly AdminOrder[];
  /** Every order the filter names, counted — `orders` stops at `ORDERS_SHOWN_MAX`. */
  ordersTotal: number;
  ordersQuery: OrdersQuery;
  productNames: readonly { id: string; titleRo: string; titleEn: string }[];
  /** «Adaugă o comandă pentru un membru» (§690): the member accounts and the items it offers; empty for a reader who may not. */
  accounts: readonly ZoneAccount[];
  items: readonly OrderableItem[];
  /** Whether the privacy notice in force names `{{membersShop}}` in every language: until then members see no shop. */
  noticeDescribes: boolean;
  /** Whether this deployment can store a photo at all. */
  storage: boolean;
  /** This page's own address, for the orders' GET filter. */
  path: string;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  photoLabels: TeamPhotoLabels;
  mayManage: boolean;
  showEmail: boolean;
}) {
  const count = t(`members.shop.count.${countForm(products.length, locale)}`, { count: products.length });
  const visible = products.filter((product) => product.visible).length;
  return (
    <Paper variant="outlined" id="members-shop" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }} data-testid="members-shop">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <StorefrontIcon aria-hidden="true" sx={{ fontSize: 22 }} />
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
            {t("members.shop.heading")}
          </Typography>
          <Chip size="small" variant="outlined" label={count} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t("members.shop.help")}
        </Typography>
        {!noticeDescribes && (
          <Alert severity={visible > 0 ? "warning" : "info"} data-testid="shop-notice-missing">
            {t("members.shop.noticeMissing")}
          </Alert>
        )}
        {!mayManage && <Alert severity="info">{t("members.shop.readOnly")}</Alert>}

        <SettingsFold settings={settings} locale={locale} words={t} cancel={cancel} messages={messages} mayManage={mayManage} />

        {mayManage && (
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <summary>
              <AddCircleIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              {t("members.shop.add")}
            </summary>
            <ActionForm
              action={createShopProductAction}
              messages={messages}
              scope="product-new"
              data-testid="product-create-form"
              confirm={{ title: t("members.shop.createTitle"), body: t("members.shop.createBody"), confirmLabel: t("members.shop.create"), cancelLabel: cancel }}
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <ProductFields product={null} words={t} photoLabels={photoLabels} storage={storage} scope="new" />
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("members.shop.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
              </Box>
            </ActionForm>
          </Box>
        )}

        {products.length === 0 ? (
          <Typography variant="body2" data-testid="products-empty">
            {t("members.shop.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.shop.listLabel")}>
            {products.map((product, index) => (
              <ProductRow
                key={product.id}
                product={product}
                first={index === 0}
                last={index === products.length - 1}
                locale={locale}
                words={t}
                cancel={cancel}
                messages={messages}
                photoLabels={photoLabels}
                storage={storage}
                mayManage={mayManage}
              />
            ))}
          </Stack>
        )}

        <OrdersFold
          orders={orders}
          total={ordersTotal}
          query={ordersQuery}
          productNames={productNames}
          accounts={accounts}
          items={items}
          path={path}
          locale={locale}
          words={t}
          cancel={cancel}
          messages={messages}
          mayManage={mayManage}
          showEmail={showEmail}
        />
      </Stack>
    </Paper>
  );
}

/** «Cum se plătește» and «Cine primește comenzile»: whoever runs the shop writes them (§687); the Organizer reads them. */
function SettingsFold({
  settings,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
}: {
  settings: ShopSettings;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
}) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Box component="details" sx={BOXED_DISCLOSURE_SX} data-testid="shop-settings">
      <summary>
        <PaymentsIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
        {t("members.shop.settings")}
      </summary>
      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("members.shop.settingsHelp")}
        </Typography>
        {mayManage ? (
          <ActionForm
            action={saveShopSettingsAction}
            messages={messages}
            scope="shop-settings"
            confirm={{ title: t("members.shop.settingsTitle"), body: t("members.shop.settingsBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={2}>
              <Box sx={pairSx}>
                <RecallField
                  name="paymentRo"
                  label={t("members.shop.paymentRo")}
                  fullWidth
                  multiline
                  minRows={2}
                  defaultValue={settings.paymentRo ?? ""}
                  helperText={t("members.shop.paymentHelp")}
                  slotProps={{ htmlInput: { maxLength: PAYMENT_WORDS_MAX, lang: "ro" } }}
                />
                <RecallField
                  name="paymentEn"
                  label={t("members.shop.paymentEn")}
                  fullWidth
                  multiline
                  minRows={2}
                  defaultValue={settings.paymentEn ?? ""}
                  helperText={t("members.shop.bothOrNeither")}
                  slotProps={{ htmlInput: { maxLength: PAYMENT_WORDS_MAX, lang: "en" } }}
                />
              </Box>
              <RecallField
                name="ordersTo"
                label={t("members.shop.ordersTo")}
                type="email"
                fullWidth
                defaultValue={settings.ordersTo ?? ""}
                helperText={t("members.shop.ordersToHelp")}
                slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off" } }}
              />
              <Box>
                <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </Stack>
          </ActionForm>
        ) : (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
              {t("members.shop.paymentRo")}: {settings.paymentRo ?? t("members.shop.notSet")}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
              {t("members.shop.paymentEn")}: {settings.paymentEn ?? t("members.shop.notSet")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function stockWords(product: AdminShopProduct, t: Words): string {
  if (product.variants.every((variant) => variant.stock === null)) return t("members.shop.stockUnlimited");
  return product.variants
    .map((variant) => {
      const stock = variant.stock === null ? t("members.shop.stockNoLimit") : String(variant.stock);
      return variant.label ? `${variant.label}: ${stock}` : stock;
    })
    .join(" · ");
}

function ProductRow({
  product,
  first,
  last,
  locale,
  words: t,
  cancel,
  messages,
  photoLabels,
  storage,
  mayManage,
}: {
  product: AdminShopProduct;
  first: boolean;
  last: boolean;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  photoLabels: TeamPhotoLabels;
  storage: boolean;
  mayManage: boolean;
}) {
  const title = locale === "en" ? product.titleEn : product.titleRo;
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="productId" value={product.id} />
    </>
  );
  return (
    <Box component="li" id={`product-${product.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }} data-testid="shop-product">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
        {product.photo && (
          <TeamPhotoImage src={product.photo.thumbUrl} photo={{ width: product.photo.width, height: product.photo.height, crop: product.photo.crop }} width={72} radius={6} />
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {title}
          </Typography>
          <Typography variant="body2">{formatPrice(product.priceBani, product.currency, locale)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("members.shop.stockLine", { stock: stockWords(product, t) })}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
        <Chip size="small" color={product.visible ? "success" : "default"} label={product.visible ? t("members.shop.visible") : t("members.shop.hidden")} />
        {product.orders > 0 && <Chip size="small" variant="outlined" label={t(`members.shop.orders.${countForm(product.orders, locale)}`, { count: product.orders })} />}
        {(product.descriptionRo === null) !== (product.descriptionEn === null) && <Chip size="small" variant="outlined" color="warning" label={t("members.shop.oneLanguage")} />}
      </Stack>

      {mayManage && (
        <Stack direction="row" sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
          {!first && (
            <Box component="form" action={moveShopProductAction}>
              {hidden}
              <input type="hidden" name="direction" value="up" />
              <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("members.shop.moveUp", { title })} />
            </Box>
          )}
          {!last && (
            <Box component="form" action={moveShopProductAction}>
              {hidden}
              <input type="hidden" name="direction" value="down" />
              <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("members.shop.moveDown", { title })} />
            </Box>
          )}
          <ActionForm
            action={deleteShopProductAction}
            confirm={{
              title: t("members.shop.deleteTitle", { title }),
              body: product.orders > 0 ? t("members.shop.archiveBody") : t("members.shop.deleteBody"),
              confirmLabel: product.orders > 0 ? t("members.shop.archive") : t("members.shop.delete"),
              cancelLabel: cancel,
              destructive: true,
            }}
          >
            {hidden}
            <GlyphButton icon={product.orders > 0 ? "archive" : "delete"} type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
              {product.orders > 0 ? t("members.shop.archive") : t("members.shop.delete")}
            </GlyphButton>
          </ActionForm>
        </Stack>
      )}

      {mayManage && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>
            <EditIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("members.shop.edit")}
          </summary>
          <ActionForm
            action={saveShopProductAction}
            messages={messages}
            scope={`p${product.id.slice(0, 8)}`}
            data-testid={`product-save-${product.id}`}
            confirm={{ title: t("members.shop.saveTitle", { title }), body: t("members.shop.saveBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
          >
            {hidden}
            <RecallHidden name="expectedVersion" value={product.version} />
            <ProductFields product={product} words={t} photoLabels={photoLabels} storage={storage} scope={product.id.slice(0, 8)} />
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Box>
  );
}

/**
 * A product's boxes: the titles and the descriptions side by side from `sm` (both titles required, the
 * descriptions both or neither, §352), the price with its currency beside it («Moneda», lei or euro,
 * §686 — a native select, no client island), the variants one per line with their stock,
 * the «Stoc» box for a product without variants, «Vizibil în magazin», and the photo through «Echipa»'s
 * own picture field (§459, §541: upload or «Din galerie», then the crop box). The stock the form loaded
 * travels with it, so a save that did not touch a number leaves it as it stands now (§683).
 */
function ProductFields({
  product,
  words: t,
  photoLabels,
  storage,
  scope,
}: {
  product: AdminShopProduct | null;
  words: Words;
  photoLabels: TeamPhotoLabels;
  storage: boolean;
  scope: string;
}) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  const typed = product ? variantLinesAsTyped(product.variants) : { lines: "", singleStock: "" };
  return (
    <Stack spacing={2}>
      <Box sx={pairSx}>
        <RecallField
          name="titleRo"
          label={t("members.shop.titleRo")}
          required
          fullWidth
          defaultValue={product?.titleRo ?? ""}
          slotProps={{ htmlInput: { maxLength: PRODUCT_TITLE_MAX, lang: "ro" } }}
        />
        <RecallField
          name="titleEn"
          label={t("members.shop.titleEn")}
          required
          fullWidth
          defaultValue={product?.titleEn ?? ""}
          slotProps={{ htmlInput: { maxLength: PRODUCT_TITLE_MAX, lang: "en" } }}
        />
      </Box>
      <Box sx={pairSx}>
        <RecallField
          name="descriptionRo"
          label={t("members.shop.descriptionRo")}
          fullWidth
          multiline
          minRows={2}
          defaultValue={product?.descriptionRo ?? ""}
          helperText={t("members.shop.descriptionHelp")}
          slotProps={{ htmlInput: { maxLength: PRODUCT_DESCRIPTION_MAX, lang: "ro" } }}
        />
        <RecallField
          name="descriptionEn"
          label={t("members.shop.descriptionEn")}
          fullWidth
          multiline
          minRows={2}
          defaultValue={product?.descriptionEn ?? ""}
          helperText={t("members.shop.bothOrNeither")}
          slotProps={{ htmlInput: { maxLength: PRODUCT_DESCRIPTION_MAX, lang: "en" } }}
        />
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
        <RecallField
          name="price"
          label={t("members.shop.price")}
          required
          defaultValue={product ? minorAsTyped(product.priceBani) : ""}
          helperText={t("members.shop.priceHelp")}
          slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 12 } }}
          sx={{ flex: "1 1 160px", maxWidth: 260 }}
        />
        <RecallField
          select
          name="currency"
          label={t("members.shop.currency")}
          defaultValue={product?.currency ?? SHOP_CURRENCIES[0]}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ flex: "0 1 180px", minWidth: 160 }}
        >
          {SHOP_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {t(`members.shop.${CURRENCY_WORD[currency]}`)}
            </option>
          ))}
        </RecallField>
      </Box>
      <RecallField
        name="variants"
        label={t("members.shop.variants")}
        fullWidth
        multiline
        minRows={3}
        defaultValue={typed.lines}
        helperText={t("members.shop.variantsHelp", { max: VARIANTS_MAX, length: VARIANT_LABEL_MAX })}
        slotProps={{ htmlInput: { maxLength: VARIANTS_MAX * (VARIANT_LABEL_MAX + 10) } }}
      />
      <RecallField
        name="stock"
        label={t("members.shop.stock")}
        defaultValue={typed.singleStock}
        helperText={t("members.shop.stockHelp", { max: STOCK_MAX })}
        slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
        sx={{ maxWidth: 260 }}
      />
      {product && <input type="hidden" name="variantsLoaded" value={loadedStockJson(product.variants)} />}
      <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
        <RecallCheckbox name="visible" defaultChecked={product?.visible ?? false} style={{ width: 20, height: 20 }} />
        <Typography component="span" variant="body2">
          {t("members.shop.visibleSwitch")}
        </Typography>
      </Box>
      {storage ? (
        <TeamPhotoField
          photo={
            product?.photoAssetId && product.photo
              ? { id: product.photoAssetId, src: product.photo.webUrl, preview: product.photo.thumbUrl, width: product.photo.width, height: product.photo.height }
              : null
          }
          crop={product?.photo?.crop ?? null}
          labels={photoLabels}
          inputId={`shop-photo-${scope}`}
        />
      ) : (
        // No store on this deployment: the product keeps whatever photo it had, and gets none new.
        <input type="hidden" name="photoAssetId" value={product?.photoAssetId ?? ""} />
      )}
    </Stack>
  );
}

/**
 * The orders, newest first, under a GET filter (status, product) whose state is the address (§527's
 * shape), the fold opening by itself while a filter is in use; the CSV of the same filter; and the
 * shop manager's verbs on each row (`canManageShop`, §687), each asked first.
 */
function OrdersFold({
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
  total: number;
  query: OrdersQuery;
  productNames: readonly { id: string; titleRo: string; titleEn: string }[];
  accounts: readonly ZoneAccount[];
  items: readonly OrderableItem[];
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
    <Box component="details" id="shop-orders" open={inUse || undefined} sx={{ ...BOXED_DISCLOSURE_SX, scrollMarginTop: 16 }} data-testid="shop-orders">
      <summary>
        <ReceiptLongIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
        {t("members.shop.ordersHeading")} · {count}
      </summary>
      <Stack spacing={2} sx={{ mt: 1.5 }}>
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
    </Box>
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
  /** The list's filter, posted with each verb so the answer lands on the same list, open (§683). */
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
