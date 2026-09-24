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
 * How an event repeats (BR-REQ-050-02 criterion 7, §122): the cadence, the days of the week,
 * until when — a date, or nothing for a series without an end, which the maintenance job keeps
 * to the club's series horizon (§NNN) — and whether the dates it makes go live by themselves (§350). The same
 * fields on the create page and on an event's Recurență box, so the two cannot drift.
 *
 * `prefix` namespaces the fields (`repeat.cadence` on the creation form, bare on the event page,
 * which posts its own form). The weekday boxes post `weekday=1..7`, ISO numbered; none ticked
 * means the event's own day. The event's own day is always in the series (§128): ticked and
 * locked — on the event page from the stored date, on the create page following the start date
 * as it is typed (`RepeatRuleFields`). Under them, the rule in one live sentence.
 *
 * "Publică datele noi automat" is always shown now, ticked by default (§350) — it was offered only
 * on a live event, so a series started from a draft could never say it wanted its dates to go
 * live; its help says what off means, and that the dates of a draft stay drafts until it is
 * published (`materializeSeries`: rule.publish **and** a published source).
 *
 * After a refused submit every one of them comes back as it was chosen (§315).
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
    // How far ahead the dates are created at once — the club's number (§NNN), in words.
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
