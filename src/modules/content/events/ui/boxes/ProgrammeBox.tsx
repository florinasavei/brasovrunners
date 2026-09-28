import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES, hasProgramme } from "@/modules/events/domain/event-type";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { startBoxValues } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import Panel from "@/shared/ui/Panel";
import { BLANK, programmeSummary } from "../box-summaries";
import OnlyForType from "../OnlyForType";
import ScheduleRowsEditor from "../ScheduleRowsEditor";
import { ProgrammeTextFields } from "../TranslationFields";
import { BoxNote, type BoxProps, type LanguageEntry, SettingsReadOnly, summaryWords } from "./box-kit";
import { DEFAULT_TIMEZONE } from "./WhenBox";
import { LanguageTabs } from "./TextBoxes";

/**
 * "Programul zilei și ce să aduci" (§350, §481; `#box-schedule`): the timed rows (§117) — one list
 * for both languages, the two "Ce" boxes side by side — then per-language tabs for the notes and
 * what to bring. A group run has no programme (§111): a sentence replaces rows and notes (hidden,
 * never removed) and only "Ce să aduci" remains.
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
  // The day a new row opens on (§405): the start date as its box shows it; "" on create and for a
  // blank date (§545), so no row opens on the stored provisional day.
  const startDate = startBoxValues(event?.startsAt ?? null, zone).date;
  const programmeTypes = EVENT_TYPES.filter(hasProgramme);
  const turnUpTypes = EVENT_TYPES.filter((type) => !hasProgramme(type));

  return (
    <Panel glyph="programme"
      collapsible
      level={3}
      id="box-schedule"
      title={t("editor.boxes.programme.title")}
      aside={programmeSummary(words, event, hasProgramme(initialType), languages.map((entry) => entry.translation), locale)}
      tone={risk ? "risk" : "default"}
    >
      <Stack spacing={2}>
        <OnlyForType type={turnUpTypes} selectName="event.type" initialType={initialType}>
          <BoxNote testId="group-run-no-programme">{t("editor.groupRunNoProgramme")}</BoxNote>
        </OnlyForType>
        <OnlyForType type={programmeTypes} selectName="event.type" initialType={initialType}>
          {mayEditSettings ? (
            <Stack spacing={1}>
              {/* How the rows work, as the compact «i» fold (§398, §405), closed by default (§336). */}
              <Panel collapsible variant="help" legendIcon="info" title={t("editor.programmeHelpSummary")} data-testid="programme-help">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {t("editor.programmeHelp")}
                  </Typography>
                  {risk && (
                    <Typography variant="body2" color="text.secondary" data-testid="programme-risk">
                      {t("editor.risk.programme")}
                    </Typography>
                  )}
                </Stack>
              </Panel>
              {/* The rows island listens to the `event.startsAtDate` box; a new row opens on it (§405). */}
              <ScheduleRowsEditor
                initial={scheduleRows}
                startDateName="event.startsAtDate"
                startDate={startDate}
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
                  row: t("editor.programmeRows.row"),
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
          identical={["schedule", "checklist"]}
          render={(entry) => <ProgrammeTextFields translation={entry.translation} mayEdit={entry.mayEdit} eventType={initialType} />}
        />
      </Stack>
    </Panel>
  );
}
