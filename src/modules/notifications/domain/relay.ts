import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * A visitor's message carried by the outbox (§NNN, amending §149, §676, §772 and §622).
 *
 * «Scrie-ne» and «Spune-ne ceva» used to leave the moment they were posted, straight to Gmail or Mailgun,
 * and kept nothing: a refusal was a sentence on the page and a transport that failed lost the message. They
 * are outbox rows now — the same table, the same retries, the same page in the backoffice — with three
 * differences from the twenty-seven notification types, which is why they have their own worker
 * (`relay.ts`) and the main claim leaves them alone:
 *
 * 1. **The words are the visitor's**, written for no template: they travel in `payload_json` and are
 *    **deleted when the message is delivered**, and after the final failure's notice to the Administrators.
 * 2. **The road is the row's own** (`road`: the club's choice for the form), and a road the service has
 *    failed on twice gives way to the other (`road-failover.ts`).
 * 3. **No participant, no registration, no token, no club copy, no deadline.**
 */
export const RELAY_MESSAGE_TYPES = ["CONTACT_MESSAGE", "FEEDBACK_MESSAGE", "RELAY_NOTICE"] as const satisfies readonly EmailMessageType[];

export type RelayMessageType = (typeof RELAY_MESSAGE_TYPES)[number];

export function isRelayMessage(messageType: EmailMessageType): messageType is RelayMessageType {
  return (RELAY_MESSAGE_TYPES as readonly EmailMessageType[]).includes(messageType);
}

/** The state of a relay row's words: kept while it waits to leave, gone once it has left or been given up on. */
export type RelayBodyState = "kept" | "deleted";

/**
 * How long a message may wait to be delivered before it is given up on (§NNN): twenty-four hours. A transient
 * refusal is never the end of an ordinary email (§622) — but this is somebody's words kept in a table, and
 * the notice promises «minutes, never after». Past the day the Administrators are told, the words are
 * deleted, and the row stays as the record that a message was lost.
 */
export const RELAY_GIVE_UP_MS = 24 * 60 * 60_000;

/** What a relay row keeps of its words after they are deleted: a marker, and nothing of the message. */
export const DELETED_RELAY_PAYLOAD = { deleted: true } as const;
