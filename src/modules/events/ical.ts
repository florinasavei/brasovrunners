import { isRichTextEmpty, readRichText, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { type CoHost, primaryCoHostLink } from "./domain/co-hosts";
import { costUrlHost, type EventCostType } from "./domain/cost";
import { distanceInKm, type EventSurface, type EventType } from "./domain/event-type";
import { type RegistrationWindowInput, registrationState } from "./domain/registration-window";
import { type ProgrammeRow, programmeLines } from "./domain/schedule";
import { env } from "@/shared/config/env";
import { formatDay, formatTime } from "@/i18n/dates";

/**
 * The environment on a calendar name and on every entry, QA only (§174; the owner: "the QA
 * iCal needs to be named differently!").
 *
 * The UIDs already differ between deployments — each carries its own site's host — so two
 * copies of an event never merge into one. What they do instead is sit side by side in one
 * calendar app, same title, same hour, with nothing on screen to say which is the real Sunday
 * run: the club's own people subscribe to both while rehearsing. The same mark an email
 * subject carries on QA (`QA_SUBJECT_PREFIX`), and idempotent for the same reason.
 *
 * Production is never marked; local and test never leave the machine.
 */
const QA_MARK = "[QA] ";
function qaMarked(value: string): string {
  if (env.APP_ENV !== "qa" || value.startsWith(QA_MARK)) return value;
  return `${QA_MARK}${value}`;
}

/**
 * Events as a calendar (`DECISIONS.md` §107; BR-REQ-020-01 criterion 7): one `.ics` per event for "add to
 * my calendar", and one feed with every published event for Google Calendar, Apple Calendar
 * and Outlook to subscribe to. RFC 5545, written here rather than through a library because
 * the format is twenty lines and the two things that go wrong — line folding at 75 octets
 * and escaping — are the two things a test can pin.
 *
 * Times are written in UTC (`…Z`): every calendar converts them to the reader's zone, and it
 * spares the file a VTIMEZONE block that would have to be right for every DST rule. The
 * event's own zone is still what the page shows; the calendar shows the same instant.
 *
 * The description carries everything the page says (§159): a cancelled or finished event's
 * notice first, the meeting point with its address and map, the short description and the
 * start of the long one, the times and the facts in one line each, where registration stands
 * and the link to it, the page, the rules, the programme, the route, the film, the Strava and
 * Facebook events, the programme's rows and text, what to bring and the co-host — as plain
 * text in `DESCRIPTION`, where Apple and Google make the bare addresses tappable (which is
 * why the plain twin writes `words — address`), and the same as minimal HTML in `X-ALT-DESC`,
 * which Outlook renders with the words as the links.
 */

/** Where registration stands for the calendar's reader, decided by `calendarRegistration`. */
export type CalendarRegistration =
  | { kind: "OPEN"; url: string }
  | { kind: "NOT_YET_OPEN"; opensAt: Date; url: string }
  | { kind: "CLOSED" }
  | { kind: "EXTERNAL"; url: string | null };

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: Date;
  /** Null means "the start"; a calendar then shows a point in time rather than an all-day block. */
  endsAt: Date | null;
  /** Cancelled: `STATUS:CANCELLED` and the page's notice first in the description (§159); finished: the notice. */
  eventStatus?: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  /** The gun time, when it differs from the gathering (§159): "întâlnire la 08:00 · start la 09:00", the page's words. */
  raceStartsAt?: Date | null;
  /** What the event is (§112): the page's overline, the first word of the facts line. */
  type?: EventType | null;
  locationName: string | null;
  /** The street address the page shows under "Adresă" (§159): its own line, and the place when there is no map link. */
  locationAddress?: string | null;
  /** The organizer's map link (§61): the calendar's place, so one tap opens the map (§129). */
  mapUrl?: string | null;
  /**
   * The place is not announced yet (§328): no `LOCATION` at all, and the description opens with
   * the page's sentence where the meeting point would be. The public query has already withheld
   * the three fields above; this says why they are empty.
   */
  locationToBeAnnounced?: boolean;
  /** The short description, plain. */
  excerpt: string | null;
  /** The long description (§156), as a rich-text document or null; its first lines follow the short one (§159). */
  bodyJson?: unknown;
  /** The programme's text (§96), as a rich-text document or null; rendered as plain lines. */
  scheduleJson: unknown;
  /** The rules (§96), as a rich-text document or null; only their presence matters here — the line links `#rules`. */
  rulesJson?: unknown;
  /** The programme's rows (§117), in the calendar's language: one VEVENT each, and lines in the description. */
  programme?: readonly ProgrammeRow[];
  /** The event's own zone, for the programme lines' clock. */
  timezone?: string;
  /** The facts line (§159): what the page's facts say, in the calendar's language through `labels.t`. */
  distanceMeters?: number | null;
  elevationGainMeters?: number | null;
  surface?: EventSurface | null;
  difficulty?: "EASY" | "MODERATE" | "HARD" | null;
  costType?: EventCostType | null;
  /** What a paid event costs, or what a donation suggests (§343); free text, the club's own. */
  costAmount?: string | null;
  /** Where a paid event is settled, or where a donation is made (§343); https, or nothing. */
  costUrl?: string | null;
  /** The links group (§159): each line only when the organizer gave the link. */
  routeUrl?: string | null;
  videoUrl?: string | null;
  stravaEventUrl?: string | null;
  facebookEventUrl?: string | null;
  /** "What to bring", the translation's one line (§81). */
  checklist?: string | null;
  /**
   * The organizations the event is held with (§168), in the club's own order: one line each,
   * the first carrying the label, every one carrying its own page. `toCalendarEvent` reads
   * them through `readCoHosts`, so a row saved before the list existed still says its
   * partner here.
   */
  coHosts?: readonly CoHost[];
  /**
   * Where registration stands, with the link to the form (§159) — `calendarRegistration`
   * decides from the window and the clock, so a feed built from the public row must set it.
   * Nothing when the event takes no registration.
   */
  registration?: CalendarRegistration | null;
  /** The event's public page, absolute. */
  url: string;
  /**
   * When the entry last changed, for `DTSTAMP`/`LAST-MODIFIED`; the start when unknown. A feed
   * sets it through `calendarStamp`, so the stamp moves when the registration line does.
   */
  updatedAt: Date | null;
};

