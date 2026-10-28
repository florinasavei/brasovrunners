import { getFormatter, getTranslations } from "next-intl/server";
import type { CalendarImageFormat } from "../domain/calendar-image-rows";
import { distanceWords } from "../domain/distance";
import { elevationWords } from "../domain/elevation";

/**
 * The route's short words for the picture's dates, as the page's pills say them (`route-pills.ts`,
 * §598, §585): «8 km», «≈ 10 km», «350 m D+», «≈ 350 m D+» — null when the event states none. In the
 * page's language and number format, from the `Event` catalogue the pills read.
 *
 * Its own module, apart from `calendar-image-data.ts`, which translates under the dialog's own
 * namespace: the catalogue guard (`tests/unit/i18n/messages.test.ts`) reads one namespace per file.
 */
export async function routeWordFormat(): Promise<Pick<CalendarImageFormat, "distance" | "elevation">> {
  const t = await getTranslations("Event");
  const format = await getFormatter();
  return {
    distance: (event) => distanceWords(event, t, (km) => format.number(km, { maximumFractionDigits: 1 }))?.short ?? null,
    elevation: (event) => elevationWords(event, t, (value) => format.number(value))?.short ?? null,
  };
}
