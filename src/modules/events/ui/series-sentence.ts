import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { formatDay } from "@/i18n/dates";
import { readRepeatRule, type RepeatRule } from "../domain/repeat";
import { type EditionDifference, recurrenceOf } from "../domain/series";
import type { EditionNote } from "./EditionMark";
import { toWallTimeInput, wallClockWeekday } from "../domain/zoned-time";

/**
 * "În fiecare luni și miercuri, la 18:30" / "Every Monday and Wednesday at 18:30" — how a
 * series recurs, in the reader's words (`DECISIONS.md` §113). The weekday names and the list's
 * "and" come from `Intl`, so the sentence is right in both languages without a table of days;
 * a series with no regular shape is "12 dates, until 14 December".
 */
/**
 * Whether a set of dates is a standing series, and until when (§305).
 *
 * The backoffice list showed "21 sept. – 16 nov. 2026" for the weekly run — the span of the dates
 * the job had materialised so far (§122, eight weeks) — and the owner read it as an end date: "I
 * need to know here that the event is gonna be auto-renewed". The rule lives on the source event
 * only, and the members carry `repeat_of`; so this looks for the one row that carries a rule and
 * answers with its `until` — `null` for a series that goes on for ever — or `null` altogether
 * when no row has one (a set of dates made once, §64, which really does end).
 *
 * Pure: hand it the `repeat_rule` columns and get the answer; the sentence is the caller's.
 */
export function renewalOf(repeatRules: readonly unknown[]): { until: string | null } | null {
  for (const raw of repeatRules) {
    const rule = readRepeatRule(raw);
    if (rule) return { until: rule.until ?? null };
  }
  return null;
}

/** The rule as a sentence: "În fiecare luni și miercuri, la 18:30" / "Lunar, pe 11" (§122). */
export async function ruleSentence(rule: RepeatRule, source: { startsAt: Date }, timeZone: string, locale: string): Promise<string> {
  const t = await getTranslations("Event");
  const wall = toWallTimeInput(source.startsAt, timeZone);
  if (rule.cadence === "MONTHLY") return t("series.monthly", { day: Number(wall.slice(8, 10)) });
  const weekdays = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [wallClockWeekday(source.startsAt, timeZone)];
  const named = weekdayNames(locale);
  const names = weekdays.map((weekday) => named[String(weekday)]);
  const days = new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  const sentence = rule.cadence === "WEEKLY" ? t("series.weekly", { days }) : t("series.fortnightly", { days });
  return t("series.atTime", { sentence, time: wall.slice(11, 16) });
}

/**
 * The seven weekday names by ISO number (1 = Monday) — "luni" … "duminică" / "Monday" … "Sunday"
 * — as `ruleSentence` writes them. Also handed, as strings, to the Recurență box's live sentence
 * (`RepeatRuleFields`), so that client island never formats a date itself (§324).
 */
export function weekdayNames(locale: string): Record<string, string> {
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // Any week's Monday plus the offset names the day; 2024-01-01 is a Monday.
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((weekday) => [String(weekday), weekdayName.format(new Date(Date.UTC(2024, 0, weekday, 12)))]));
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
      // "12 date", "20 de date", "1 dată" (§341): the count picks the catalogue's phrasing.
      dates: t(`series.count.${countForm(members.length, locale)}`, { count: members.length }),
      // "12 date, până pe duminică, 14 dec. 2026": inside the sentence, lower case (§NNN).
      last: formatDay(last.startsAt, { locale, timeZone, style: "long", position: "inline" }),
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
