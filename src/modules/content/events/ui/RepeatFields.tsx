import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { REPEAT_CADENCES } from "@/modules/events/domain/repeat";
import { calendarDayWords } from "@/i18n/dates";
import { weekdayNames } from "@/modules/events/ui/series-sentence";
import { daysPhrase } from "@/modules/deadlines/domain/duration-words";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField from "@/shared/forms/recall";
import RepeatRuleFields, { RepeatPublishField, type RuleSentenceWords } from "./RepeatRuleFields";

/**
 * How an event repeats (BR-REQ-050-02 criterion 7, §122): cadence, weekdays, an end date or none
 * (kept to the club's series horizon, §377), and whether new dates go live by themselves (§350).
 * Shared by the create page and the Recurență box. `prefix` namespaces the fields; weekdays post
 * ISO `weekday=1..7`, and the event's own day is always ticked and locked (§128). A draft's dates
 * stay drafts until it is published (`materializeSeries`). Recalls after a refused submit (§315).
 */
export default async function RepeatFields({
  prefix = "",
  ownWeekday,
  startTime,
  draftSource,
}: {
  prefix?: string;
  /** The event's own ISO weekday, when the event exists: ticked and locked. */
  ownWeekday?: number;
  /** The event's own start time, `HH:mm`, when it exists; on create it is read from the form. */
  startTime?: string;
  /** Whether the event is a draft now (on create: always, until "Creează și publică"). */
  draftSource: boolean;
}) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const locale = await getLocale();
  const name = (field: string) => `${prefix}${field}`;
  const words: RuleSentenceWords = {
    weekly: tEvent.raw("series.weekly") as string,
    fortnightly: tEvent.raw("series.fortnightly") as string,
    monthly: tEvent.raw("series.monthly") as string,
    atTime: tEvent.raw("series.atTime") as string,
    forever: t.raw("editor.repeatRuleLiveForever") as string,
    until: t.raw("editor.repeatRuleLiveUntil") as string,
    // How far ahead dates are created — the club's number (§377).
    horizon: t("editor.repeatRuleLiveHorizon", { horizon: daysPhrase(locale, (await deadlinesForThisRequest()).seriesHorizonDays) }),
    weekdayNames: weekdayNames(locale),
    untilDay: calendarDayWords(locale),
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
        <RecallField
          select
          name={name("cadence")}
          label={t("editor.repeatCadence")}
          defaultValue="WEEKLY"
          size="small"
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
        >
          {REPEAT_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {t(`editor.repeatCadences.${cadence}`)}
            </option>
          ))}
        </RecallField>
        <DateField name={name("until")} label={t("editor.repeatUntil")} helperText={t("editor.repeatUntilHelp")} size="small" sx={{ width: 220 }} />
      </Stack>
      <RepeatRuleFields
        prefix={prefix}
        ownWeekday={ownWeekday}
        followDateName={ownWeekday === undefined ? "event.startsAtDate" : undefined}
        startTime={startTime}
        labels={{
          weekdays: t.raw("editor.weekdays") as Record<string, string>,
          title: t("editor.repeatWeekdays"),
          help: t("editor.repeatWeekdaysHelp"),
        }}
        words={words}
        locale={locale}
      />
      <RepeatPublishField
        name={name("publish")}
        draftSource={draftSource}
        labels={{ label: t("editor.repeatPublishAuto"), off: t("editor.repeatPublishOffHelp"), draft: t("editor.repeatPublishDraftSource") }}
      />
    </Stack>
  );
}