const PRODID = "-//Brasov Runners//events//RO";

/**
 * How much of the long description the entry carries (§159): the page has the whole; the
 * entry opens with it and links the page.
 */
const BODY_CHARS = 600;

/**
 * Google's add-event link carries the description in its address (§159): the free text is
 * cut at this many characters — the page link then stands last — because the programme's
 * text has no ceiling, Romanian letters cost six characters each once encoded, and Google
 * refuses an address past a few kilobytes. The `.ics` file keeps the whole text.
 */
const GOOGLE_DETAILS_CHARS = 1500;

/** `20261011T060000Z`. */
export function icalUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped in TEXT values. */
export function icalText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** The UTF-8 size of one code point. */
function octets(char: string): number {
  const point = char.codePointAt(0) ?? 0;
  return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + one space, and a fold may
 * not split a character. Counted in octets, code point by code point — the club writes
 * emoji in its titles (four octets, two UTF-16 units), and slicing the string at a fixed
 * index would cut one in half.
 */
export function icalFold(line: string): string {
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const limit = chunks.length === 0 ? 75 : 74; // the continuation's leading space is an octet
    const width = octets(char);
    if (size + width > limit) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  chunks.push(current);
  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join("\r\n");
}

/** A rich-text document as plain lines, or "" when there is none or it is empty. */
function richTextLines(json: unknown): string {
  if (!json) return "";
  const doc = readRichText(json);
  if (isRichTextEmpty(doc)) return "";
  return richTextToPlainText(doc).trim();
}

/** The first `max` characters of a text, cut at a word and marked with an ellipsis; the whole when it fits. */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  return `${head.slice(0, at > max / 2 ? at : max).trimEnd()}…`;
}

/** The UID's host part: from the site's own address, so two deployments never share a UID. */
function uidHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "events";
  }
}

/**
 * The calendar's place (§129): the map link when the organizer gave one — Google Calendar,
 * Apple and Outlook open it in one tap, which an address they would have to geocode does not
 * promise. Without a map link the name and the street address are the place, as before.
 * Either way the description opens with the meeting point's name, marked, and the map beside
 * it (§159), so the reader still knows where "Aleea de sub Tâmpa" is by name; "Vezi pe
 * hartă" stands for a name the organizer did not give, as on the page; the address is the
 * next line, as the page's "Adresă".
 *
 * **While the place is to be announced (§328) there is no `LOCATION`**, and the first line of
 * the description is the page's sentence, "📍 Locația se anunță în curând". Not "Brașov": a
 * calendar geocodes `LOCATION` and offers directions to it, and directions to the middle of
 * the city are directions to the wrong place on the morning of a race. The feed changes the
 * entry when the place is announced; an `.ics` saved earlier keeps the sentence and its link
 * to the page, which has the place.
 */
