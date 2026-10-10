import CardMembershipIcon from "@mui/icons-material/CardMembership";
import LockPersonIcon from "@mui/icons-material/LockPerson";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import {
  MEMBERS_TEXT_MAX,
  type MembersPageSettings,
  type MembersText,
  membersTextDocs,
  readMembersPageSettings,
} from "@/modules/content/members/page-settings";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { clubToday, listDiscountCodesForAdmin } from "@/modules/content/member-codes/repository";
import { countOrdersForAdmin, listOrdersForAdmin, listProductNames, listProductsForAdmin, parseOrdersQuery } from "@/modules/content/shop/repository";
import { readShopSettings } from "@/modules/content/shop/settings";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import {
  canEditDiscountCodeWords,
  canEditMembersPage,
  canManageDiscountCodes,
  canManageStaff,
  canManageShop,
  canPublishMembersPage,
  canReadContent,
  canReadShop,
  canSeeShopMemberAddresses,
} from "@/modules/staff-identity/domain/roles";
import { countMembers } from "@/modules/staff-identity/repository";
import { requireStaff } from "@/modules/staff-identity/session";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import { saveMembersTextAction, setMembersPagePublishedAction } from "./actions";
import CodesCard from "./CodesCard";
import ShopCard from "./ShopCard";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; orderStatus?: string; orderProduct?: string }>;
};

export const dynamic = "force-dynamic";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The two editors of a text, in the site's order: the tab's code, the posted name's part (§572). */
const LANGUAGES = [
  { locale: "ro", code: "RO", suffix: "Ro" },
  { locale: "en", code: "EN", suffix: "En" },
] as const;

/**
 * The members' pages in the backoffice (§524), «Membri» in the «Pagini standard» group of «Pagini»: «Beneficiile
 * membrilor» — whether it is on the site, and its words — and the members' zone's words.
 *
 * Read by whoever reads the club's content (§208); writing either text is the Redactor's and the
 * Administrator's (`canEditMembersPage`), putting the public page on the site the Administrator's
 * (`canPublishMembersPage`, §201). Every control is offered only to the role its action asserts, and
 * the action asserts it again (BR-REQ-060-01).
 *
 * Who is a member is not decided here: a member is an account, added on the team page as «Membru»
 * with the same invitation a colleague gets (§524). The screen says how many there are, and links
 * there for a reader who may add one.
 */
