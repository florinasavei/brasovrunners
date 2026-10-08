import { z } from "zod";

/**
 * «Răspunsurile din calendar merg la» (§672; the owner, 2026-10-08: «On the iCal calendar, can we
 * make it Smarter so that people can respond Going/NotGoing and replying to [the club's Gmail]?»,
 * then «Will this bloat up the app? Can this be a config? In Gmail I can setup a filter I guess»).
 *
 * One address, or nothing. Nothing — the default, and every deployment until the club types one —
 * is the calendar file as it always was (§107, §174): `METHOD:PUBLISH`, «Adaugă în calendar», no
 * organizer and no attendee. With an address the event goes out as an invitation the runner's
 * calendar app answers with «Da / Nu / Poate» (`METHOD:REQUEST`, `ORGANIZER` this address,
 * `ATTENDEE` the runner), and the app sends the answer here. Nothing on the site reads it: the club
 * reads its own mailbox, a `+calendar` address and a filter keeping the answers out of the inbox
 * (`SETUP.md` §38 step 8).
 *
 * Never a default address in code: the repository is public, and an address is the club's to type.
 * Pure: no database, no environment.
 */
export const calendarRsvpToSchema = z
  .object({
    // Trimmed, then empty (off) or one address — the platform's email rule, as the other boxes on «Emailuri».
    to: z.string().trim().max(320).pipe(z.union([z.literal(""), z.email()])).default(""),
  })
  .strict();

export type CalendarRsvpTo = z.infer<typeof calendarRsvpToSchema>;

/** Off: no address, today's calendar file. */
export const DEFAULT_CALENDAR_RSVP_TO: CalendarRsvpTo = { to: "" };

/**
 * This server instance's copy of the address, for the send path: the renderer reads it once per
 * message, and a batch of twenty reminders would otherwise be twenty identical round trips for an
 * address that changes once. Half a minute, wall clock — the email words' window (§247): a save
 * drops it, so the instance that saved sends with the new address at once; another instance within
 * thirty seconds, which costs one message going out as the file or as the invitation of a moment ago.
 * Apart from the database code, so the test helpers can drop it between databases.
 */
const MEMO_MS = 30_000;
let memo: { at: number; to: string | null } | null = null;

export function memoizedCalendarRsvpTo(): { to: string | null } | null {
  return memo && Date.now() - memo.at < MEMO_MS ? { to: memo.to } : null;
}

export function rememberCalendarRsvpTo(to: string | null): void {
  memo = { at: Date.now(), to };
}

/** Dropped on a save, and between tests that reset the database (`tests/helpers/db.ts`). */
export function forgetCachedCalendarRsvpTo(): void {
  memo = null;
}
