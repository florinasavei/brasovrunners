import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { EmailAttachment, EmailCalendar } from "@/infrastructure/email/adapter";
import { toCalendarEvent } from "@/modules/events/calendar";
import { calendarLabels } from "@/modules/events/calendar-labels";
import { datedOrNull } from "@/modules/events/domain/dated";
import { buildCalendar } from "@/modules/events/ical";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import type { CalendarPart } from "./domain/calendar-part";

/**
 * The event in the runner's calendar, as the message carries it (§174, §NNN): the part
 * `calendarPartFor` chose, built from the same function the event page's file and the feed use
 * (`toCalendarEvent`, `buildCalendar`), so what lands in a calendar says what the page says.
 *
 * **A published, dated event only**, as since §174: a draft's `.ics` would put an unpublished
 * page's details into somebody's calendar, and an event whose date is to be announced (§533) has no
 * entry to give. The members' audience (§552): the message is to somebody registered for the event
 * or who signed for it, past the door already. Without such a row the message goes without a part.
 *
 * - `file` — today's attachment, `<slug>.ics`, `METHOD:PUBLISH`, byte for byte as before.
 * - `REQUEST` / `CANCEL` — the invitation (`OutgoingEmail.calendar`): the club's address as the
 *   organizer, the message's own address as the one attendee — the address the message goes to,
 *   which is the one the calendar app matches against its account to offer the answer — and the
 *   event's `calendar_sequence`.
 */
export async function renderCalendarPart<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    part: CalendarPart;
    locale: Locale;
    slug: string;
    now: Date;
    /** The club's address for the answers; required for an invitation. */
    rsvpTo: string | null;
    /** The event's `calendar_sequence`, read with the batch's event rows. */
    sequence: number;
    attendee: { email: string; name?: string | null };
  },
): Promise<{ attachments?: EmailAttachment[]; calendar?: EmailCalendar }> {
  const found = await findPublishedEventBySlug(db, input.locale, input.slug, "members");
  const published = found ? datedOrNull(found) : null;
  if (!published) return {};
  const events = [toCalendarEvent(published, input.locale, input.now)];
  const labels = calendarLabels(input.locale);
  if (input.part === "file") {
    const ics = buildCalendar({ events, baseUrl: env.APP_BASE_URL, name: published.title, labels });
    return { attachments: [{ filename: `${input.slug}.ics`, contentType: "text/calendar; charset=utf-8", data: Buffer.from(ics, "utf8") }] };
  }
  // An invitation has an organizer or it is not one (`calendarPartFor` asks for the address first).
  if (!input.rsvpTo) return {};
  /*
    The method follows the event as it stands at the send (§331: nothing a message says is older than
    its send): a request rendered after the event was cancelled is its cancellation — never a «Vii?»
    for a race called off — and a cancellation rendered after the date is on again carries nothing,
    because the notice that says it is on again carries the invitation.
  */
  const cancelledNow = published.eventStatus === "CANCELLED";
  if (input.part === "CANCEL" && !cancelledNow) return {};
  const method = cancelledNow ? "CANCEL" : input.part;
  const ics = buildCalendar({
    events,
    baseUrl: env.APP_BASE_URL,
    name: published.title,
    labels,
    rsvp: {
      method,
      organizerEmail: input.rsvpTo,
      // The platform's one constant for the club's everyday name (§215), as the sender's name is.
      organizerName: CLUB_NAME,
      attendeeEmail: input.attendee.email,
      attendeeName: input.attendee.name ?? null,
      sequence: input.sequence,
      now: input.now,
    },
  });
  return { calendar: { method, ics } };
}
