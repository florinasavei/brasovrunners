import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import type { events } from "@/db/schema/events";
import { formatDay, formatTime, intlLocale } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { costUrlHost } from "@/modules/events/domain/cost";
import { localizedSchedule, programmeLines, readScheduleItems } from "@/modules/events/domain/schedule";
import { orderRoutePills, routePillParts } from "@/modules/events/ui/route-pills";
import { COLOR } from "@/theme/brand";

/**
 * The event's facts in an email, as one block (§392; the owner, 2026-09-25: "la mailul de
 * «Înscrierea este confirmată» am nevoie de mai multe detalii, gen locație, program, etc.").
 *
 * Six rows, the event page's own questions in the page's own words (`EventFacts`, §356): **Când**
 * (the date, the time — a race's two named times), **Unde** (the place in this language, its
 * address, the map), **Program** (the programme's timed rows, §117), **Traseu** (the route's facts
 * as the page's pills say them — surface, difficulty, distance, elevation, headlamp — through
 * `routePillParts`/`orderRoutePills`, the source `buildRoutePills` reads, never a second list; then
 * the route link, the Strava event and the Facebook event), **Cost** (§343: what a paid event costs
 * and where, a donation and where; nothing for a free event or an unstated cost) and **Linkuri**
 * (the event's own page, then the anchors of this language's page that exist: `#schedule`,
 * `#rules`, `#route`, `#links`).
 * A row the event has nothing for is not drawn.
 *
 * One function for the three messages that carry it — the confirmation, the reminder and the
 * declaration request (the participation confirmation, §104) — so they cannot say the event
 * differently. The platform's, like the button and the QR: no placeholder of the closed set
 * (§247) stands for it, so the club's words are never asked to repeat it and a text the club has
 * saved keeps working with no edit.
 *
 * Nothing here reads a withheld fact: while the place is to be announced (§328) the query has
 * already emptied the name, the address, the map and every programme row's place, and this says the
 * page's sentence where the place would be.
 */

/** What one half of a message knows about the event, in that half's language. */
export type EmailEventFacts = Pick<
  typeof events.$inferSelect,
  | "surface"
  | "difficulty"
  | "distanceMeters"
  | "elevationGainMeters"
  | "type"
  | "endsAt"
  | "nightOverride"
  | "registrationMode"
  | "costType"
  | "costAmount"
  | "costUrl"
  | "routeUrl"
  | "stravaEventUrl"
  | "facebookEventUrl"
  | "raceStartsAt"
  | "locationToBeAnnounced"
  // The typed «Coordonate» (§416): with the map link, where the night pill's sun is read (§NNN).
  | "latitude"
  | "longitude"
> & {
  startsAt: Date;
  timezone: string;
  /** The place's name in this language (§362); null while it is to be announced (§328). */
  locationName: string | null;
  locationAddress: string | null;
  mapUrl: string | null;
  /** `events.schedule_items` as stored, read through `readScheduleItems`; the labels carry both languages. */
  scheduleItems: unknown;
  /** The event's page in this language; without it the block links nowhere on the page. */
  pageUrl: string | null;
  /** The anchors this language's page has: `#rules`, `#schedule`, `#route` (§387), `#links` (§332). */
  hasRules: boolean;
  hasSchedule: boolean;
  hasRouteDescription: boolean;
  hasOtherLinks: boolean;
};

/** The block, ready for a message: the HTML part and the plain-text lines, which say the same. */
export type EventFactsBlock = { html: string; text: string };

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A piece of a row's line: words, or words that are a link. */
type Piece = { text: string; url?: string };
type Row = { label: string; lines: Piece[][] };

/** The `Event` catalogue outside a request — the renderer runs from the scheduler (`calendar-labels.ts`). */
function eventWords(locale: Locale): Translate {
  return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Event" }) as unknown as Translate;
}

/**
 * The forecast's row, already in this half's words (`weatherWords`): the reminder passes it (§402),
 * the confirmation and the declaration request never do — a forecast read weeks before race day
 * would be out of date by then.
 */
export type EmailWeatherRow = { label: string; summary: string; details: string[]; credit: string };

