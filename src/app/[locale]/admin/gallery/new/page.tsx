import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listEventsForAlbumSelect } from "@/modules/content/gallery/repository";
import AlbumFieldsForm from "@/modules/content/gallery/ui/AlbumFieldsForm";
import { albumFormFieldLabels } from "@/modules/content/gallery/ui/field-labels";
import { canCreateEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { createAlbumAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/** A new album: its fields first, then its photos on the page it redirects to (BR-REQ-054-01). */
export default async function NewAlbumPage({ params, searchParams }: Props) {
  const { locale, } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canCreateEvent(actor.role)) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");
  const events = await listEventsForAlbumSelect(getDb(), locale);

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("gallery.create")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("gallery.createHelp")}
      </Typography>

      {/* A plain <form> around a <Stack>: `<Stack component="form">` crashes in MUI 9. A
          refusal comes back with every box still filled (§315). */}
      <ActionForm action={createAlbumAction} messages={await refusalMessages(await albumFormFieldLabels())} data-testid="album-create-form">
        <Stack spacing={3}>
          <input type="hidden" name="uiLocale" value={locale} />
          <AlbumFieldsForm takenOn="" eventId={null} events={events} translations={[]} slugLocked={false} />
          <Box>
            <GlyphSubmitButton
              label={t("gallery.create")}
              pendingLabel={t("editor.saving")}
              icon="add"
              incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
              size="medium"
            />
          </Box>
        </Stack>
      </ActionForm>
    </Stack>
  );
}
