import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { EVENT_SURFACES } from "@/modules/events/domain/event-type";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { BLANK, courseSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import { RouteDescriptionFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import { LanguageTabs } from "./TextBoxes";

/**
 * Card 1.2, "Traseul" (§350, §358), inside "Ce fel de eveniment": what they run on, how hard, how
 * long and how steep, whether it is run in the dark (the headlamp, §382), and where the route can be
 * seen — a separate question from the meeting point (§49). All optional, so folded on both pages. "Nespecificat" is a real answer on the two selects:
 * the page omits the row rather than guessing (migration `0018`).
 *
 * Under the settings, in its own Română | English tabs, the route / training description (§NNN):
 * the pit stops, the climbs, what to expect, and a map as a picture in the text — the words' role's,
 * like every other text, both languages or neither (§352), shown under `#route` on the event page.
 *
 * For a role that may only read the settings, the card is its heading and its line (§358) — unless
 * the reader may write a language's texts (the Redactor): then it opens on the description's tabs
 * alone, since those words are theirs. The first box has already said the settings are not.
 */
export default async function CourseBox({ event, mayEditSettings, languages }: BoxProps & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const { words } = await summaryWords();
  const card = {
    level: 3,
    id: "box-course",
    title: t("editor.boxes.course.title"),
    aside: courseSummary(
      words,
      event,
      {
        surface: event?.surface ? tEvent(`surface.${event.surface}`) : null,
        difficulty: event?.difficulty ? t(`editor.difficultyValues.${event.difficulty}`) : null,
      },
      languages.map((entry) => entry.translation),
    ),
  } as const;
  // "Descriere traseu / antrenament" (§NNN), per language: posted as `translations.<locale>.routeDescription`.
  const routeDescription =
    languages.length > 0 ? (
      <LanguageTabs
        idPrefix="course"
        languages={languages}
        watch={{ names: ["routeDescription"], rule: "parity" }}
        blank={BLANK.route}
        identical={["routeDescription"]}
        render={(entry) => <RouteDescriptionFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
    ) : null;
  if (!mayEditSettings) {
    if (!languages.some((entry) => entry.mayEdit)) return <Panel {...card} />;
    return (
      <Panel collapsible {...card}>
        {routeDescription}
      </Panel>
    );
  }
  return (
    <Panel collapsible {...card}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <GlyphSelect
            name="event.surface"
            label={t("editor.surface")}
            defaultValue={event?.surface ?? ""}
            options={[
              { value: "", label: t("editor.notStated") },
              ...EVENT_SURFACES.map((surface) => ({ value: surface, label: tEvent(`surface.${surface}`), glyph: `surface:${surface}` as const })),
            ]}
            sx={{ flex: 1 }}
          />
          <GlyphSelect
            name="event.difficulty"
            label={t("editor.fields.difficulty")}
            defaultValue={event?.difficulty ?? ""}
            options={[
              { value: "", label: t("editor.notStated") },
              ...(["EASY", "MODERATE", "HARD"] as const).map((value) => ({ value, label: t(`editor.difficultyValues.${value}`), glyph: `difficulty:${value}` as const })),
            ]}
            sx={{ flex: 1 }}
          />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <RecallField
            name="event.distanceMeters"
            label={t("editor.distanceMeters")}
            helperText={t("editor.distanceMetersHelp")}
            defaultValue={event?.distanceMeters ?? ""}
            {...textFieldConstraints(eventInputConstraints("distanceMeters"), { inputMode: "numeric" })}
            sx={{ flex: 1 }}
          />
          <RecallField
            name="event.elevationGainMeters"
            label={t("editor.elevationGainMeters")}
            defaultValue={event?.elevationGainMeters ?? ""}
            {...textFieldConstraints(eventInputConstraints("elevationGainMeters"), { inputMode: "numeric" })}
            sx={{ flex: 1 }}
          />
        </Stack>
        {/* "Necesită frontală" (§382): the Wednesday hill run starts in the dark from autumn to
            spring. A checkbox like the promotion box's: unticked posts nothing, "none needed". */}
        <Box>
          <CheckboxField name="event.headlampRequired" defaultChecked={event?.headlampRequired ?? false}>
            {t("editor.headlampRequired")}
          </CheckboxField>
          <BoxNote>{t("editor.headlampRequiredHelp")}</BoxNote>
        </Box>
        <RecallField
          name="event.routeUrl"
          label={t("editor.routeUrl")}
          helperText={t("editor.routeUrlHelp")}
          defaultValue={event?.routeUrl ?? ""}
          {...textFieldConstraints(eventInputConstraints("routeUrl"), { inputMode: "url" })}
        />
        {routeDescription}
      </Stack>
    </Panel>
  );
}
