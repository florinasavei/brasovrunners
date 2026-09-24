import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { placeInBox } from "@/modules/events/domain/place";
import { eventInputConstraints } from "../../constraints";
import { placeSummary } from "../box-summaries";
import PlaceToBeAnnounced from "../PlaceToBeAnnounced";
import { type BoxProps, type LanguageEntry, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";

/**
 * Box 5, "Locul" (§350): whether the place is announced at all (§328), then the meeting point once
 * per language — "Punct de întâlnire", Română and English side by side (§NNN; the owner, of the
 * shared field and the per-language name that used to be asked one under the other: "There is
 * some redundance on this meeting spot location") — then the map link, one box, because a link has
 * no language.
 *
 * Each box opens with what that language's page shows today (`placeInBox`): the language's own
 * name, else the event's meeting point, the street address of an older event folded in. So an event
 * saved before §NNN opens with the same words on both sides, and one save stores them on both
 * rows. The Romanian box is also the event's own meeting point (`events.location_name`).
 *
 * While the place is to be announced, **everything below the switch hides** (the owner,
 * 2026-09-24: "if the location is announced later, we should hide these fields"): hidden, never
 * removed, so a venue typed before the switch went on is still posted, still saved, never
 * published, and back the moment the switch goes off.
 *
 * The whole box is the Organizer's and up — the place is a setting of the event, in both languages
 * (§207: "Organizatorul organizează"); a reader who may not change it reads it as text.
 */
export default async function PlaceBox({ event, mayEditSettings, risk, languages }: BoxProps & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const { words } = await summaryWords();
  const translations = languages.map((entry) => entry.translation);
  const own = (locale: "ro" | "en") => translations.find((translation) => translation.locale === locale)?.locationName;
  const inBox = (locale: "ro" | "en") => (event ? placeInBox(event, own(locale)) : "");
  const place = inBox("ro");

  return (
    <Panel
      collapsible
      id="box-place"
      title={t("editor.boxes.place.title")}
      aside={placeSummary(words, event, translations)}
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && place && <RiskLine>{t("editor.risk.place", { count: risk.count, place })}</RiskLine>}
      {mayEditSettings ? (
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
          }}
          names={{
            ro: { defaultValue: inBox("ro"), box: textFieldConstraints(eventInputConstraints("locationName")) },
            en: { defaultValue: inBox("en"), box: textFieldConstraints(eventInputConstraints("locationNameEn")) },
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
        </PlaceToBeAnnounced>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">{placeSummary(words, event, translations)}</Typography>
          <SettingsReadOnly />
        </Stack>
      )}
    </Panel>
  );
}
