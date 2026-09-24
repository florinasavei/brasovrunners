import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { EVENT_SURFACES } from "@/modules/events/domain/event-type";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { courseSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import { type BoxProps, summaryWords } from "./box-kit";

/**
 * Card 1.2, "Traseul" (§350, §NNN), inside "Ce fel de eveniment": what they run on, how hard, how
 * long and how steep, and where the route can be seen — a separate question from the meeting point
 * (§49). All optional, so folded on both pages. "Nespecificat" is a real answer on the two selects:
 * the page omits the row rather than guessing (migration `0018`).
 *
 * For a role that may only read the settings, the card is its heading and its line and nothing to
 * open: the first box says once that the settings are not theirs (§NNN).
 */
export default async function CourseBox({ event, mayEditSettings }: BoxProps) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const { words } = await summaryWords();
  const card = {
    level: 3,
    id: "box-course",
    title: t("editor.boxes.course.title"),
    aside: courseSummary(words, event, {
      surface: event?.surface ? tEvent(`surface.${event.surface}`) : null,
      difficulty: event?.difficulty ? t(`editor.difficultyValues.${event.difficulty}`) : null,
    }),
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;
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
        <RecallField
          name="event.routeUrl"
          label={t("editor.routeUrl")}
          helperText={t("editor.routeUrlHelp")}
          defaultValue={event?.routeUrl ?? ""}
          {...textFieldConstraints(eventInputConstraints("routeUrl"), { inputMode: "url" })}
        />
      </Stack>
    </Panel>
  );
}
