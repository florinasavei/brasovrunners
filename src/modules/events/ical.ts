import { isRichTextEmpty, readRichText, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { type ProgrammeRow, programmeLines } from "./domain/schedule";

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
 */

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: Date;
  /** Null means "the start"; a calendar then shows a point in time rather than an all-day block. */
  endsAt: Date | null;
  locationName: string | null;
  /** The organizer's map link (§61): the calendar's place, so one tap opens the map (§129). */
  mapUrl?: string | null;
  /** The short description, plain. */
  excerpt: string | null;
  /** The programme's text (§96), as a rich-text document or null; rendered as plain lines. */
  scheduleJson: unknown;
  /** The programme's rows (§117), in the calendar's language: one VEVENT each, and lines in the description. */
  programme?: readonly ProgrammeRow[];
  /** The event's own zone, for the programme lines' clock. */
  timezone?: string;
  /** The event's public page, absolute. */
  url: string;
  /** When the row last changed, for `DTSTAMP`/`LAST-MODIFIED`; the start when unknown. */
  updatedAt: Date | null;
};

const PRODID = "-//Brasov Runners//events//RO";

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

function scheduleLines(scheduleJson: unknown): string {
  if (!scheduleJson) return "";
  const doc = readRichText(scheduleJson);
  if (isRichTextEmpty(doc)) return "";
  return richTextToPlainText(doc).trim();
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
 * promise — and the meeting point's name then moves to the first line of the description,
 * marked, so the reader still knows where "Aleea de sub Tâmpa" is by name. Without a map link
 * the name is the place, as before.
 */
function calendarPlace(event: Pick<CalendarEvent, "locationName" | "mapUrl">): { location: string | null; line: string } {
  if (event.mapUrl) return { location: event.mapUrl, line: event.locationName ? `📍 ${event.locationName}` : "" };
  return { location: event.locationName, line: "" };
}

export function buildVEvent(event: CalendarEvent, baseUrl: string, labels: { programme: string; locale?: "ro" | "en" }): string[] {
  const stamp = event.updatedAt ?? event.startsAt;
  const rows = event.programme ?? [];
  // The rows first, then the text beneath them, under one heading — as the page shows them.
  const programme = [
    ...programmeLines(rows, event.timezone ?? "Europe/Bucharest", labels.locale ?? "ro"),
    ...[scheduleLines(event.scheduleJson)].filter((text) => text.length > 0),
  ].join("\n");
  const place = calendarPlace(event);
  const description = [place.line, event.excerpt?.trim() ?? "", programme ? `${labels.programme}:\n${programme}` : "", event.url]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@${uidHost(baseUrl)}`,
    `DTSTAMP:${icalUtc(stamp)}`,
    `LAST-MODIFIED:${icalUtc(stamp)}`,
    `DTSTART:${icalUtc(event.startsAt)}`,
    `DTEND:${icalUtc(event.endsAt ?? event.startsAt)}`,
    `SUMMARY:${icalText(event.title)}`,
    `DESCRIPTION:${icalText(description)}`,
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
      `SUMMARY:${icalText(`${event.title} — ${row.label}`)}`,
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
  labels: { programme: string; locale?: "ro" | "en" };
  /** The subscriber's refresh hint: an hour (§129). Outlook reads it; Google and Apple keep their own clock. */
  refreshHours?: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalText(params.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${params.refreshHours ?? 1}H`,
    `X-PUBLISHED-TTL:PT${params.refreshHours ?? 1}H`,
    ...params.events.flatMap((event) => buildVEvent(event, params.baseUrl, params.labels)),
    "END:VCALENDAR",
  ];
  return `${lines.map(icalFold).join("\r\n")}\r\n`;
}

/** Google Calendar's "add this event" address, for the one tap that needs no file (§107). */
export function googleCalendarUrl(event: Pick<CalendarEvent, "title" | "startsAt" | "endsAt" | "locationName" | "mapUrl" | "url" | "excerpt">): string {
  const place = calendarPlace(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${icalUtc(event.startsAt)}/${icalUtc(event.endsAt ?? event.startsAt)}`,
    details: [place.line, event.excerpt?.trim() ?? "", event.url].filter(Boolean).join("\n\n"),
  });
  if (place.location) params.set("location", place.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** `webcal://…`, the scheme calendar apps subscribe to; the same file over HTTPS. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, "webcal://");
}
