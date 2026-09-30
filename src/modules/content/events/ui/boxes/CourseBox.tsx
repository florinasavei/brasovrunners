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
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { savedDurationMinutes } from "../../duration";
import ApproximateIcon from "../ApproximateIcon";
import { BLANK, courseSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import NightEventField from "../NightEventField";
import { DEFAULT_TIMEZONE } from "./WhenBox";
import { RouteDescriptionFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import { LanguageTabs } from "./TextBoxes";

/**
 * "Traseul" (§350, §358, §406): its own card, where the page first draws what it holds — the
 * route's pills in the facts and, further down, the route section under `#route` (§387). The
 * group run's declaration offer (§393) was here; since §448 it is under «Regulamentul», with the
 * race's declaration — one place for what a runner signs. It was card 1.2 inside "Ce fel de eveniment" (§358) and
 * moved whole. What they run on, how hard, how
 * long and how steep, whether it is a night event (automatic from the sunset, §394), and where the route can be
 * seen — a separate question from the meeting point (§49). How hard is asked in «Ce fel de eveniment» since §526,
 * with the band and its step side by side. All optional, so folded on both pages. "Nespecificat" is a real answer on the surface select:
 * the page omits the row rather than guessing (migration `0018`).
 *
 * Under the settings, in its own Română | English tabs, the route / training description (§387):
 * the pit stops, the climbs, what to expect, and a map as a picture in the text — the words' role's,
 * like every other text, both languages or neither (§352), shown under `#route` on the event page.
 *
 * For a role that may only read the settings, the card is its heading and its line (§358) — unless
 * the reader may write a language's texts (the Redactor): then it opens on the description's tabs
 * alone, since those words are theirs. The type's box has already said the settings are not.
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
  // The boxes as «Când și unde» shows them: "" for a part left blank (§545), never the provisional start.
  const start = startBoxValues(event?.startsAt ?? null, zone);
  // The span's end for the first paint, by the server's rule (§394): «Durata» (the saved end), else
  // the programme's rows on the event's clock — the island reads both from the form after.
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
        // The automatic answer for the event's own date (§394), read by the same function as the pill.
        // Nothing for a date or an hour left blank (§545): there is no sunset to compare them with.
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
          <Box sx={{ flex: 1 }}>
            <RecallField
              name="event.distanceMeters"
              label={t("editor.distanceMeters")}
              helperText={t("editor.distanceMetersHelp")}
              defaultValue={event?.distanceMeters ?? ""}
              {...textFieldConstraints(eventInputConstraints("distanceMeters"), { inputMode: "numeric" })}
              fullWidth
            />
            {/* «Aproximativ» (§598, the twin of the climb's «Estimativ»): the length is known only
                roughly, and every surface then says «≈» and «aproximativ» (`distanceWords`).
                Ignored, saved false, with no distance. */}
            <CheckboxField
              name="event.distanceEstimated"
              defaultChecked={event?.distanceEstimated ?? false}
              help={t("editor.distanceEstimatedHelp")}
              helpTestId="distance-estimated-help"
            >
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <ApproximateIcon fontSize="small" aria-hidden="true" />
                {t("editor.distanceEstimated")}
              </Box>
            </CheckboxField>
          </Box>
          <Box sx={{ flex: 1 }}>
            <RecallField
              name="event.elevationGainMeters"
              label={t("editor.elevationGainMeters")}
              defaultValue={event?.elevationGainMeters ?? ""}
              {...textFieldConstraints(eventInputConstraints("elevationGainMeters"), { inputMode: "numeric" })}
              fullWidth
            />
            {/* «Estimativ» (§585): the climb is a guess — a GPS track, the map — and every surface
                then says «≈» and «estimativ» (`elevationWords`). Ignored, saved false, with no number. */}
            <CheckboxField
              name="event.elevationGainEstimated"
              defaultChecked={event?.elevationGainEstimated ?? false}
              help={t("editor.elevationGainEstimatedHelp")}
              helpTestId="elevation-gain-estimated-help"
            >
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <ApproximateIcon fontSize="small" aria-hidden="true" />
                {t("editor.elevationGainEstimated")}
              </Box>
            </CheckboxField>
          </Box>
        </Stack>
        {/* "Eveniment de noapte" (§394, replacing §382's "Necesită frontală"): Automat by default —
            the Wednesday hill run is a night event from autumn to spring by its own sunset — with
            "Da" and "Nu" for the organizer who knows better, and the automatic answer under it. */}
        <Box>
          <NightEventField
            name="event.nightOverride"
            defaultChoice={nightChoiceOf(event?.nightOverride)}
            // The saved event's own place (§428, §416's rule), the club's on the create page. A map
            // link or a pair typed in «Locul» in this sitting is read at the next save.
            place={event ? nightPlace(event) : env.CLUB_COORDINATES}
            zone={zone}
            start={start}
            durationMinutes={savedMinutes && savedMinutes > 0 ? savedMinutes : null}
            programme={savedProgramme}
            inSeries={inSeries}
            // The repeat toggle is a field in the same form only on the create page — "repeat.on"
            // inside the one `ActionForm` this card also lives in. On the edit page, "Repetă" is a
            // separate `ActionForm` (the aside's own submit, `scope="repeat"`), so a name here could
            // never be read from this form's data; the series sentence there depends on `inSeries`
            // alone, computed server-side from the event's own row (§394).
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
        {/* The group run's optional self-declaration (§393) is under «Regulamentul» since §448
            (`DeclarationCard`): it still follows the surface chosen here. */}
        {/* A group run's minimum age had its own box here (§440); since §505 it is the one
            `event.minAge` of «Regulamentul», for every type (`RulesBox`). */}
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