function calendarPlace(
  event: Pick<CalendarEvent, "locationName" | "locationAddress" | "mapUrl" | "locationToBeAnnounced">,
  labels: CalendarLabels,
): { location: string | null; lines: Line[] } {
  if (event.locationToBeAnnounced) return { location: null, lines: [{ text: `📍 ${labels.t("locationToBeAnnounced")}` }] };
  const name = event.locationName?.trim() ?? "";
  const address = event.locationAddress?.trim() ?? "";
  const mapUrl = event.mapUrl || undefined;
  const lines: Line[] = [];
  if (name) lines.push({ text: `📍 ${name}`, url: mapUrl, separator: " — " });
  else if (mapUrl) lines.push({ text: `📍 ${labels.t("openMap")}`, url: mapUrl, separator: " — " });
  if (address) lines.push({ text: `${labels.t("address")}: ${address}` });
  return { location: mapUrl ?? ([name, address].filter((part) => part.length > 0).join(", ") || null), lines };
}

/**
 * Where registration stands for the calendar (§159), from the same window rule the page
 * uses (`registrationState`). Null when there is nothing to say: no registration at all, or
 * an event cancelled or over. `registerUrl` is the form's absolute address, `now` the clock,
 * passed in like everywhere the window is read (AGENTS.md §1.5).
 */
export function calendarRegistration(
  event: RegistrationWindowInput & { externalRegistrationUrl: string | null },
  registerUrl: string,
  now: Date,
): CalendarRegistration | null {
  switch (registrationState(event, now)) {
    case "OPEN":
      return { kind: "OPEN", url: registerUrl };
    case "NOT_YET_OPEN": {
      const opensAt = event.registrationOpensAt ?? event.publishedAt;
      return opensAt ? { kind: "NOT_YET_OPEN", opensAt, url: registerUrl } : null;
    }
    case "CLOSED":
      return { kind: "CLOSED" };
    case "EXTERNAL":
      return { kind: "EXTERNAL", url: event.externalRegistrationUrl };
    default:
      return null;
  }
}

/**
 * `DTSTAMP`/`LAST-MODIFIED` for an entry (§159): the later of when the row last changed and the
 * last boundary of the registration window the clock has passed. The registration line flips
 * at those two instants — "se deschid pe" to "sunt deschise" to "s-au închis" — without the
 * row changing, and a subscriber's app that re-reads an entry only when its stamp moves would
 * keep the old sentence. Only an internal window has boundaries the text follows.
 */
export function calendarStamp(event: RegistrationWindowInput & { updatedAt: Date | null }, now: Date): Date | null {
  const boundaries =
    event.registrationMode === "INTERNAL" && event.eventStatus === "SCHEDULED"
      ? [event.registrationOpensAt ?? event.publishedAt, event.registrationClosesAt ?? event.startsAt]
      : [];
  return boundaries.reduce<Date | null>((latest, at) => (at && at <= now && (!latest || at > latest) ? at : latest), event.updatedAt);
}

export type CalendarLabels = {
  locale?: "ro" | "en";
  /**
   * The "Event" catalogue, as next-intl hands it out — `t("calendar.page")`, `t("surface.TRAIL")`,
   * `t("distanceKm", { km })` — so the calendar says exactly what the page says. A function
   * rather than twenty strings: the routes pass `t` and nothing else.
   */
  t: (key: string, values?: Record<string, string | number>) => string;
};

/**
 * One line of the description: words, and a link when there is one. The plain twin writes
 * `text<separator>url`; the HTML twin makes the words the link.
 */
type Line = { text: string; url?: string; separator?: string };

