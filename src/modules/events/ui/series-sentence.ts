import { getTranslations } from "next-intl/server";
import type { RepeatRule } from "../domain/repeat";
import { type EditionDifference, recurrenceOf } from "../domain/series";
import type { EditionNote } from "./EditionMark";
import { toWallTimeInput, wallClockWeekday } from "../domain/zoned-time";

/**
 * "În fiecare luni și miercuri, la 18:30" / "Every Monday and Wednesday at 18:30" — how a
 * series recurs, in the reader's words (`DECISIONS.md` §113). The weekday names and the list's
 * "and" come from `Intl`, so the sentence is right in both languages without a table of days;
 * a series with no regular shape is "12 dates, until 14 December".
 */
/** The rule as a sentence: "În fiecare luni și miercuri, la 18:30" / "Lunar, pe 11" (§122). */
export async function ruleSentence(rule: RepeatRule, source: { startsAt: Date }, timeZone: string, locale: string): Promise<string> {
  const t = await getTranslations("Event");
  const wall = toWallTimeInput(source.startsAt, timeZone);
  if (rule.cadence === "MONTHLY") return t("series.monthly", { day: Number(wall.slice(8, 10)) });
  const weekdays = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [wallClockWeekday(source.startsAt, timeZone)];
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // Any week's Monday plus the offset names the day; 2024-01-01 is a Monday.
  const names = weekdays.map((weekday) => weekdayName.format(new Date(Date.UTC(2024, 0, weekday, 12))));
  const days = new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  const sentence = rule.cadence === "WEEKLY" ? t("series.weekly", { days }) : t("series.fortnightly", { days });
  return t("series.atTime", { sentence, time: wall.slice(11, 16) });
}

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

/** The words on a date's mark (§122), from the catalogue, or null for a date like the others. */
export async function editionNote(difference: EditionDifference): Promise<EditionNote | null> {
  if (!difference) return null;
  const t = await getTranslations("Event");
  if (difference.kind === "cancelled") return { kind: "cancelled", text: t("series.cancelledMark") };
  // A special edition among the ordinary dates (§169): the one mark the organizer stated.
  if (difference.kind === "special") return { kind: "special", text: t("series.specialMark") };
  if (difference.kind === "moved") return { kind: "moved", text: t("series.movedMark", { place: difference.place }) };
  return { kind: "retimed", text: t("series.retimedMark", { time: difference.time }) };
}
