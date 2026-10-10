import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RemoveShoppingCartIcon from "@mui/icons-material/RemoveShoppingCart";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import StorefrontIcon from "@mui/icons-material/Storefront";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { formatLei, ORDER_NOTE_MAX, ORDER_QUANTITY_MAX, orderTotalBani } from "@/modules/content/shop/domain";
import type { MemberOrder, MembersShopProduct } from "@/modules/content/shop/repository";
import type { ShopOutcome } from "@/modules/content/shop/zone-outcome";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import { FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { cancelShopOrderAction, placeShopOrderAction } from "./actions";

/** The native controls' look on a public page: a 44 px box with the theme's border, no client island. */
const CONTROL_SX = {
  minHeight: 44,
  px: 1.25,
  font: "inherit",
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  bgcolor: "background.paper",
  color: "text.primary",
} as const;

/**
 * «Magazinul clubului» and «Comenzile mele» in the members' zone (§683), drawn on the server with
 * plain forms and native controls — no client island, so an order works with JavaScript off.
 *
 * The page calls this only behind the account (`canOpenMembersZone`), and draws the shop only while
 * the privacy notice in force names `{{membersShop}}` in every language (`shopOpen`); the order action
 * asserts the same gate on the server. «Comenzile mele» is drawn whenever the member has orders, the
 * shop open or not: an order placed stays the member's to read. The club's payment words are under
 * every order still waiting for payment — payment is never on the site.
 */
export default async function MembersShop({
  products,
  orders,
  payment,
  shopOpen,
  outcome,
  outcomeAtOrders = false,
  locale,
}: {
  products: readonly MembersShopProduct[];
  orders: readonly MemberOrder[];
  /** «Cum se plătește» in this language, or null while the club has not written it in both. */
  payment: string | null;
  shopOpen: boolean;
  outcome: ShopOutcome | null;
  /** The answer came back to «Comenzile mele» (a placed order, or a cancel, refused or not). */
  outcomeAtOrders?: boolean;
  locale: Locale;
}) {
  const t = await getTranslations("Members");
  const showShop = shopOpen && products.length > 0;
  if (!showShop && orders.length === 0) return null;
  const banner = outcome ? (
    <Alert severity={outcome === "placed" || outcome === "cancelled" ? "success" : "error"} sx={{ mb: 2 }} data-testid="members-shop-outcome">
      {t(`shop.outcome.${outcome}`)}
    </Alert>
  ) : null;
  // The answer is drawn where the redirect's anchor lands: «Comenzile mele» after an order or a cancel
  // (a refused cancel included), otherwise the shop; the orders when the shop is not drawn at all.
  const bannerInOrders = orders.length > 0 && (outcomeAtOrders || !showShop);
  return (
    <>
      {showShop && (
        <Box component="section" id="members-shop" aria-labelledby="members-shop-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 }, scrollMarginTop: 16 }} data-testid="members-shop">
          <Typography id="members-shop-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
            <StorefrontIcon aria-hidden="true" sx={{ fontSize: 22 }} />
            {t("shop.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("shop.lead")}
          </Typography>
          {!bannerInOrders && banner}
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} locale={locale} t={t} />
            ))}
          </Box>
        </Box>
      )}

      {orders.length > 0 && (
        <Box component="section" id="members-orders" aria-labelledby="members-orders-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 }, scrollMarginTop: 16 }} data-testid="members-orders">
          <Typography id="members-orders-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
            <ReceiptLongIcon aria-hidden="true" sx={{ fontSize: 22 }} />
            {t("shop.ordersTitle")}
          </Typography>
          {bannerInOrders && banner}
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {orders.map((order) => {
              const title = locale === "en" ? order.productTitleEn : order.productTitleRo;
              return (
                <Box component="li" key={order.id} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }} data-testid="member-order">
                  <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
                      {t("shop.orderNumber", { number: order.number })}
                    </Typography>
                    <Chip size="small" color={order.status === "CANCELLED" ? "default" : order.status === "PLACED" ? "warning" : "success"} label={t(`shop.status.${order.status}`)} />
                  </Stack>
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                    {title}
                    {order.variantLabel ? ` — ${order.variantLabel}` : ""} × {order.quantity} · {formatLei(orderTotalBani(order), locale)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDay(order.createdAt, { locale, timeZone: CLUB_TIME_ZONE, withTime: true })}
                  </Typography>
                  {order.note && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                      {t("shop.note")}: {order.note}
                    </Typography>
                  )}
                  {order.status === "PLACED" && (
                    <>
                      <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-line", overflowWrap: "anywhere" }} data-testid="member-order-payment">
                        <strong>{t("shop.howToPay")}</strong> {payment ?? t("shop.paymentByClub")}
                      </Typography>
                      {/* The member's own cancel, behind a fold that says what it does: no script asks first on a public page. */}
                      <Box component="details" sx={{ mt: 1 }}>
                        <Box component="summary" sx={{ ...TAP_TARGET, display: "inline-flex", alignItems: "center", cursor: "pointer", color: "text.secondary", gap: 0.75 }}>
                          <RemoveShoppingCartIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
                          {t("shop.cancelFold")}
                        </Box>
                        <Box component="form" action={cancelShopOrderAction} sx={{ mt: 1 }}>
                          <input type="hidden" name="uiLocale" value={locale} />
                          <input type="hidden" name="orderId" value={order.id} />
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {t("shop.cancelHelp")}
                          </Typography>
                          <Box data-testid="member-order-cancel">
                            <SubmitButton label={t("shop.cancel")} pendingLabel={t("shop.cancelling")} variant="outlined" color="error" size="medium">
                              <RemoveShoppingCartIcon />
                            </SubmitButton>
                          </Box>
                        </Box>
                      </Box>
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </>
  );
}

function ProductCard({ product, locale, t }: { product: MembersShopProduct; locale: Locale; t: Awaited<ReturnType<typeof getTranslations<"Members">>> }) {
  const offered = product.variants.filter((variant) => !variant.soldOut);
  const single = product.variants.length === 1 && product.variants[0].label === null;
  const id = product.id.slice(0, 8);
  return (
    <Box component="li" sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, minWidth: 0 }} data-testid="members-shop-product">
      {product.photo && (
        <Box sx={{ mb: 1.5, maxWidth: 320 }}>
          <TeamPhotoImage
            src={product.photo.webUrl}
            photo={{ width: product.photo.width, height: product.photo.height, crop: product.photo.crop }}
            radius={8}
            loading="lazy"
          />
        </Box>
      )}
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
        {product.title}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        {formatLei(product.priceBani, locale)}
      </Typography>
      {product.description && (
        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-line" }}>
          {product.description}
        </Typography>
      )}
      {offered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("shop.soldOut")}
        </Typography>
      ) : (
        <Box component="form" action={placeShopOrderAction} sx={{ mt: 1.5, display: "grid", gap: 1.25 }}>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="productId" value={product.id} />
          {single ? (
            <input type="hidden" name="variantId" value={offered[0].id} />
          ) : (
            <Box component="label" htmlFor={`shop-variant-${id}`} sx={{ display: "grid", gap: 0.5 }}>
              <Typography component="span" variant="body2">
                {t("shop.variant")}
              </Typography>
              <Box component="select" id={`shop-variant-${id}`} name="variantId" required sx={CONTROL_SX}>
                {product.variants.map((variant) => (
                  <option key={variant.id} value={variant.id} disabled={variant.soldOut}>
                    {variant.soldOut ? t("shop.variantSoldOut", { label: variant.label ?? "" }) : variant.label}
                  </option>
                ))}
              </Box>
            </Box>
          )}
          <Box component="label" htmlFor={`shop-quantity-${id}`} sx={{ display: "grid", gap: 0.5 }}>
            <Typography component="span" variant="body2">
              {t("shop.quantity")}
            </Typography>
            <Box component="select" id={`shop-quantity-${id}`} name="quantity" defaultValue="1" sx={{ ...CONTROL_SX, maxWidth: 120 }}>
              {Array.from({ length: ORDER_QUANTITY_MAX }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </Box>
          </Box>
          <Box component="label" htmlFor={`shop-note-${id}`} sx={{ display: "grid", gap: 0.5 }}>
            <Typography component="span" variant="body2">
              {t("shop.noteLabel", { max: ORDER_NOTE_MAX })}
            </Typography>
            <Box component="textarea" id={`shop-note-${id}`} name="note" rows={2} maxLength={ORDER_NOTE_MAX} sx={{ ...CONTROL_SX, py: 1, resize: "vertical" }} />
          </Box>
          {/* The pending button (§683): a second tap while the order is in flight is held; the server answers a repeat with the same order. */}
          <Box data-testid="members-shop-order">
            <SubmitButton label={t("shop.order")} pendingLabel={t("shop.ordering")} size="medium">
              <ShoppingCartIcon />
            </SubmitButton>
          </Box>
        </Box>
      )}
    </Box>
  );
}
