import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { CalendarLabels } from "./ical";

/**
 * The `Event` catalogue outside a request (§174).
 *
 * `.ics` is built in two places now: the public routes, which have a request and take
 * `getTranslations`, and the **outbox renderer**, which has neither — it runs from the
 * scheduler, draining rows long after the request that queued them has gone. `createTranslator`
 * is next-intl's own answer for that: the same message resolution, given the locale and the
 * messages rather than reading them off a request.
 *
 * The catalogues are imported statically, which is what the rest of the application does with
 * them anyway, so nothing new is bundled.
 */
export function calendarLabels(locale: "ro" | "en"): CalendarLabels {
  return {
    locale,
    t: createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Event" }) as CalendarLabels["t"],
  };
}

/**
 * "Locația se anunță în curând" outside a request (§328): the emails' facts line and a
 * `{eventLocationName}` in the club's own copy, in the same words — the same key — as the page,
 * the card and the calendar.
 */
export function placeToBeAnnouncedWords(locale: "ro" | "en"): string {
  return calendarLabels(locale).t("locationToBeAnnounced");
}
