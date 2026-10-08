import type { EmailMessageType } from "@/db/schema/email-outbox";
import { changesTheCalendar, type EventChangeKind } from "@/modules/events/domain/event-changes";

/**
 * Which calendar part a message carries (§174, §NNN, amending both): today's published file, an
 * invitation the runner's calendar answers, its cancellation, or nothing.
 *
 * Without «Răspunsurile din calendar merg la» (`rsvpTo` null, the default) it is exactly what it
 * was: the confirmation and the reminder carry the event's `.ics` (`METHOD:PUBLISH`, §174), and no
 * other message carries one. With an address:
 *
 * - the confirmation and the reminder carry the invitation (`REQUEST`) instead of the file;
 * - the group run's signed declaration carries it too (`GROUP_RUN_DECLARATION_SIGNED`; the owner
 *   chose the declaration's email over a form of its own) — to the signer;
 * - «Detalii actualizate» carries the updated invitation when it is about the time, the place or a
 *   date on again (`changesTheCalendar`), never about the programme or a note alone;
 * - the cancellation carries the invitation's cancellation (`CANCEL`).
 *
 * Only to somebody who holds a place (`confirmed`): an update or a cancellation also reaches the
 * waiting list and the pending declarations (§331), and an invitation to them would ask «Vii?» of
 * a person who has no place to come to. A confirmation or a reminder rendered for a registration no
 * longer confirmed keeps today's file. Never on a club copy, which attaches nothing (§320), and
 * never on an archive copy, which is the club's own.
 */
export type CalendarPart = "file" | "REQUEST" | "CANCEL";

export function calendarPartFor(input: {
  messageType: EmailMessageType;
  clubCopy: boolean;
  /** The club's address for the answers, or null: off. */
  rsvpTo: string | null;
  /** The person holds a place now — a confirmed registration, a family's confirmed people, a signer. */
  confirmed: boolean;
  /** «Detalii actualizate»'s kinds, read from the row. */
  changes?: readonly EventChangeKind[];
}): CalendarPart | null {
  if (input.clubCopy) return null;
  const invites = input.rsvpTo !== null && input.confirmed;
  switch (input.messageType) {
    case "REGISTRATION_CONFIRMED":
    case "EVENT_REMINDER":
      return invites ? "REQUEST" : "file";
    case "GROUP_RUN_DECLARATION_SIGNED":
      return invites ? "REQUEST" : null;
    case "EVENT_UPDATE_NOTICE":
      return invites && changesTheCalendar(input.changes ?? []) ? "REQUEST" : null;
    case "EVENT_CANCELLED":
      return invites ? "CANCEL" : null;
    default:
      return null;
  }
}
