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
 * The place's part of «Când și unde» (§NNN, which folded §350's box 5 «Locul» into the date's
 * card; the owner, 2026-09-27: "date and location can be on the same card"): whether the place is
 * announced at all (§328), then the meeting point once per language — "Punct de întâlnire", Română
 * and English side by side (§362; the owner, of the shared field and the per-language name that
 * used to be asked one under the other: "There is some redundance on this meeting spot location")
 * — then the map link, one box, because a link has no language, and the coordinates (§416).
 *
 * Each box opens with what that language's page shows today (`placeInBox`): the language's own
 * name, else the event's meeting point, the street address of an older event folded in. So an event
 * saved before §362 opens with the same words on both sides, and one save stores them on both
 * rows — while the two agree, the English box follows what is typed in the Romanian one, so moving
 * the place moves it in both (found by review; `PlaceToBeAnnounced`). The Romanian box is also the
 * event's own meeting point (`events.location_name`).
 *
 * While the place is to be announced, **everything below the switch hides** (the owner,
 * 2026-09-24: "if the location is announced later, we should hide these fields"): hidden, never
 * removed, so a venue typed before the switch went on is still posted, still saved, never
 * published, and back the moment the switch goes off.
 *
 * The whole part is the Organizer's and up — the place is a setting of the event, in both languages
 * (§207: "Organizatorul organizează"); a reader who may not change it reads it as text, and the
 * card says once that the settings are not theirs.
 */
export default async function PlaceFields({ event, mayEditSettings, languages }: Pick<BoxProps, "event" | "mayEditSettings"> & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const { words } = await summaryWords();
  const translations = languages.map((entry) => entry.translation);
  // «Coordonate» (§416): the stored pair as the box shows it, and — for a saved event — which place
  // the weather reads now, by the one rule the page reads it by (`forecastPlace`): the map link's
  // pin, else this pair, else the club's place. Said as it was saved; a change shows after a save.
  const typed = event ? typedCoordinates(event) : null;
  const weatherPlace = event ? forecastPlace({ ...event, locationToBeAnnounced: false }, env.CLUB_COORDINATES) : null;

  if (!mayEditSettings) return <Typography variant="body2">{placeSummary(words, event, translations)}</Typography>;
  return (
    /* The switch and the two names are the island; their constraints are read here, off the
       schema, and handed to it as data — it only takes `required` away while the switch is on. */
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
      {/* Where the weather is read when the link carries no pin (§416, amending §402): a short
          share link or a venue's page names no place a server can read without asking the map. */}
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