function plainLine(line: Line): string {
  return line.url ? `${line.text}${line.separator ?? ": "}${line.url}` : line.text;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlLine(line: Line): string {
  const text = escapeHtml(line.text).replace(/\r?\n/g, "<br>");
  return line.url ? `<a href="${escapeHtml(line.url)}">${text}</a>` : text;
}

/**
 * The description's groups (§159), in the order the page tells the story: the notice of a
 * cancelled or finished event, where, what, the times and the facts, whether one can
 * register, the links, the programme, what to bring, with whom. A group is a list of lines;
 * groups are separated by a blank line in the plain text and are paragraphs in the HTML. An
 * empty group is dropped, so an event with none of the optional facts reads like it did
 * before.
 */
function descriptionGroups(event: CalendarEvent, labels: CalendarLabels): Line[][] {
  const { t } = labels;
  const locale = labels.locale ?? "ro";
  const intl = locale === "ro" ? "ro-RO" : "en-GB";
  const timeZone = event.timezone ?? "Europe/Bucharest";
  const rows = event.programme ?? [];
  const place = calendarPlace(event, labels);

  // The page's own sentence for an event that will not happen or has happened (BR-REQ-020-01 criteria 2 and 4).
  const notice = event.eventStatus === "CANCELLED" ? t("cancelledNotice") : event.eventStatus === "COMPLETED" ? t("completedNotice") : "";

  // "întâlnire la 08:00 · start la 09:00": the page's two times when the race has a gun time.
  const time = (at: Date) => formatTime(at, { locale, timeZone });
  const times = event.raceStartsAt ? `${t("gatheringAt", { time: time(event.startsAt) })} · ${t("raceStartAt", { time: time(event.raceStartsAt) })}` : "";

  /*
    The cost (§343), the same short phrase the page's full facts say — an amount for a paid
    event, "plata pe {host}" after it when the club gave a link; a donation's own phrase names
    the host it goes to, with the suggested amount after it. Never the raw URL: only the host a
    runner recognises, which is what the page's own facts line allows too.
  */
  const costFacts = ((): string[] => {
    if (event.costType === "PAID") {
      const main = event.costAmount ? t("costPaidAmount", { amount: event.costAmount }) : t("costValues.PAID");
      const host = event.costUrl ? costUrlHost(event.costUrl) : null;
      return host ? [main, t("costPaidWhere", { host })] : [main];
    }
    if (event.costType === "DONATION") {
      const host = event.costUrl ? costUrlHost(event.costUrl) : null;
      const main = host ? t("costDonation", { host }) : t("costValues.DONATION");
      return event.costAmount ? [main, t("costDonationSuggested", { amount: event.costAmount })] : [main];
    }
    return event.costType ? [t(`costValues.${event.costType}`)] : [];
  })();

  // "Concurs · 🏃 10 km · ↗ 300 m urcare · Trail · Mediu · Gratuit": the page's own words (§112), one line.
  const km = distanceInKm(event.distanceMeters ?? null);
  const facts = [
    event.type ? t(`type.${event.type}`) : "",
    km !== null ? `🏃 ${t("distanceKm", { km: new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(km) })}` : "",
    event.elevationGainMeters ? `↗ ${t("elevationM", { m: new Intl.NumberFormat(intl).format(event.elevationGainMeters) })}` : "",
    event.surface ? t(`surface.${event.surface}`) : "",
    event.difficulty ? t(`difficultyValues.${event.difficulty}`) : "",
    ...costFacts,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");

  // Where registration stands, with the door (§146, §159): the fact a subscriber reads the
  // feed for, above the links — a phone that rings for the start is no help with a race that
  // filled up the week entries opened. The page's own sentences (`registrationState`, the CTA).
  const registration = ((): Line | null => {
    const r = event.registration;
    if (!r) return null;
    if (r.kind === "OPEN") return { text: t("registrationState.OPEN"), url: r.url, separator: " — " };
    if (r.kind === "NOT_YET_OPEN") {
      // Human text in the DESCRIPTION, so the one long form, inside the sentence (§NNN); the
      // DTSTART/DTEND stay the machine's.
      const date = formatDay(r.opensAt, { locale, timeZone, style: "long", withTime: true, position: "inline" });
      return { text: t("cta.opensOnShort", { date }), url: r.url, separator: " — " };
    }
    if (r.kind === "CLOSED") return { text: t("registrationState.CLOSED") };
    return { text: t("registrationState.EXTERNAL"), url: r.url ?? undefined, separator: " — " };
  })();

  // The rows first, then the text beneath them, under the page's heading — as the page shows them.
  const programme = [...programmeLines(rows, timeZone, locale), ...[richTextLines(event.scheduleJson)].filter((text) => text.length > 0)];
  const hasRules = richTextLines(event.rulesJson).length > 0;

  // Short labels for the links, the page's headings for the groups: "Program: <page>#schedule"
  // in the list of links, "Programul evenimentului:" above the rows.
  const links: Line[] = [
    { text: t("calendar.page"), url: event.url },
    ...(hasRules ? [{ text: t("calendar.rules"), url: `${event.url}#rules` }] : []),
    ...(programme.length > 0 ? [{ text: t("calendar.programme"), url: `${event.url}#schedule` }] : []),
    ...(event.routeUrl ? [{ text: t("route"), url: event.routeUrl }] : []),
    ...(event.videoUrl ? [{ text: t("video.open"), url: event.videoUrl }] : []),
    ...(event.stravaEventUrl ? [{ text: t("openStravaEvent"), url: event.stravaEventUrl }] : []),
    ...(event.facebookEventUrl ? [{ text: t("openFacebookEvent"), url: event.facebookEventUrl }] : []),
  ];

  const excerpt = event.excerpt?.trim() ?? "";
  const body = cutText(richTextLines(event.bodyJson), BODY_CHARS);
  const checklist = event.checklist?.trim() ?? "";
  const coHosts = (event.coHosts ?? []).filter((host) => host.name.trim() !== "");
  return [
    notice ? [{ text: notice }] : [],
    place.lines,
    excerpt ? [{ text: excerpt }] : [],
    body ? [{ text: body }] : [],
    [times, facts].filter((text) => text.length > 0).map((text) => ({ text })),
    registration ? [registration] : [],
    links,
    programme.length > 0 ? [{ text: `${t("schedule")}:` }, ...programme.map((text) => ({ text }))] : [],
    checklist ? [{ text: `${t("calendar.checklist")}: ${checklist}` }] : [],
    // "Împreună cu A", then the other partners on their own lines: the label is said once,
    // and each partner keeps its own link — its site if it named one, else its first link
    // (§344) — which a joined sentence could not carry (§168).
    coHosts.map((host, index) => ({
      text: index === 0 ? `${t("coHost")} ${host.name.trim()}` : host.name.trim(),
      url: primaryCoHostLink(host)?.url,
      separator: " — ",
    })),
  ].filter((group) => group.length > 0);
}

/**
 * The groups within a budget of plain characters (§159): whole lines while they fit, the line
 * that does not fit cut at a word with an ellipsis when it is text, and the page's link last
 * when the cut took it — so nothing the reader needs is lost to the ceiling.
 */
function trimGroups(groups: Line[][], budget: number, pageLink: Line): Line[][] {
  const kept: Line[][] = [];
  let used = 0;
  let cut = false;
  for (const group of groups) {
    const lines: Line[] = [];
    for (const line of group) {
      const room = budget - used;
      const length = plainLine(line).length + 1;
      if (length > room) {
        if (!line.url && room > 80) lines.push({ text: cutText(line.text, room - 1) });
        cut = true;
        break;
      }
      lines.push(line);
      used += length;
    }
    if (lines.length > 0) kept.push(lines);
    if (cut) break;
  }
  if (cut && !kept.some((group) => group.some((line) => line.url === pageLink.url))) kept.push([pageLink]);
  return kept;
}

/** The description as plain text: lines within a group, a blank line between groups. */
export function calendarDescription(event: CalendarEvent, labels: CalendarLabels): string {
  return descriptionGroups(event, labels)
    .map((group) => group.map(plainLine).join("\n"))
    .join("\n\n");
}

/** The same as minimal HTML — paragraphs and links — for `X-ALT-DESC`, which Outlook renders. */
export function calendarDescriptionHtml(event: CalendarEvent, labels: CalendarLabels): string {
  const paragraphs = descriptionGroups(event, labels).map((group) => `<p>${group.map(htmlLine).join("<br>")}</p>`);
  return `<html><body>${paragraphs.join("")}</body></html>`;
}

/**
 * The description for Google's add-event link (§159): the same groups, within the budget, as
 * the HTML Google's dialog renders — lines joined by `<br>`, the words as the links, and the
 * organizer's `<` and `&` escaped so a co-host called "A & B" is not swallowed as markup.
 */
export function googleCalendarDetails(event: CalendarEvent, labels: CalendarLabels): string {
  const groups = trimGroups(descriptionGroups(event, labels), GOOGLE_DETAILS_CHARS, { text: labels.t("calendar.page"), url: event.url });
  return groups.map((group) => group.map(htmlLine).join("<br>")).join("<br><br>");
}

export function buildVEvent(event: CalendarEvent, baseUrl: string, labels: CalendarLabels): string[] {
  const stamp = event.updatedAt ?? event.startsAt;
  const rows = event.programme ?? [];
  const place = calendarPlace(event, labels);
  // RFC 5545 §3.8.1.11: a cancelled event says so; Google, Apple and Outlook all strike it through.
  const status = event.eventStatus === "CANCELLED" ? ["STATUS:CANCELLED"] : [];
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@${uidHost(baseUrl)}`,
    `DTSTAMP:${icalUtc(stamp)}`,
    `LAST-MODIFIED:${icalUtc(stamp)}`,
    `DTSTART:${icalUtc(event.startsAt)}`,
    `DTEND:${icalUtc(event.endsAt ?? event.startsAt)}`,
    ...status,
    // The environment on the entry itself, not only on the calendar's name (§174): a single
    // event added from an attachment lands in a calendar that already has its own name, and
    // the only thing on screen is this line.
    `SUMMARY:${icalText(qaMarked(event.title))}`,
    `DESCRIPTION:${icalText(calendarDescription(event, labels))}`,
    // The HTML twin is a TEXT value too: escaped and folded like the rest (RFC 5545 §3.3.11).
    `X-ALT-DESC;FMTTYPE=text/html:${icalText(calendarDescriptionHtml(event, labels))}`,
    `URL:${event.url}`,
  ];
  if (place.location) lines.push(`LOCATION:${icalText(place.location)}`);
  lines.push("END:VEVENT");

  /**
   * One entry per programme row (§117): "Crosul aniversar — Kit pickup", at the row's own
   * time and place, so the phone rings for the briefing and not only for the start. The UID
   * carries the row's index after the event's id, stable across edits like the event's own.
   */
  rows.forEach((row, index) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}-${index + 1}@${uidHost(baseUrl)}`,
      `DTSTAMP:${icalUtc(stamp)}`,
      `LAST-MODIFIED:${icalUtc(stamp)}`,
      `DTSTART:${icalUtc(row.startsAt)}`,
      `DTEND:${icalUtc(row.endsAt ?? row.startsAt)}`,
      ...status,
      `SUMMARY:${icalText(qaMarked(`${event.title} — ${row.label}`))}`,
      `DESCRIPTION:${icalText(event.url)}`,
      `URL:${event.url}`,
    );
    const rowPlace = row.place ?? place.location;
    if (rowPlace) lines.push(`LOCATION:${icalText(rowPlace)}`);
    lines.push("END:VEVENT");
  });
  return lines;
}

