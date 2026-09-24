import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import RecallField from "@/shared/forms/recall";
import { textFieldConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { BLANK, placeSummary } from "../box-summaries";
import PlaceToBeAnnounced from "../PlaceToBeAnnounced";
import { PlaceNameField } from "../TranslationFields";
import { type BoxProps, type LanguageEntry, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { LanguageTabs } from "./TextBoxes";

/**
 * Box 5, "Locul" (§350): the shared half first — whether the place is announced at all (§328),
 * the meeting point, the map link — then each language's own name for the place in Română |
 * English tabs (migration `0058`, moved here from the title's tab: two boxes for one place belong
 * in one box).
 *
 * While the place is to be announced, **everything below the switch hides**, the languages' names
 * too (the owner, 2026-09-24: "if the location is announced later, we should hide these fields"):
 * hidden, never removed, so a venue typed before the switch went on is still posted, still saved,
 * never published, and back the moment the switch goes off.
 *
 * The shared half is the Organizer's and up; the tabs are the text roles'. The half a reader may
 * not change shows as text.
 */
export default async function PlaceBox({ event, mayEditSettings, risk, languages }: BoxProps & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const place = [event?.locationName, event?.locationAddress].filter(Boolean).join(", ");

  const tabs = (
    <LanguageTabs
      idPrefix="place"
      languages={languages}
      watch={{ names: ["locationName"], rule: "parity" }}
      blank={BLANK.place}
      render={(entry) => <PlaceNameField translation={entry.translation} mayEdit={entry.mayEdit} />}
    />
  );

  return (
    <Panel
      collapsible
      id="box-place"
      title={t("editor.boxes.place.title")}
      aside={placeSummary(words, event, languages.map((entry) => entry.translation))}
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && place && <RiskLine>{t("editor.risk.place", { count: risk.count, place })}</RiskLine>}
      {mayEditSettings ? (
        /* The switch is the island; the meeting point's constraints are read here, off the schema,
           and handed to it as data — it only takes `required` away while the switch is on. */
        <PlaceToBeAnnounced
          defaultChecked={event?.locationToBeAnnounced ?? false}
          labels={{
            toggle: t("editor.placeToBeAnnounced"),
            toggleHelp: t("editor.placeToBeAnnouncedHelp"),
            locationName: t("editor.fields.locationName"),
            locationHelp: t("editor.locationHelp"),
            unpublished: t("editor.placeUnpublished"),
          }}
          locationName={{
            defaultValue: place,
            box: textFieldConstraints(eventInputConstraints("locationName")),
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
          {tabs}
        </PlaceToBeAnnounced>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">{placeSummary(words, event, [])}</Typography>
          <SettingsReadOnly />
          {tabs}
        </Stack>
      )}
    </Panel>
  );
}
