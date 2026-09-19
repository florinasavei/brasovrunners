import { getTranslations } from "next-intl/server";
import { recurrenceOf } from "../domain/series";
import { wallClockWeekday } from "../domain/zoned-time";

/**
 * "În fiecare luni și miercuri, la 18:30" / "Every Monday and Wednesday at 18:30" — how a
 * series recurs, in the reader's words (`DECISIONS.md` §113). The weekday names and the list's
 * "and" come from `Intl`, so the sentence is right in both languages without a table of days;
 * a series with no regular shape is "12 dates, until 14 December".
 */
export async function recurrenceSentence(
  members: readonly { startsAt: Date }[],
  timeZone: string,
  locale: string,
): Promise<string> {
  const t = await getTranslations("Event");
  const recurrence = recurrenceOf(members, timeZone);
  const last = members[members.length - 1];

  if (recurrence.kind === "dates") {
    return t("series.dates", {
      count: members.length,
      last: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(last.startsAt),
    });
  }

  // One name per weekday, from the first occurrence that falls on it.
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone });
  const names = recurrence.weekdays.map((weekday) => {
    const sample = members.find((member) => wallClockWeekday(member.startsAt, timeZone) === weekday) ?? last;
    return weekdayName.format(sample.startsAt);
  });
  const days = new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  const sentence = recurrence.kind === "weekly" ? t("series.weekly", { days }) : t("series.fortnightly", { days });
  return recurrence.time ? t("series.atTime", { sentence, time: recurrence.time }) : sentence;
}