export function buildCalendar(params: {
  events: readonly CalendarEvent[];
  baseUrl: string;
  /** The calendar's own name, shown by the subscriber's app. */
  name: string;
  labels: CalendarLabels;
  /** The subscriber's refresh hint: an hour (§129). Outlook reads it; Google and Apple keep their own clock. */
  refreshHours?: number;
}): string {
  /**
   * The environment on the name, on QA only (§174; the owner: "the QA iCal needs to be named
   * differently!").
   *
   * The UIDs already differ between deployments — they carry the site's own host — so two
   * copies of an event never merge into one. What they *do* is sit side by side in the same
   * calendar app, under the same name, with the same title and the same hour: the club's own
   * people subscribe to both while rehearsing, and there is nothing on screen to say which is
   * the real Sunday run. The same mark an email subject carries on QA (`QA_SUBJECT_PREFIX`),
   * and for the same reason.
   *
   * Production is not marked, and local and test never leave the machine.
   */
  const name = qaMarked(params.name);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalText(name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${params.refreshHours ?? 1}H`,
    `X-PUBLISHED-TTL:PT${params.refreshHours ?? 1}H`,
    ...params.events.flatMap((event) => buildVEvent(event, params.baseUrl, params.labels)),
    "END:VCALENDAR",
  ];
  return `${lines.map(icalFold).join("\r\n")}\r\n`;
}

/** Google Calendar's "add this event" address, for the one tap that needs no file (§107); the file's description, within Google's budget (§159). */
export function googleCalendarUrl(event: CalendarEvent, labels: CalendarLabels): string {
  const place = calendarPlace(event, labels);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${icalUtc(event.startsAt)}/${icalUtc(event.endsAt ?? event.startsAt)}`,
    details: googleCalendarDetails(event, labels),
  });
  if (place.location) params.set("location", place.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** `webcal://…`, the scheme calendar apps subscribe to; the same file over HTTPS. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, "webcal://");
}
