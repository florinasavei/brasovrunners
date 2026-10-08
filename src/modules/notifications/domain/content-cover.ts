import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * What a participant's message carries of another (§NNN): a message of the type on the left, sent or
 * delivered, gives the person what an earlier refused message of each type on the right was to give
 * them, so it answers that refusal as well as its own. Read from what `render.ts` and `templates.ts` put
 * in each message, not from the types' names:
 *
 * - `REGISTRATION_CONFIRMED` — the confirmation carries the desk code with its QR and the race number
 *   (what `BIB_ASSIGNED` carries) and the signed declaration as a PDF (what `DECLARATION_SIGNED` carried,
 *   §126). «Retrimite QR» sends it, so it is the press that clears all three.
 * - `EVENT_REMINDER` — the reminder carries the desk code with its QR and the race number too.
 * - The event's details as they stand when it leaves (`EVENT_FACTS_MESSAGES` in `templates.ts`, §392: the
 *   date, both named times, the place, the programme, read at send time) are carried by the confirmation,
 *   the reminder and the declaration request (`COMPLETE_DECLARATION`, the participation confirmation of
 *   §104): each gives the person what a refused «Detalii actualizate» (`EVENT_UPDATE_NOTICE`, §331) was to
 *   tell them. A later «Detalii actualizate» answers an earlier one too (a type always covers itself), and
 *   that is accepted knowingly (§NNN), not because it carries the earlier one's details: it carries the
 *   one-line facts and the band for its own changes only (`noticeParts` in `templates.ts`), so a notice
 *   about the place answers a refused one about the programme. What it does carry is what the refused one
 *   asked of the person — the details were updated, look at the event's page, which shows them all. The
 *   verification email carries the block too, but no update notice goes to a registration that still
 *   waits on it (`EVENT_NOTICE_STATUSES`, §331), so it has nothing of one to answer. The race number's
 *   email and «Mesaj de la organizatori» carry one line only — the date, the event's start and the place
 *   — never the race's own start or the programme, so they answer no update notice.
 *
 * Every other type covers only itself: a delivered «Mesaj de la organizatori» does not give the runner
 * the QR a refused confirmation carried, and a reminder does not carry the signed declaration. Nothing
 * here says what the person must be told by phone instead (`domain/email-state.ts`, `callInstead`): a
 * covering message that leaves anyway answers the refusal all the same.
 */
export const CONTENT_COVER = {
  REGISTRATION_CONFIRMED: ["BIB_ASSIGNED", "DECLARATION_SIGNED", "EVENT_UPDATE_NOTICE"],
  EVENT_REMINDER: ["BIB_ASSIGNED", "EVENT_UPDATE_NOTICE"],
  COMPLETE_DECLARATION: ["EVENT_UPDATE_NOTICE"],
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