export function eventFactsBlock(details: EmailEventFacts, locale: Locale, weather?: EmailWeatherRow): EventFactsBlock {
  const t = eventWords(locale);
  const zone = details.timezone;
  const time = (at: Date) => formatTime(at, { locale, timeZone: zone });
  const rows: Row[] = [];

  // Când: the date starts its line, capitalised (§349), then the time — a race's two, each named, as on the page.
  const day = formatDay(details.startsAt, { locale, timeZone: zone, style: "long" });
  const times = details.raceStartsAt
    ? [t("gatheringAt", { time: time(details.startsAt) }), t("raceStartAt", { time: time(details.raceStartsAt) })]
    : [time(details.startsAt)];
  rows.push({ label: t("when"), lines: [[{ text: day }, ...times.map((text) => ({ text }))]] });

  // Vremea: the forecast at the start, right under «Când», the hour it is for (§402), and the credit its licence asks for, as a word.
  if (weather) rows.push({ label: weather.label, lines: [[{ text: [weather.summary, ...weather.details].join(", ") }], [{ text: weather.credit }]] });

  // Unde: the page's sentence while the place is to be announced (§328), and nothing else.
  if (details.locationToBeAnnounced) {
    rows.push({ label: t("where"), lines: [[{ text: t("locationToBeAnnounced") }]] });
  } else {
    const name = details.locationName?.trim();
    const address = details.locationAddress?.trim();
    const where: Piece[][] = [
      ...(name ? [[{ text: name }]] : []),
      ...(address ? [[{ text: address }]] : []),
      ...(details.mapUrl ? [[{ text: t("openMap"), url: details.mapUrl }]] : []),
    ];
    if (where.length > 0) rows.push({ label: t("where"), lines: where });
  }

  // Program: the timed rows, each half's own labels (§117); the free text stays on the page, behind `#schedule`.
  const programme = programmeLines(localizedSchedule(readScheduleItems(details.scheduleItems), locale), zone, locale);
  if (programme.length > 0) rows.push({ label: t("calendar.programme"), lines: programme.map((text) => [{ text }]) });

  // Traseu: the page's pills as words, in the page's order; under them the route's own links.
  const format = { number: (value: number, options?: { maximumFractionDigits?: number }) => new Intl.NumberFormat(intlLocale(locale), options).format(value) };
  // The night pill's sunset sentence rides on `tooltip` on the page and the card, where hovering
  // or focusing the chip opens it; an email has no chip to hover, so it goes in parentheses right
  // after the word instead — the same sentence, never a second one written here.
  const pills = orderRoutePills(routePillParts(details, t, format)).map((pill) => ({
    text: pill.tooltip ? `${pill.label} (${pill.tooltip})` : pill.label,
  }));
  const routeLinks: Piece[] = [
    // With a route description the route link lives in the page's "Traseul" section (§387), which the Linkuri row points at.
    ...(details.routeUrl && !(details.hasRouteDescription && details.pageUrl) ? [{ text: t("openRoute"), url: details.routeUrl }] : []),
    ...(details.stravaEventUrl ? [{ text: t("openStravaEvent"), url: details.stravaEventUrl }] : []),
    ...(details.facebookEventUrl ? [{ text: t("openFacebookEvent"), url: details.facebookEventUrl }] : []),
  ];
  if (pills.length > 0 || routeLinks.length > 0) {
    rows.push({ label: t("route"), lines: [...(pills.length > 0 ? [pills] : []), ...routeLinks.map((link) => [link])] });
  }

  // Cost (§343): only what a runner pays or gives — a free event, or one with no stated cost, draws no row.
  const host = details.costUrl ? costUrlHost(details.costUrl) : null;
  if (details.costType === "PAID") {
    rows.push({
      label: t("cost"),
      lines: [
        [{ text: details.costAmount?.trim() || t("costValues.PAID") }],
        ...(details.costUrl && host ? [[{ text: t("costPaidWhere", { host }), url: details.costUrl }]] : []),
      ],
    });
  } else if (details.costType === "DONATION") {
    rows.push({
      label: t("cost"),
      lines: [
        [{ text: t("costValues.DONATION") }, ...(details.costAmount?.trim() ? [{ text: t("costDonationSuggested", { amount: details.costAmount.trim() }) }] : [])],
        ...(details.costUrl && host ? [[{ text: t("costDonateOn", { host }), url: details.costUrl }]] : []),
      ],
    });
  }

  // Linkuri: the event's own page first, then the sections this language's page has, by the
  // page's own rules — never an anchor that is not there.
  if (details.pageUrl) {
    const page = details.pageUrl;
    const anchors: Piece[] = [
      { text: t("pageLabel"), url: page },
      ...(details.hasSchedule ? [{ text: t("calendar.programme"), url: `${page}#schedule` }] : []),
      ...(details.hasRules ? [{ text: t("calendar.rules"), url: `${page}#rules` }] : []),
      ...(details.hasRouteDescription ? [{ text: t("routeSection"), url: `${page}#route` }] : []),
      ...(details.hasOtherLinks ? [{ text: t("links.heading"), url: `${page}#links` }] : []),
    ];
    rows.push({ label: t("linksLabel"), lines: [anchors] });
  }

  return { html: blockHtml(rows), text: blockText(rows) };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * One outlined box, a row per question: the label bold on its own line, the value under it — a
 * phone's width holds a label and a long place name one under the other, never side by side.
 * Inline styles only, and no table, like the rest of the card (§96).
 */
function blockHtml(rows: Row[]): string {
  const piece = (part: Piece) =>
    part.url ? `<a href="${escapeHtml(part.url)}" style="color:${COLOR.blueInk}">${escapeHtml(part.text)}</a>` : escapeHtml(part.text);
  const body = rows
    .map((row, index) => {
      const lines = row.lines.map((line) => line.map(piece).join(" · ")).join("<br>");
      const margin = index === rows.length - 1 ? "0" : "0 0 10px";
      return `<p style="margin:${margin};font-size:15px;line-height:1.5"><strong>${escapeHtml(row.label)}</strong><br>${lines}</p>`;
    })
    .join("");
  return `<div data-email-part="event-facts" style="margin:0 0 18px;padding:14px 16px;border:1px solid ${COLOR.line};border-radius:10px">${body}</div>`;
}

/**
 * The same rows as text: "Când: Duminică, 4 oct. 2026 · 09:00", further lines indented under the
 * label, and a link as "Vezi pe hartă: https://…" on a line of its own — a text client makes the
 * address clickable, and nothing follows it on the line.
 */
function blockText(rows: Row[]): string {
  const out: string[] = [];
  for (const row of rows) {
    const lines = row.lines.flatMap((line) => {
      const words = line.filter((part) => !part.url).map((part) => part.text);
      const links = line.filter((part) => part.url).map((part) => ({ text: `${part.text}: ${part.url}`, link: true }));
      return [...(words.length > 0 ? [{ text: words.join(" · "), link: false }] : []), ...links];
    });
    const [first, ...rest] = lines;
    // Words start on the label's line; a link never does, so its address is alone on its line.
    if (first && !first.link) {
      out.push(`${row.label}: ${first.text}`, ...rest.map((line) => `  ${line.text}`));
    } else {
      out.push(`${row.label}:`, ...lines.map((line) => `  ${line.text}`));
    }
  }
  return out.join("\n");
}
