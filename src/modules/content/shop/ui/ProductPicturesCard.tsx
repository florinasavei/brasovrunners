import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { PICTURES_MAX } from "@/modules/content/shop/domain";
import type { AdminShopProduct, ShopPictureRow } from "@/modules/content/shop/repository";
import TeamPhotoField, { type TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import SubmitButton from "@/shared/ui/SubmitButton";
import { addShopPictureAction, moveShopPictureAction, removeShopPictureAction, replaceShopPictureAction } from "@/app/[locale]/admin/shop/actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The two folds' glyphs from the one registry (§694): a picture added beside the others, and one put in a stored one's place (§673). */
const AddIcon = ACTION_ICONS.upload;
const ReplaceIcon = ACTION_ICONS.replace;

type Props = {
  /** Null on the new product's page: the pictures come once the product exists. */
  product: AdminShopProduct | null;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  photoLabels: TeamPhotoLabels;
  /** Whether this deployment can store a picture at all. */
  storage: boolean;
  mayManage: boolean;
};

/**
 * «Fotografiile» (§NNN; the owner: «I need to be able to add multiple pictures of the product»):
 * the product's strip, the first picture its cover, each with ↑ / ↓ (plain forms, asking nothing,
 * the codes' arrows), «Scoate» (asked first — members see the strip) and a fold «Înlocuiește sau
 * decupează» holding «Echipa»'s picture field (§541) with the picture and its crop as stored, so a
 * new crop or another picture is one save. Under the strip, «Adaugă o fotografie»: the same field,
 * empty — upload with the quality choice, «Din galerie», the crop box — and one button; at most
 * `PICTURES_MAX`. Each picture is its own small form, so a slow upload never holds the product's
 * boxes hostage, and the product form's version is untouched by a picture (`service.ts`).
 *
 * On the new product's page the card says the pictures come after the first save. For a reader who
 * may not manage the shop, the strip alone.
 */
export default function ProductPicturesCard({ product, locale, words: t, cancel, messages, photoLabels, storage, mayManage }: Props) {
  const pictures = product?.pictures ?? [];
  const aside = product ? t(`members.shop.pictures.count.${countForm(pictures.length, locale)}`, { count: pictures.length }) : undefined;
  return (
    <Panel glyph="pictures" title={t("members.shop.pictures.title")} aside={aside} intro={t("members.shop.pictures.help", { max: PICTURES_MAX })} id="product-pictures" data-testid="product-pictures-card">
      {!product ? (
        <Typography variant="body2" color="text.secondary" data-testid="pictures-after-save">
          {t("members.shop.pictures.afterSave")}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {pictures.length === 0 ? (
            <Typography variant="body2" color="text.secondary" data-testid="pictures-empty">
              {t("members.shop.pictures.empty")}
            </Typography>
          ) : (
            <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.shop.pictures.title")}>
              {pictures.map((picture, index) => (
                <PictureRow
                  key={picture.id}
                  product={product}
                  picture={picture}
                  first={index === 0}
                  last={index === pictures.length - 1}
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
          {mayManage && !storage && <Alert severity="info">{t("members.shop.pictures.noStorage")}</Alert>}
          {mayManage && storage && pictures.length < PICTURES_MAX && (
            <Box component="details" open={pictures.length === 0 || undefined} sx={BOXED_DISCLOSURE_SX} data-testid="picture-add">
              <summary>
                <AddIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
                {t("members.shop.pictures.add")}
              </summary>
              <ActionForm action={addShopPictureAction} messages={messages} scope="picture-new" data-testid="picture-add-form">
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="productId" value={product.id} />
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                  <TeamPhotoField photo={null} crop={null} labels={photoLabels} inputId="shop-picture-new" />
                  <Box>
                    <GlyphSubmitButton label={t("members.shop.pictures.addButton")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
                  </Box>
                </Stack>
              </ActionForm>
            </Box>
          )}
        </Stack>
      )}
    </Panel>
  );
}

function PictureRow({
  product,
  picture,
  first,
  last,
  locale,
  words: t,
  cancel,
  messages,
  photoLabels,
  storage,
  mayManage,
}: Omit<Props, "product"> & { product: AdminShopProduct; picture: ShopPictureRow; first: boolean; last: boolean }) {
  const scope = `pic${picture.id.slice(0, 8)}`;
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="pictureId" value={picture.id} />
    </>
  );
  return (
    <Box component="li" id={`picture-${picture.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }} data-testid="shop-picture">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {picture.photo ? (
          <TeamPhotoImage src={picture.photo.thumbUrl} photo={{ width: picture.photo.width, height: picture.photo.height, crop: picture.photo.crop }} width={96} radius={8} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("members.shop.pictures.gone")}
          </Typography>
        )}
        <Stack spacing={0.5}>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
            {first && <GlyphChip glyph="featured" color="primary" label={t("members.shop.pictures.cover")} testId="picture-cover" />}
            <Typography variant="body2" color="text.secondary">
              {t("members.shop.pictures.position", { number: picture.position })}
            </Typography>
          </Stack>
          {mayManage && (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              {!first && (
                <Box component="form" action={moveShopPictureAction}>
                  {hidden}
                  <input type="hidden" name="direction" value="up" />
                  <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("members.shop.pictures.moveUp", { number: picture.position })} />
                </Box>
              )}
              {!last && (
                <Box component="form" action={moveShopPictureAction}>
                  {hidden}
                  <input type="hidden" name="direction" value="down" />
                  <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("members.shop.pictures.moveDown", { number: picture.position })} />
                </Box>
              )}
              <ActionForm
                action={removeShopPictureAction}
                confirm={{ title: t("members.shop.pictures.removeTitle"), body: t("members.shop.pictures.removeBody"), confirmLabel: t("members.shop.pictures.remove"), cancelLabel: cancel, destructive: true }}
              >
                {hidden}
                <GlyphButton icon="delete" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
                  {t("members.shop.pictures.remove")}
                </GlyphButton>
              </ActionForm>
            </Stack>
          )}
        </Stack>
      </Stack>
      {mayManage && storage && picture.photo && picture.assetId && (
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
          <summary>
            <ReplaceIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("members.shop.pictures.replace")}
          </summary>
          <ActionForm action={replaceShopPictureAction} messages={messages} scope={scope} data-testid={`picture-replace-${picture.id}`}>
            {hidden}
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              <TeamPhotoField
                photo={{ id: picture.assetId, src: picture.photo.webUrl, preview: picture.photo.thumbUrl, width: picture.photo.width, height: picture.photo.height }}
                crop={picture.photo.crop}
                labels={photoLabels}
                inputId={`shop-picture-${scope}`}
              />
              <Box>
                <GlyphSubmitButton label={t("members.shop.pictures.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Box>
  );
}
