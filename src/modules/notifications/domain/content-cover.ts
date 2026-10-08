import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * What a participant's message carries of another (§NNN): a message of the type on the left, sent or
 * delivered, gives the person what an earlier refused message of each type on the right was to give
 * them, so it answers that refusal as well as its own. Read from what `render.ts` puts in each message
 * for a confirmed registration, not from the types' names:
 *
 * - `REGISTRATION_CONFIRMED` — the confirmation carries the desk code with its QR and the race number
 *   (what `BIB_ASSIGNED` carries) and the signed declaration as a PDF (what `DECLARATION_SIGNED` carried,
 *   §126). «Retrimite QR» sends it, so it is the press that clears all three.
 * - `EVENT_REMINDER` — the reminder carries the desk code with its QR and the race number too.
 *
 * Every other type covers only itself: a delivered «Mesaj de la organizatori» does not give the runner
 * the QR a refused confirmation carried, and a reminder does not carry the signed declaration.
 */
export const CONTENT_COVER = {
  REGISTRATION_CONFIRMED: ["BIB_ASSIGNED", "DECLARATION_SIGNED"],
  EVENT_REMINDER: ["BIB_ASSIGNED"],
} as const satisfies Partial<Record<EmailMessageType, readonly EmailMessageType[]>>;

const COVERING = Object.keys(CONTENT_COVER) as Array<keyof typeof CONTENT_COVER>;

/** The types a sent or delivered message of this type answers a refusal of: itself, and what it carries. */
export function typesCoveredBy(messageType: EmailMessageType): EmailMessageType[] {
  const carried: readonly EmailMessageType[] = (CONTENT_COVER as Partial<Record<EmailMessageType, readonly EmailMessageType[]>>)[messageType] ?? [];
  return [messageType, ...carried];
}

/** The types whose sent or delivered message answers a refusal of this type: itself, and every type that carries it. */
export function typesCovering(messageType: EmailMessageType): EmailMessageType[] {
  return [messageType, ...COVERING.filter((covering) => (CONTENT_COVER[covering] as readonly EmailMessageType[]).includes(messageType))];
}

/** Every pair beyond a type covering itself, as [the covering type, the covered type]: what migration `0131`'s backfill reads too. */
export const COVER_PAIRS: ReadonlyArray<readonly [EmailMessageType, EmailMessageType]> = COVERING.flatMap((covering) =>
  CONTENT_COVER[covering].map((covered) => [covering, covered] as const),
);
