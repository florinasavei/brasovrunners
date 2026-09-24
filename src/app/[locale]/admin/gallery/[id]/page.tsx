import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findAlbumForEditor, listEventsForAlbumSelect } from "@/modules/content/gallery/repository";
import AlbumFieldsForm from "@/modules/content/gallery/ui/AlbumFieldsForm";
import { albumFormFieldLabels } from "@/modules/content/gallery/ui/field-labels";
import PhotoUploader from "@/modules/content/gallery/ui/PhotoUploader";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import { RecallHidden } from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { isStorageConfigured } from "@/modules/media/storage";
import { allowedTransitions, canEditEventFields, isEditorial } from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_TRANSITION_ICON,
  EDITORIAL_TRANSITION_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import { deleteAlbumAction, deletePhotoAction, saveAlbumAction, setCoverAction, transitionAlbumAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One album: its fields, its workflow, and its photos — upload, remove, choose the cover
 * (BR-REQ-054-01). The photo grid is plain images in a CSS grid; the only client code on the
 * page is the uploader, which has to run where the original photo is.
 */
export default async function EditAlbumPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!isEditorial(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§NNN).
  if (!isUuid(id)) notFound();

  const db = getDb();
  const found = await findAlbumForEditor(db, id);
  if (!found) notFound();
  const { album, translations, photos } = found;
  const events = await listEventsForAlbumSelect(db, locale);

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const isOwnDraft = album.createdByStaffUserId === actor.id;
  const transitions = allowedTransitions(actor.role, album.editorialStatus, isOwnDraft);
  const mayEdit = canEditEventFields(actor.role);
  const title = translations.find((row) => row.locale === locale)?.title ?? "";

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/gallery">{t("gallery.backToList")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {title}
        </Typography>
        <Chip size="small" label={EDITORIAL_STATUS_LABEL[album.editorialStatus]} />
        <Chip size="small" variant="outlined" label={t("editor.version", { version: album.version })} />
      </Stack>

      {/* Said before the publish button: an album with no photo cannot go live. */}
      {photos.length === 0 && <Alert severity="info">{t("gallery.noPhotosYet")}</Alert>}

      {transitions.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {transitions.map((to) => (
            <form action={transitionAlbumAction} key={to}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="albumId" value={album.id} />
              <input type="hidden" name="expectedVersion" value={album.version} />
              <input type="hidden" name="to" value={to} />
              <GlyphButton icon={EDITORIAL_TRANSITION_ICON[to]} type="submit" size="small" variant="outlined" sx={{ minHeight: 44 }}>
                {EDITORIAL_TRANSITION_LABEL[to]}
              </GlyphButton>
            </form>
          ))}
        </Stack>
      )}

      <Divider />

      {/* The photos: what the page exists for, so before the fields. */}
      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1.125rem", mb: 1 }}>
          {t("gallery.photos", { count: photos.length })}
        </Typography>
        {mayEdit &&
          (isStorageConfigured() ? (
            <Box sx={{ mb: 2 }}>
              <PhotoUploader
                uploadUrl={`/api/admin/gallery/${album.id}/photos`}
                labels={{
                  choose: t("gallery.upload"),
                  uploading: t.raw("gallery.uploading") as string,
                  done: t.raw("gallery.uploaded") as string,
                  failed: t.raw("gallery.uploadFailed") as string,
                }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("gallery.uploadHelp")}
              </Typography>
            </Box>
          ) : (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t("gallery.storageUnconfigured")}
            </Alert>
          ))}

        {photos.length > 0 && (
          <Box
            component="ul"
            sx={{
              listStyle: "none",
              m: 0,
              p: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 1.5,
            }}
          >
            {photos.map((photo) => {
              return (
                <Box component="li" key={photo.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP variant, sized on upload */}
                  <img
                    src={photo.thumbUrl}
                    alt={t("gallery.photoAlt", { n: photo.position, title })}
                    width={photo.width}
                    height={photo.height}
                    loading="lazy"
                    style={{ display: "block", width: "100%", height: "auto", borderRadius: 4 }}
                  />
                  {mayEdit && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                      <form action={setCoverAction}>
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="albumId" value={album.id} />
                        <input type="hidden" name="itemId" value={photo.id} />
                        <GlyphButton icon="cover" type="submit" size="small" variant="text" sx={{ minHeight: 44 }}>
                          {t("gallery.setCover")}
                        </GlyphButton>
                      </form>
                      <form action={deletePhotoAction}>
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name="albumId" value={album.id} />
                        <input type="hidden" name="itemId" value={photo.id} />
                        <ConfirmSubmitButton
                          label={t("gallery.removePhoto")}
                          icon="delete"
                          title={t("gallery.removePhotoTitle")}
                          body={t("gallery.removePhotoBody")}
                          confirmLabel={t("gallery.removePhoto")}
                          cancelLabel={t("confirm.cancel")}
                          color="error"
                        />
                      </form>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Divider />

      {mayEdit ? (
        // A refusal comes back with every box still filled (§315).
        <ActionForm action={saveAlbumAction} messages={await refusalMessages(await albumFormFieldLabels())} data-testid="album-save-form">
          <Stack spacing={3}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="albumId" value={album.id} />
            {/* The posted version after a refusal, with the edits made against it (§315). */}
            <RecallHidden name="expectedVersion" value={album.version} />
            <AlbumFieldsForm
              takenOn={album.takenOn.toISOString().slice(0, 10)}
              eventId={album.eventId}
              events={events}
              translations={translations}
              slugLocked={album.publishedAt !== null}
            />
            <Box>
              <GlyphSubmitButton
                label={t("editor.save")}
                pendingLabel={t("editor.saving")}
                icon="save"
                incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
                size="medium"
              />
            </Box>
          </Stack>
        </ActionForm>
      ) : (
        <Alert severity="info">{t("gallery.readOnly")}</Alert>
      )}

      <Divider />

      {mayEdit && (
        <Box>
          <form action={deleteAlbumAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="albumId" value={album.id} />
            <ConfirmSubmitButton
              label={t("gallery.delete")}
              icon="delete"
              title={t("gallery.deleteTitle")}
              body={t("gallery.deleteBody")}
              confirmLabel={t("gallery.delete")}
              cancelLabel={t("confirm.cancel")}
              color="error"
            />
          </form>
        </Box>
      )}

      {album.editorialStatus === "PUBLISHED" && (
        <Typography variant="body2">
          <Link href={{ pathname: "/gallery/[slug]", params: { slug: translations.find((row) => row.locale === locale)?.slug ?? "" } }}>
            {t("gallery.viewPublic")}
          </Link>
        </Typography>
      )}
    </Stack>
  );
}
