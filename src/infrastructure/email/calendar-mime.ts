import MailComposer from "nodemailer/lib/mail-composer";
import type { EmailCalendar, OutgoingEmail } from "./adapter";

/**
 * The calendar invitation's MIME, the same on both roads (§672).
 *
 * A calendar app offers «Da / Nu / Poate» only for a part typed `text/calendar; method=REQUEST`
 * (Gmail, Outlook and Apple read the `method` parameter, not only the file's `METHOD:` line).
 * Nodemailer's `icalEvent` writes exactly the shape Google Calendar's own invitations have: the
 * file as a `text/calendar; charset=utf-8; method=…` alternative beside the text and the HTML, and
 * again as an `application/ics` attachment named `invite.ics`, for the clients that read only
 * attachments. The Gmail road hands it to `sendMail`; the Mailgun road composes the same message
 * here and posts it whole to `messages.mime`, because Mailgun's form API (`text`, `html`,
 * `attachment`, `inline`) has no field for an alternative part, and its users report that an
 * attached `.ics` leaves without the method parameter Outlook needs (Gmail reads the file's own
 * `METHOD:` and copes; Outlook does not). One rendering (`render.ts`), one composer, two roads.
 */
export function icalEventOf(calendar: EmailCalendar): { method: string; content: string; filename: string } {
  return { method: calendar.method, content: calendar.ics, filename: "invite.ics" };
}

/**
 * The whole message as RFC 5322, for Mailgun's `messages.mime` (§672): the headers Mailgun's form
 * would have written — From, To, Cc, Reply-To, Subject — the text, the HTML, the invitation and any
 * other attachment (the signed declaration beside a confirmation, §174). A Bcc is no header, as on
 * every road; it is among `recipients`, the envelope Mailgun's `to` field must carry in full.
 */
export async function composeMime(
  message: OutgoingEmail,
  headers: { from: string; replyTo?: string },
): Promise<{ mime: Buffer; recipients: string[] }> {
  const node = new MailComposer({
    from: headers.from,
    to: message.to,
    ...(message.cc && message.cc.length > 0 ? { cc: [...message.cc] } : {}),
    ...(message.bcc && message.bcc.length > 0 ? { bcc: [...message.bcc] } : {}),
    ...(headers.replyTo ? { replyTo: headers.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.calendar ? { icalEvent: icalEventOf(message.calendar) } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map((attachment) => ({ filename: attachment.filename, contentType: attachment.contentType, content: attachment.data })) }
      : {}),
    // Nothing is read from a path or an address: every part is in memory, rendered at send time.
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile();
  return { mime: await node.build(), recipients: node.getEnvelope().to };
}
