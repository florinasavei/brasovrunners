import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { calendarDayWords } from "@/i18n/dates";
import { EVENT_SURFACES } from "@/modules/events/domain/event-type";
import { nightChoiceOf } from "@/modules/events/domain/night";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { clubNightEvent } from "@/modules/events/night-event";
import { env } from "@/shared/config/env";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { BLANK, courseSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import GroupRunDeclarationField from "../GroupRunDeclarationField";
import NightEventField from "../NightEventField";
import { DEFAULT_TIMEZONE } from "./WhenBox";
import { RouteDescriptionFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import { LanguageTabs } from "./TextBoxes";

/**
 * Card 1.2, "Traseul" (§350, §358), inside "Ce fel de eveniment": what they run on, how hard, how
 * long and how steep, whether it is a night event (automatic from the sunset, §NNN), and where the route can be
 * seen — a separate question from the meeting point (§49). All optional, so folded on both pages. "Nespecificat" is a real answer on the two selects:
 * the page omits the row rather than guessing (migration `0018`).
 *
 * Under the settings, in its own Română | English tabs, the route / training description (§387):
 * the pit stops, the climbs, what to expect, and a map as a picture in the text — the words' role's,
 * like every other text, both languages or neither (§352), shown under `#route` on the event page.
 *
 * For a role that may only read the settings, the card is its heading and its line (§358) — unless
 * the reader may write a language's texts (the Redactor): then it opens on the description's tabs
 * alone, since those words are theirs. The first box has already said the settings are not.
 */
export default async function CourseBox({
  event,
  mayEditSettings,
  groupRunDeclarations,
  languages,
  inSeries = false,
}: BoxProps & { languages: readonly LanguageEntry[]; inSeries?: boolean }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const locale = await getLocale();
  const { words } = await summaryWords();
  // The event's own start on its own clock, for the night line's first paint (§NNN).
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const wall = toWallTimeInput(event?.startsAt ?? null, zone);
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
        // The automatic answer for the event's own date (§NNN), read by the same function as the pill.
        night: event ? clubNightEvent({ ...event, nightOverride: null }).night : false,
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
        {/* "Eveniment de noapte" (§NNN, replacing §382's "Necesită frontală"): Automat by default —
            the Wednesday hill run is a night event from autumn to spring by its own sunset — with
            "Da" and "Nu" for the organizer who knows better, and the automatic answer under it. */}
        <Box>
          <NightEventField
            name="event.nightOverride"
            defaultChoice={nightChoiceOf(event?.nightOverride)}
            place={env.CLUB_COORDINATES}
            zone={zone}
            start={{ date: wall.slice(0, 10), time: wall.slice(11, 16) }}
            inSeries={inSeries}
            // The repeat toggle is a field in the same form only on the create page — "repeat.on"
            // inside the one `ActionForm` this card also lives in. On the edit page, "Repetă" is a
            // separate `ActionForm` (the aside's own submit, `scope="repeat"`), so a name here could
            // never be read from this form's data; the series sentence there depends on `inSeries`
            // alone, computed server-side from the event's own row (§NNN).
            seriesToggleName={event ? undefined : "repeat.on"}
            words={{
              label: t("editor.night.label"),
              choices: { auto: t("editor.night.auto"), yes: t("editor.night.yes"), no: t("editor.night.no") },
              autoLine: t.raw("editor.night.autoLine") as string,
              autoLineNoTime: t.raw("editor.night.autoLineNoTime") as string,
              autoLineNoDate: t("editor.night.autoLineNoDate"),
              verdictNight: t("editor.night.verdictNight"),
              verdictDay: t("editor.night.verdictDay"),
              series: t("editor.night.series"),
              day: calendarDayWords(locale),
            }}
          />
          <BoxNote>{t("editor.night.help")}</BoxNote>
        </Box>
        {/* "Declarație opțională pe propria răspundere" (§NNN): a group run on asphalt or trail may
            offer its surface's self-declaration — on by default for trail, the mountain rescue asks
            for it on the Tâmpa run. An island: it follows the type and surface selects above. */}
        <GroupRunDeclarationField
          initialType={event?.type ?? "GROUP_RUN"}
          initialSurface={event?.surface ?? ""}
          initialChecked={event?.offersGroupRunDeclaration ?? false}
          approved={groupRunDeclarations ?? { ASPHALT: false, TRAIL: false }}
          words={{
            label: t("editor.groupRunDeclaration.label"),
            help: t("editor.groupRunDeclaration.help"),
            notGroupSurface: t("editor.groupRunDeclaration.notGroupSurface"),
            missing: {
              ASPHALT: t("editor.groupRunDeclaration.missing", { document: t("legal.keys.GROUP_RUN_DECLARATION_ASPHALT") }),
              TRAIL: t("editor.groupRunDeclaration.missing", { document: t("legal.keys.GROUP_RUN_DECLARATION_TRAIL") }),
            },
          }}
        />
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
