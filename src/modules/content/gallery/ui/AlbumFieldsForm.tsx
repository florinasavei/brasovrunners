import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { formatDay } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { textFieldConstraints } from "@/shared/forms/constraints";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField from "@/shared/forms/recall";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
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
  // One word for the namespace (the catalogue check reads it, `docs/VIBECODING.md`): the album's words are `gallery.*`.
  const t = await getTranslations("Admin");
  const uiLocale = await getLocale();
  const box = (field: Parameters<typeof albumTranslationConstraints>[0]) => textFieldConstraints(albumTranslationConstraints(field));

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateField
          name="takenOn"
          label={t("gallery.fields.takenOn")}
          helperText={t("gallery.takenOnHelp")}
          defaultValue={takenOn}
          required={albumInputConstraints("takenOn").required}
          sx={{ maxWidth: 240 }}
        />
        <RecallField
          select
          name="eventId"
          label={t("gallery.fields.event")}
          helperText={t("gallery.eventHelp")}
          defaultValue={eventId ?? ""}
          sx={{ flex: 1, minWidth: 240 }}
        >
          <MenuItem value="">{t("gallery.noEvent")}</MenuItem>
          {events.map((event) => (
            <MenuItem key={event.id} value={event.id}>
              {/* A date left blank (§NNN) is said, never printed as the provisional day stored for it. */}
              {typedStartOrNull(event) ? formatDay(event.startsAt, { locale: uiLocale, timeZone: event.timezone, style: "short" }) : t("editor.dateToBeAnnounced")} · {event.title}
            </MenuItem>
          ))}
        </RecallField>
      </Stack>

      {/* «Copiază și tradu tot: RO → EN» (§464, §482): the album's English title and description from the Romanian. */}
      <TranslateAllButton />

      {/* One tab per language, as every other editor has (§259). */}
      <LocaleTabPanels
        idPrefix="locale"
        // «Tradu cardul: RO → EN» in the tab row too (§514), where the person is looking.
        translateCard
        panels={routing.locales.map((locale) => {
          const translation = translations.find((row) => row.locale === locale);
          const name = (field: string) => `translations.${locale}.${field}`;
          const fromRomanian = (field: string) => (locale === "en" ? <TranslateFieldButton en={name(field)} /> : null);
          return {
            locale,
            label: t(`gallery.language.${locale}`),
            content: (
              <Stack spacing={2} sx={{ pt: 2 }}>
              <RecallField name={name("title")} label={t("gallery.fields.title")} defaultValue={translation?.title ?? ""} {...box("title")} />
              {fromRomanian("title")}
              <RecallField
                name={name("slug")}
                label={t("gallery.fields.slug")}
                helperText={slugLocked ? t("gallery.slugLocked") : t("gallery.slugHelp")}
                defaultValue={translation?.slug ?? ""}
                {...box("slug")}
                slotProps={{ input: { readOnly: slugLocked }, htmlInput: albumTranslationConstraints("slug") }}
              />
              <RecallField
                name={name("description")}
                label={t("gallery.fields.description")}
                helperText={t("gallery.descriptionHelp")}
                defaultValue={translation?.description ?? ""}
                multiline
                minRows={2}
                {...box("description")}
              />
              {fromRomanian("description")}
              </Stack>
            ),
          };
        })}
      />
    </Stack>
  );
}
