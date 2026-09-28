import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import { CLUB_LOCALITY, placeInBox } from "@/modules/events/domain/place";
import { coordinatesText, forecastPlace, typedCoordinates } from "@/modules/weather/domain/place";
import { env } from "@/shared/config/env";
import { eventInputConstraints } from "../../constraints";
import { placeSummary } from "../box-summaries";
import PlaceToBeAnnounced from "../PlaceToBeAnnounced";
import { type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";

/**
 * The place part of «Când și unde» (§481): whether the place is announced (§328), the meeting
 * point per language side by side (§362), the map link (one box, a link has no language) and the
 * coordinates (§416). Each language's box opens with what its page shows (`placeInBox`); while
 * the two agree the English follows the Romanian (`PlaceToBeAnnounced`). The Romanian box is
 * `events.location_name`. While the place is to be announced everything below the switch is
 * hidden, never removed, so it is still saved but never published. A settings reader sees text.
 */
export default async function PlaceFields({ event, mayEditSettings, languages }: Pick<BoxProps, "event" | "mayEditSettings"> & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const { words } = await summaryWords();
  const translations = languages.map((entry) => entry.translation);
  // «Coordonate» (§416): the stored pair, and for a saved event which place the weather reads now
  // (`forecastPlace`: the map pin, else this pair, else the club's), as saved.
  const typed = event ? typedCoordinates(event) : null;
  const weatherPlace = event ? forecastPlace({ ...event, locationToBeAnnounced: false }, env.CLUB_COORDINATES) : null;

  if (!mayEditSettings) return <Typography variant="body2">{placeSummary(words, event, translations)}</Typography>;
  return (
    /* The switch and the two names are the island; constraints come from the schema as data, and
       the island only lifts `required` while the switch is on. */
    <PlaceToBeAnnounced
      defaultChecked={event?.locationToBeAnnounced ?? false}
      labels={{
        toggle: t("editor.placeToBeAnnounced"),
        toggleHelp: t("editor.placeToBeAnnouncedHelp"),
        meetingPoint: t("editor.fields.locationName"),
        ro: tSite("languageName.ro"),
        en: tSite("languageName.en"),
        locationHelp: t("editor.locationHelp"),
        unpublished: t("editor.placeUnpublished"),
        copyToEnglish: t("editor.locationCopyToEnglish"),
        // A template: the island fills `{place}` with what the English box still says.
        englishLeftBehind: t.raw("editor.locationEnglishLeftBehind") as string,
      }}
      names={{
        ro: { defaultValue: placeNameInBox(event, languages, "ro"), box: textFieldConstraints(eventInputConstraints("locationName")) },
        en: { defaultValue: placeNameInBox(event, languages, "en"), box: textFieldConstraints(eventInputConstraints("locationNameEn")) },
      }}
    >
      {/* Where to meet, as one pasted link (§61). */}
      <RecallField
        name="event.mapUrl"
        label={t("editor.mapUrl")}
        helperText={t("editor.mapUrlHelp")}
        defaultValue={event?.mapUrl ?? ""}
        {...textFieldConstraints(eventInputConstraints("mapUrl"), { inputMode: "url" })}
      />
      {/* Where the weather is read when the link carries no readable pin (§416). */}
      <RecallField
        name="event.coordinates"
        label={t("editor.coordinates")}
        helperText={t("editor.coordinatesHelp")}
        defaultValue={typed ? coordinatesText(typed) : ""}
        {...textFieldConstraints(eventInputConstraints("coordinates"), { inputMode: "decimal" })}
      />
      {weatherPlace && (
        <Typography variant="caption" color="text.secondary" component="p" data-testid="weather-place" sx={{ px: 1.75 }}>
          {t(`editor.weatherPlace.${weatherPlace.source}`, {
            coordinates: coordinatesText(weatherPlace.coordinates),
            place: CLUB_LOCALITY,
          })}
        </Typography>
      )}
    </PlaceToBeAnnounced>
  );
}

/** What one language's meeting-point box opens with (§362): that language's page's name, or "" on create. */
export function placeNameInBox(event: BoxProps["event"], languages: readonly LanguageEntry[], locale: "ro" | "en"): string {
  const own = languages.find((entry) => entry.translation.locale === locale)?.translation.locationName;
  return event ? placeInBox(event, own) : "";
}
