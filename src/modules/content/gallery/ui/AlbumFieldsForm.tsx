import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { textFieldConstraints } from "@/shared/forms/constraints";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField from "@/shared/forms/recall";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import { albumInputConstraints, albumTranslationConstraints } from "../constraints";

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
 *
 * Every box carries what `fields.ts` requires of it and comes back filled after a refused
 * submit (§315).
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
  events: readonly { id: string; title: string; startsAt: Date; timezone: string }[];
  translations: readonly EditableAlbumTranslation[];
  slugLocked: boolean;
}) {
  const t = await getTranslations("Admin.gallery");
  const uiLocale = await getLocale();
  const box = (field: Parameters<typeof albumTranslationConstraints>[0]) => textFieldConstraints(albumTranslationConstraints(field));

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateField
          name="takenOn"
          label={t("fields.takenOn")}
          helperText={t("takenOnHelp")}
          defaultValue={takenOn}
          required={albumInputConstraints("takenOn").required}
          sx={{ maxWidth: 240 }}
        />
        <RecallField
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
              {formatDay(event.startsAt, { locale: uiLocale, timeZone: event.timezone, style: "short" })} · {event.title}
            </MenuItem>
          ))}
        </RecallField>
      </Stack>

      {/* One tab per language, as every other editor has (§259). */}
      <LocaleTabPanels
        idPrefix="locale"
        panels={routing.locales.map((locale) => {
          const translation = translations.find((row) => row.locale === locale);
          const name = (field: string) => `translations.${locale}.${field}`;
          return {
            locale,
            label: t(`language.${locale}`),
            content: (
              <Stack spacing={2} sx={{ pt: 2 }}>
              <RecallField name={name("title")} label={t("fields.title")} defaultValue={translation?.title ?? ""} {...box("title")} />
              <RecallField
                name={name("slug")}
                label={t("fields.slug")}
                helperText={slugLocked ? t("slugLocked") : t("slugHelp")}
                defaultValue={translation?.slug ?? ""}
                {...box("slug")}
                slotProps={{ input: { readOnly: slugLocked }, htmlInput: albumTranslationConstraints("slug") }}
              />
              <RecallField
                name={name("description")}
                label={t("fields.description")}
                helperText={t("descriptionHelp")}
                defaultValue={translation?.description ?? ""}
                multiline
                minRows={2}
                {...box("description")}
              />
              </Stack>
            ),
          };
        })}
      />
    </Stack>
  );
}
