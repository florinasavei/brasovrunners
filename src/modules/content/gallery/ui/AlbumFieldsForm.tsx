import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { getFormatter, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";

export type EditableAlbumTranslation = {
  locale: string;
  slug: string;
  title: string;
  description: string | null;
};

/**
 * An album's own fields: when the photos were taken, which event they are from, and a title,
 * address and short description per language. Photos are not here — they come in through the
 * uploader on the album page. One component for the create and the edit form, so the two post
 * exactly the same names (`actions.ts#readFields`).
 */
export default async function AlbumFieldsForm({
  takenOn,
  eventId,
  events,
  translations,
  slugLocked,
}: {
  /** `YYYY-MM-DD`, or "" on the create form. */
  takenOn: string;
  eventId: string | null;
  events: readonly { id: string; title: string; startsAt: Date }[];
  translations: readonly EditableAlbumTranslation[];
  slugLocked: boolean;
}) {
  const t = await getTranslations("Admin.gallery");
  const format = await getFormatter();

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="takenOn"
          type="date"
          label={t("fields.takenOn")}
          helperText={t("takenOnHelp")}
          defaultValue={takenOn}
          slotProps={{ inputLabel: { shrink: true } }}
          required
          sx={{ maxWidth: 240 }}
        />
        <TextField
          select
          name="eventId"
          label={t("fields.event")}
          helperText={t("eventHelp")}
          defaultValue={eventId ?? ""}
          sx={{ flex: 1, minWidth: 240 }}
        >
          <MenuItem value="">{t("noEvent")}</MenuItem>
          {events.map((event) => (
            <MenuItem key={event.id} value={event.id}>
              {format.dateTime(event.startsAt, { dateStyle: "medium" })} · {event.title}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {/* One tab per language, as every other editor has (§259). */}
      <LocaleTabPanels
        panels={routing.locales.map((locale) => {
          const translation = translations.find((row) => row.locale === locale);
          const name = (field: string) => `translations.${locale}.${field}`;
          return {
            locale,
            label: t(`language.${locale}`),
            content: (
              <Stack spacing={2} sx={{ pt: 2 }}>
              <TextField name={name("title")} label={t("fields.title")} defaultValue={translation?.title ?? ""} required />
              <TextField
                name={name("slug")}
                label={t("fields.slug")}
                helperText={slugLocked ? t("slugLocked") : t("slugHelp")}
                defaultValue={translation?.slug ?? ""}
                required
                slotProps={{ input: { readOnly: slugLocked } }}
              />
              <TextField
                name={name("description")}
                label={t("fields.description")}
                defaultValue={translation?.description ?? ""}
                multiline
                minRows={2}
              />
              </Stack>
            ),
          };
        })}
      />
    </Stack>
  );
}
