import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * The message types nothing in the platform queues any more (`DECISIONS.md` §331), checked
 * against every `enqueueEmail` call and held there by a test that reads the source:
 *
 * - `WAITLIST_OFFER_EXPIRED` — an offer's lapse is silent (`AGENTS.md` §10.5: the offer expires
 *   and nothing is sent); the person is simply no longer offered the place.
 * - `REGISTRATION_MANAGE_LINK` — the confirmation carries the manage link, and "send it again"
 *   re-sends the confirmation itself, QR and all (§79).
 * - `DECLARATION_SIGNED` — the confirmation carries the signed declaration since §126.
 *
 * They stay in the enum because a migration never removes a value (expand only, §7.6) and a row
 * sent long ago still renders through them; `/admin/emails` lists them last, marked as not sent,
 * so the club reading that page learns exactly what a participant receives.
 */
export const NEVER_QUEUED_MESSAGE_TYPES: ReadonlySet<EmailMessageType> = new Set<EmailMessageType>([
  "WAITLIST_OFFER_EXPIRED",
  "REGISTRATION_MANAGE_LINK",
  "DECLARATION_SIGNED",
]);
