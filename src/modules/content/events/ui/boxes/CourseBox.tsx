import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { calendarDayWords } from "@/i18n/dates";
import { EVENT_SURFACES } from "@/modules/events/domain/event-type";
import { nightChoiceOf } from "@/modules/events/domain/night";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { startBoxValues } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { clubNightEvent, nightPlace } from "@/modules/events/night-event";
import { env } from "@/shared/config/env";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { savedDurationMinutes } from "../../duration";
import { BLANK, courseSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import NightEventField from "../NightEventField";
import { DEFAULT_TIMEZONE } from "./WhenBox";
import { RouteDescriptionFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import { LanguageTabs } from "./TextBoxes";

/**
 * "Traseul" (§350, §406): the route pills' settings — surface, length, climb, whether a night
 * event (automatic from the sunset, §394) and where the route can be seen (separate from the
 * meeting point, §49) — then per-language tabs for the route description under `#route` (§387,
 * both languages or neither §352). "Nespecificat" makes the page omit the row. Difficulty is in
 * «Ce fel de eveniment» (§526), the declaration under «Regulamentul» (§448). A settings reader
 * sees heading and line, or only the description's tabs if the words are theirs (§358).
 */
export default async function CourseBox({
  event,
  mayEditSettings,
  languages,
  heading,
  inSeries = false,
}: BoxProps & { languages: readonly LanguageEntry[]; inSeries?: boolean }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const locale = await getLocale();
  const { words } = await summaryWords();
  // The event's own start on its own clock, for the night line's first paint (§394).
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  // "" for a part left blank (§545), never the provisional start.
  const start = startBoxValues(event?.startsAt ?? null, zone);
  // The span's end for the first paint (§394): «Durata», else the programme's rows; the island
  // re-reads both from the form.
  const savedMinutes = savedDurationMinutes(event?.startsAt, event?.endsAt);
  const savedProgramme = readScheduleItems(event?.scheduleItems).map((row) => {
    const from = toWallTimeInput(new Date(row.startsAt), zone);
    return { date: from.slice(0, 10), time: from.slice(11, 16), endTime: row.endsAt ? toWallTimeInput(new Date(row.endsAt), zone).slice(11, 16) : "" };
  });
  const card = {
    id: "box-course",
    glyph: "course",
    title: heading ?? t("editor.boxes.course.title"),
    aside: courseSummary(
      words,
      event,
      {
        surface: event?.surface ? tEvent(`surface.${event.surface}`) : null,
        // The automatic answer for the event's date (§394), by the pill's function; none without a
        // date and hour (§545).
        night: event && start.date && start.time ? clubNightEvent({ ...event, nightOverride: null }).night : false,
      },
      languages.map((entry) => entry.translation),
    ),
  } as const;
  // "Descriere traseu / antrenament" (§387), per language: posted as `translations.<locale>.routeDescription`.
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
        <GlyphSelect
          name="event.surface"
          label={t("editor.surface")}
          defaultValue={event?.surface ?? ""}
          options={[
            { value: "", label: t("editor.notStated") },
            ...EVENT_SURFACES.map((surface) => ({ value: surface, label: tEvent(`surface.${surface}`), glyph: `surface:${surface}` as const })),
          ]}
        />
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
        {/* "Eveniment de noapte" (§394): Automat by default, "Da"/"Nu" to override, the automatic
            answer under it. */}
        <Box>
          <NightEventField
            name="event.nightOverride"
            defaultChoice={nightChoiceOf(event?.nightOverride)}
            // The saved event's place (§416, §428), the club's on create; an unsaved change is read
            // at the next save.
            place={event ? nightPlace(event) : env.CLUB_COORDINATES}
            zone={zone}
            start={start}
            durationMinutes={savedMinutes && savedMinutes > 0 ? savedMinutes : null}
            programme={savedProgramme}
            inSeries={inSeries}
            // Only on the create page is the repeat tick in this form; on the editor «Repetă» is a
            // separate form, so the series sentence there uses the server-side `inSeries` (§394).
            seriesToggleName={event ? undefined : "repeat.on"}
            words={{
              label: t("editor.night.label"),
              choices: { auto: t("editor.night.auto"), yes: t("editor.night.yes"), no: t("editor.night.no") },
              autoLine: t.raw("editor.night.autoLine") as string,
              autoLineDawn: t.raw("editor.night.autoLineDawn") as string,
              autoLineNoTime: t.raw("editor.night.autoLineNoTime") as string,
              autoLineNoDate: t("editor.night.autoLineNoDate"),
              verdictNight: t("editor.night.verdictNight"),
              verdictDay: t("editor.night.verdictDay"),
              endLine: t.raw("editor.night.endLine") as string,
              endLineProgramme: t.raw("editor.night.endLineProgramme") as string,
              series: t("editor.night.series"),
              day: calendarDayWords(locale),
            }}
          />
          <BoxNote>{t("editor.night.help")}</BoxNote>
        </Box>
        {/* The group run's self-declaration is under «Regulamentul» (§448) and the minimum age is
            `RulesBox`'s `event.minAge` for every type (§505). */}
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
