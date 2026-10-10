import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { countOrdersForAdmin, listOrdersForAdmin, listProductNames, listProductsForAdmin, parseOrdersQuery } from "@/modules/content/shop/repository";
import { readShopSettings } from "@/modules/content/shop/settings";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import { canManageShop, canReadShop, canSeeShopMemberAddresses } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ShopCard from "../pages/members/ShopCard";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; orderStatus?: string; orderProduct?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Magazin» — the members' shop as its own section of the backoffice (§687): the catalogue, «Cum se
 * plătește», «Cine primește comenzile» and the orders, the card of §683 unchanged.
 *
 * It was a card on «Pagini» → «Membri», a page the volunteer cannot open; a volunteer given
 * «Gestionează magazinul» on «Echipa» had no way in. Read by whoever reads the shop (`canReadShop`):
 * the Organizer and the Administrators by role, and a holder of the grant whatever their rung — the
 * layout asks it first, for the status code, and this page again. Every verb is offered to
 * `canManageShop` and asserted by its action and its service (BR-REQ-060-01); the member's address
 * beside an order only for a role that already reads the members' addresses (§550) — never by the
 * grant.
 */
export default async function AdminShopPage({ params, searchParams }: Props) {
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
  const now = new Date();
  const ordersQuery = parseOrdersQuery(query);
  const [products, settings, orders, productNames, noticeDescribes, ordersTotal] = await Promise.all([
    listProductsForAdmin(db),
    readShopSettings(db),
    listOrdersForAdmin(db, ordersQuery),
    listProductNames(db),
    noticeDescribesMembersShop(db, now),
    countOrdersForAdmin(db, ordersQuery),
  ]);
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  // The shop's boxes (§683), by the names their forms post.
  const messages = await refusalMessages({
    titleRo: t("members.shop.titleRo"),
    titleEn: t("members.shop.titleEn"),
    descriptionRo: t("members.shop.descriptionRo"),
    descriptionEn: t("members.shop.descriptionEn"),
    price: t("members.shop.price"),
    variants: t("members.shop.variants"),
    stock: t("members.shop.stock"),
    photoAssetId: t("members.shop.photo"),
    paymentRo: t("members.shop.paymentRo"),
    paymentEn: t("members.shop.paymentEn"),
    ordersTo: t("members.shop.ordersTo"),
  });
  const photoLabels: TeamPhotoLabels = {
    legend: t("members.shop.photo"),
    choose: t("team.photoChoose"),
    replace: t("team.photoReplace"),
    remove: t("team.photoRemove"),
    uploading: t("team.photoUploading"),
    failed: t("team.photoFailed"),
    none: t("team.photoNone"),
    help: t("members.shop.photoHelp"),
    fromGallery: t("team.photoFromGallery"),
    gallery: {
      loading: t("richText.imageGalleryLoading"),
      empty: t("richText.imageGalleryEmpty"),
      close: t("richText.linkCancel"),
      filter: t("richText.imageGalleryFilter"),
      noMatch: t("richText.imageGalleryNoMatch"),
      sourceLegend: t("richText.imageGallerySourceLegend"),
      sources: {
        all: t("richText.imageGallerySourceAll"),
        event: t("richText.imageGallerySourceEvent"),
        album: t("richText.imageGallerySourceAlbum"),
        page: t("richText.imageGallerySourcePage"),
        team: t("richText.imageGallerySourceTeam"),
      },
    },
    quality: {
      legend: t("gallery.qualityLegend"),
      low: t("gallery.qualityLow"),
      normal: t("gallery.qualityNormal"),
      high: t("gallery.qualityHigh"),
      original: t("gallery.qualityOriginal"),
      help: t("gallery.qualityHelp", {
        lowMax: String(LOW_WEB_MAX),
        normalMax: String(WEB_MAX),
        highMax: String(HIGH_WEB_MAX),
        originalMax: String(ORIGINAL_WEB_MAX),
      }),
    },
    crop: {
      title: t("members.shop.photoCrop"),
      help: t("members.shop.photoCropHelp"),
      reset: rich.imageCropReset,
      position: rich.imageCropPosition,
      ...rich.imageShapes,
    },
    chosen: rich.imageChosen,
    stored: rich.imageStored,
    picked: rich.imageFromGalleryPicked,
  };

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <ShopCard
        products={products}
        settings={settings}
        orders={orders}
        ordersTotal={ordersTotal}
        ordersQuery={ordersQuery}
        productNames={productNames}
        noticeDescribes={noticeDescribes}
        storage={isStorageConfigured()}
        path={getPathname({ locale, href: "/admin/shop" })}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        photoLabels={photoLabels}
        mayManage={canManageShop(actor)}
        showEmail={canSeeShopMemberAddresses(actor.role)}
      />
    </Stack>
  );
}
