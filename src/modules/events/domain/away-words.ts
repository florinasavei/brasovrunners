import { type CountForm, countForm } from "@/i18n/count-form";
import type { AwayPrecise } from "./next-event-away";

/** A counted phrase's three forms, raw, each with `{count}` (§341). */
type Counted = Readonly<Record<CountForm, string>>;

/**
 * The words of the calendar card's countdown to the hour (§843), raw from `Events.calendar.look.nextEvent.away`, handed by the
 * server to the island (`AwayLine`) as strings: no catalogue crosses to the browser for one line.
 */
export type AwayWords = {
  now: string;
  todayIn: string;
  tomorrowIn: string;
  daysAndHours: string;
  minutes: Counted;
  hours: Counted;
  days: Counted;
  /** «Peste 4 zile», «Peste 3 săptămâni», «Peste 2 luni»: `awayFrom`'s own phrases, for a whole number of days and beyond. */
  wholeDays: Counted;
  weeks: Counted;
  months: Counted;
};

const counted = (forms: Counted, count: number, locale: string) => forms[countForm(count, locale)].replace("{count}", String(count));

/** The line for one distance: «Azi, peste 3 ore», «Mâine, peste 40 de minute», «Peste 4 zile și 3 ore», «Peste 4 zile». Pure. */
export function awayPreciseWords(away: AwayPrecise, words: AwayWords, locale: string): string {
  switch (away.kind) {
    case "now":
      return words.now;
    case "minutes":
    case "hours": {
      const span = counted(away.kind === "minutes" ? words.minutes : words.hours, away.count, locale);
      return (away.day === "today" ? words.todayIn : words.tomorrowIn).replace("{span}", span);
    }
    case "daysHours":
      return away.hours === 0
        ? counted(words.wholeDays, away.days, locale)
        : words.daysAndHours.replace("{days}", counted(words.days, away.days, locale)).replace("{hours}", counted(words.hours, away.hours, locale));
    case "weeks":
      return counted(words.weeks, away.count, locale);
    case "months":
      return counted(words.months, away.count, locale);
  }
}
