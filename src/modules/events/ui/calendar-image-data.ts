import { getFormatter, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatTime } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CLUB_NAME } from "@/theme/brand";
import { calendarTone } from "../domain/calendar-kind";
import type { CalendarImageData } from "../domain/calendar-image";
import { calendarImageRows } from "../domain/calendar-image-rows";
import { dayKey, type YearMonth } from "../domain/calendar";
import type { PublicEvent } from "../repository";
import type { CalendarImageDialogWords } from "./CalendarImageDialog";
import { recurrenceSentence } from "./series-sentence";

/**
 * The calendar picture's data and its dialog's words (§855), made on the server from the month the page
 * already read — no read of its own — and handed to `CalendarImageButton`, which draws in the browser.
 */
export async function calendarImageProps(
  locale: Locale,
  month: YearMonth,
  events: readonly PublicEvent[],
  baseUrl: string,
): Promise<{ data: CalendarImageData; words: CalendarImageDialogWords }> {
  const t = await getTranslations("Events.calendar.image");
  const format = await getFormatter();
  const { entries, series, singles } = calendarImageRows(month, events, (event) => formatTime(event.startsAt, { locale, timeZone: event.timezone }));
  const recurring = await Promise.all(
    series.map(async (members) => ({
      title: members[0].title ?? "",
      sentence: await recurrenceSentence(members, members[0].timezone ?? CLUB_TIME_ZONE, locale),
      tone: calendarTone(members[0]),
    })),
  );
  const specials = singles.map((event) => ({
    day: Number(dayKey(event.startsAt, event.timezone).slice(8, 10)),
    title: event.title ?? "",
    tone: calendarTone(event),
  }));
  const data: CalendarImageData = {
    month,
    entries,
    recurring,
    specials,
    host: new URL(baseUrl).host,
    clubName: CLUB_NAME,
    words: {
      heading: t("heading"),
      monthTitle: format.dateTime(new Date(Date.UTC(month.year, month.month - 1, 1, 12)), { timeZone: "UTC", month: "long", year: "numeric" }),
      weekdays: Array.from({ length: 7 }, (_, i) => format.dateTime(new Date(Date.UTC(2024, 0, 1 + i, 12)), { timeZone: "UTC", weekday: "short" })),
      recurringTitle: t("recurringTitle"),
      specialTitle: t("specialTitle"),
      cancelled: t("cancelled"),
      follow: t("follow"),
      more: t.raw("more") as string,
    },
  };
  const words: CalendarImageDialogWords = {
    open: t("open"),
    title: t("title"),
    theme: t("theme"),
    themes: { club: t("themes.club"), light: t("themes.light"), dark: t("themes.dark"), season: t("themes.season") },
    ratio: t("ratio"),
    ratios: { portrait: t("ratios.portrait"), square: t("ratios.square"), story: t("ratios.story"), landscape: t("ratios.landscape") },
    legend: t("legend"),
    download: t("download"),
    share: t("share"),
    close: t("close"),
    preview: t("preview"),
  };
  return { data, words };
}
