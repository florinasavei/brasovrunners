import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES, hasProgramme } from "@/modules/events/domain/event-type";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import Panel from "@/shared/ui/Panel";
import { BLANK, programmeSummary } from "../box-summaries";
import OnlyForType from "../OnlyForType";
import ScheduleRowsEditor from "../ScheduleRowsEditor";
import { ProgrammeTextFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, RiskLine, SettingsReadOnly, summaryWords } from "./box-kit";
import { DEFAULT_TIMEZONE } from "./WhenBox";
import { LanguageTabs } from "./TextBoxes";

/**
 * Box 6, "Programul zilei și ce să aduci" (§NNN): the timed rows first (§117) — one list for both
 * languages, one calendar entry each, repeated in the reminder, with "Ce (română)" and "Ce
 * (engleză)" side by side in the row, never in tabs — then, in Română | English tabs, the notes
 * under them and what to bring. The rows and their notes used to live in two panels far apart
 * and needed a hint each saying where the other was (the owner: "programul evenimentului e
 * duplicat!"); in one box they need none.
 *
 * A group run has no programme (§111): the sentence replaces the rows and the notes, hidden and
 * never removed, and only "Ce să aduci" remains — every type has something to bring.
 */
export default async function ProgrammeBox({ event, mayEditSettings, risk, languages }: BoxProps & { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const locale = languages[0]?.translation.locale ?? "ro";
  const initialType = event?.type ?? "GROUP_RUN";
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  // The programme's rows as wall-clock boxes in the event's zone (§117).
  const scheduleRows = readScheduleItems(event?.scheduleItems ?? null).map((item) => {
    const start = toWallTimeInput(new Date(item.startsAt), zone);
    const end = item.endsAt ? toWallTimeInput(new Date(item.endsAt), zone) : "";
    return { date: start.slice(0, 10), time: start.slice(11, 16), endTime: end.slice(11, 16), ro: item.label.ro, en: item.label.en, place: item.place ?? "" };
  });
  const programmeTypes = EVENT_TYPES.filter(hasProgramme);
  const turnUpTypes = EVENT_TYPES.filter((type) => !hasProgramme(type));

  return (
    <Panel
      collapsible
      id="box-programme"
      title={t("editor.boxes.programme.title")}
      aside={programmeSummary(words, event, hasProgramme(initialType), languages.map((entry) => entry.translation), locale)}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && <RiskLine>{t("editor.risk.programme")}</RiskLine>}
      <Stack spacing={2}>
        <OnlyForType type={turnUpTypes} selectName="event.type" initialType={initialType}>
          <BoxNote testId="group-run-no-programme">{t("editor.groupRunNoProgramme")}</BoxNote>
        </OnlyForType>
        <OnlyForType type={programmeTypes} selectName="event.type" initialType={initialType}>
          {mayEditSettings ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {t("editor.programmeHelp")}
              </Typography>
              {/* The rows follow the start date: `WallTimeField` posts `event.startsAtDate`, and the
                  rows island listens to the date box by that name. */}
              <ScheduleRowsEditor
                initial={scheduleRows}
                startDateName="event.startsAtDate"
                labels={{
                  date: t("editor.programmeRows.date"),
                  time: t("editor.programmeRows.time"),
                  endTime: t("editor.programmeRows.endTime"),
                  ro: t("editor.programmeRows.ro"),
                  en: t("editor.programmeRows.en"),
                  place: t("editor.programmeRows.place"),
                  add: t("editor.programmeRows.add"),
                  remove: t("editor.programmeRows.remove"),
                  empty: t("editor.programmeRows.empty"),
                }}
              />
            </Stack>
          ) : (
            <SettingsReadOnly />
          )}
        </OnlyForType>
        <LanguageTabs
          idPrefix="programme"
          languages={languages}
          watch={{ names: ["schedule", "checklist"], rule: "parity" }}
          blank={BLANK.programme}
          render={(entry) => <ProgrammeTextFields translation={entry.translation} mayEdit={entry.mayEdit} eventType={initialType} />}
        />
      </Stack>
    </Panel>
  );
}