export default async function AdminMembersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const query = await searchParams;
  const { saved, error } = query;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const db = getDb();
  const [settings, members, codes] = await Promise.all([readMembersPageSettings(db), countMembers(db), listDiscountCodesForAdmin(db)]);
  const mayEdit = canEditMembersPage(actor.role);
  const mayPublish = canPublishMembersPage(actor.role);
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const messages = await refusalMessages({
    benefitsRoBody: t("members.benefitsRo"),
    benefitsEnBody: t("members.benefitsEn"),
    zoneRoBody: t("members.zoneRo"),
    zoneEnBody: t("members.zoneEn"),
    // The discount codes' boxes (§552), by the names their forms post.
    partnerName: t("members.codes.partner"),
    code: t("members.codes.code"),
    descriptionRo: t("members.codes.descriptionRo"),
    descriptionEn: t("members.codes.descriptionEn"),
    link: t("members.codes.link"),
    validUntil: t("members.codes.validUntil"),
    // The shop's boxes (§NNN), by the names their forms post.
    titleRo: t("members.shop.titleRo"),
    titleEn: t("members.shop.titleEn"),
    price: t("members.shop.price"),
    variants: t("members.shop.variants"),
    stock: t("members.shop.stock"),
    photoAssetId: t("members.shop.photo"),
    paymentRo: t("members.shop.paymentRo"),
    paymentEn: t("members.shop.paymentEn"),
    ordersTo: t("members.shop.ordersTo"),
  });
  /*
    «Magazin» (§NNN): read only for a role that reads the shop (`canReadShop`, the Organizer up); the
    Redactor and the Tehnic, who read this page's texts, are given no part of it — not even a count.
  */
  const now = new Date();
  const ordersQuery = parseOrdersQuery(query);
  const shop = canReadShop(actor.role)
    ? await Promise.all([
        listProductsForAdmin(db),
        readShopSettings(db),
        listOrdersForAdmin(db, ordersQuery),
        listProductNames(db),
        noticeDescribesMembersShop(db, now),
        countOrdersForAdmin(db, ordersQuery),
      ])
    : null;
  const shopPhotoLabels: TeamPhotoLabels = {
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
      <PagesSubNav locale={locale} active="members" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("members.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("members.intro")}
        </Typography>
        <Typography variant="body2" data-testid="members-count">
          {t("members.count", { count: members })}{" "}
          {canManageStaff(actor.role) && (
            <MuiLink href={getPathname({ locale, href: "/admin/staff" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("members.addOnTeam")}
            </MuiLink>
          )}
        </Typography>
        {!mayEdit && <Alert severity="info">{t("members.readOnly")}</Alert>}
        {mayEdit && !mayPublish && <Alert severity="info">{t("members.publishIsAdmin")}</Alert>}
      </Stack>

      <PublicPageCard settings={settings} locale={locale} words={t} cancel={words.cancel} mayPublish={mayPublish} />

      <TextCard
        text="benefits"
        settings={settings}
        locale={locale}
        words={t}
        messages={messages}
        rich={rich}
        mayEdit={mayEdit}
      />
      <TextCard text="zone" settings={settings} locale={locale} words={t} messages={messages} rich={rich} mayEdit={mayEdit} />

      {/* «Coduri de reducere» (§552): shown only inside the members' zone, never on a public page. */}
      <CodesCard
        codes={codes}
        today={clubToday(new Date())}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        mayManage={canManageDiscountCodes(actor.role)}
        mayEditWords={canEditDiscountCodeWords(actor.role)}
      />

      {/* «Magazin» (§NNN): the members' shop — the Organizer reads it, the Administrator runs it. */}
      {shop && (
        <ShopCard
          products={shop[0]}
          settings={shop[1]}
          orders={shop[2]}
          ordersTotal={shop[5]}
          ordersQuery={ordersQuery}
          productNames={shop[3]}
          noticeDescribes={shop[4]}
          storage={isStorageConfigured()}
          path={getPathname({ locale, href: "/admin/pages/members" })}
          locale={locale}
          words={t}
          cancel={words.cancel}
          messages={messages}
          photoLabels={shopPhotoLabels}
          mayManage={canManageShop(actor.role)}
          showEmail={canSeeShopMemberAddresses(actor.role)}
        />
      )}
    </Stack>
  );
}

/** «Beneficiile membrilor» as a page: on the site or not, and the switch — the Administrator's, asked first (§384). */
function PublicPageCard({
  settings,
  locale,
  words: t,
  cancel,
  mayPublish,
}: {
  settings: MembersPageSettings;
  locale: Locale;
  words: Words;
  cancel: string;
  mayPublish: boolean;
}) {
  const published = settings.status === "PUBLISHED";
  const ro = getPathname({ locale: "ro", href: "/members" });
  const en = getPathname({ locale: "en", href: "/members" });
  return (
    <Paper variant="outlined" id="members-page" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("members.pageHeading")}
          </Typography>
          <Chip size="small" color={published ? "success" : "default"} label={published ? t("members.pagePublished") : t("members.pageDraft")} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {published ? t("members.pagePublishedHelp", { ro, en }) : t("members.pageDraftHelp")}
        </Typography>
        {mayPublish && (
          <ActionForm
            action={setMembersPagePublishedAction}
            confirm={
              published
                ? { title: t("members.unpublishTitle"), body: t("members.unpublishBody"), confirmLabel: t("members.unpublish"), cancelLabel: cancel, destructive: true }
                : { title: t("members.publishTitle"), body: t("members.publishBody", { ro, en }), confirmLabel: t("members.publish"), cancelLabel: cancel }
            }
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="published" value={published ? "false" : "true"} />
            <GlyphButton
              icon={published ? "unpublish" : "publish"}
              type="submit"
              variant={published ? "outlined" : "contained"}
              color={published ? "warning" : "primary"}
              sx={{ minHeight: 44 }}
            >
              {published ? t("members.unpublish") : t("members.publish")}
            </GlyphButton>
          </ActionForm>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * One of the two texts: its state on the line, and the two editors in a fold — tabs «RO» | «EN»
 * (§572), both or neither (§352), the whole toolbar of a page's column (§474), the one «Copiază și
 * tradu tot» above them (§482). Closed until opened, like every backoffice fold (§336).
 */
function TextCard({
  text,
  settings,
  locale,
  words: t,
  messages,
  rich,
  mayEdit,
}: {
  text: MembersText;
  settings: MembersPageSettings;
  locale: Locale;
  words: Words;
  messages: RefusalMessages;
  rich: ReturnType<typeof richTextEditorLabels>;
  mayEdit: boolean;
}) {
  const docs = membersTextDocs(settings, text);
  const written = docs.ro !== null && docs.en !== null;
  return (
    <Paper variant="outlined" id={`members-${text}`} sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t(`members.${text}Heading`)}
          </Typography>
          <Chip size="small" variant="outlined" color={written ? "success" : "default"} label={written ? t("members.written") : t("members.notWritten")} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t(`members.${text}Help`)}
        </Typography>
        {mayEdit && (
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <summary>
              {/* The glyph the «Pagini» row gives this text (§524): the benefits' card, the zone's lock. */}
              {text === "benefits" ? (
                <CardMembershipIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              ) : (
                <LockPersonIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
              )}
              {t(`members.${text}Fold`)}
            </summary>
            <ActionForm action={saveMembersTextAction} messages={messages} scope={text} data-testid={`members-${text}-form`}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="text" value={text} />
              <Stack spacing={1.5}>
                {/*
                  «Copiază și tradu tot: RO → EN» (§464, §482): this text's English from its Romanian,
                  above the tabs so it is there whichever language is on top; the English tab comes
                  forward after it, marked «tradus — verifică» (§572).
                */}
                <TranslateAllButton />
                {/*
                  The two languages as tabs «RO» | «EN» with the header's flags, one editor on screen
                  at a time (§572; the owner, 2026-09-29: «partea bilingvă trebuie să fie per tabs»).
                  The other language's editor stays in the form, hidden, so the save posts both
                  (§352); a refusal naming the English brings its tab forward (§47).
                */}
                <LocaleTabPanels
                  idPrefix={`members-${text}`}
                  watch={{ names: [`${text}{Locale}Body`], rule: "required" }}
                  markLabel={t("members.tabEmpty")}
                  panels={LANGUAGES.map((language) => ({
                    locale: language.locale,
                    label: language.code,
                    incompleteLabel: docs[language.locale] === null ? t("members.tabEmpty") : undefined,
                    content: (
                      <LazyRichTextEditor
                        name={`${text}${language.suffix}Body`}
                        label={t(`members.${text}${language.suffix}`)}
                        summary={t(`members.${text}${language.suffix}`)}
                        emptyHint={t("members.textEmpty")}
                        initialBody={docs[language.locale]}
                        accessibleSuffix={language.code}
                        labels={rich}
                      />
                    ),
                  }))}
                />
                <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
                  {t("members.textHelp", { max: MEMBERS_TEXT_MAX })}
                </Typography>
              </Stack>
              <Box sx={{ mt: 2 }}>
                <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </ActionForm>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
