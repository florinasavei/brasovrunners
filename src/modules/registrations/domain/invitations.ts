import { DomainError } from "@/shared/errors/domain-error";

/**
 * Invitations by email (§647; the owner, 2026-10-02: «vreau să trimit „invitații speciale” pe email
 * pentru membrii BVR, un fel de adaugă manual» — «Dar vreau și pentru non-membrii»), as pure rules: the
 * deadline, how many supplementary places a send needs, the state a row is in, and the backoffice's
 * typed list. No database here; `service.ts` decides under the event lock with these.
 */

/** «Zile până expiră»: seven by default, as the owner was told. */
export const INVITATION_DAYS_DEFAULT = 7;
/** The longest an invitation may keep a place; the start caps it anyway. */
export const INVITATION_DAYS_MAX = 60;
/** One press invites at most this many people: a list longer than this is a second press. */
export const INVITATION_BATCH_MAX = 50;

/** The refusals a send can meet (`Admin.invitations.errors.*`): markers, never a value — the name rides beside. */
export const INVITATION_REFUSALS = [
  "INVITATION_ALREADY_REGISTERED",
  "INVITATION_ALREADY_INVITED",
  "INVITATION_BAD_ADDRESS",
  "INVITATION_DUPLICATE",
  "INVITATION_NO_NAME",
  "INVITATION_NOBODY",
  "INVITATION_TOO_MANY",
  "INVITATION_EVENT_CLOSED",
  "INVITATION_NOT_OPEN",
  "INVITATION_BAD_DAYS",
  "INVITATION_UNREAD_LINE",
] as const;
export type InvitationRefusalCode = (typeof INVITATION_REFUSALS)[number];

/**
 * A send or a press refused (§647), naming the person it is about when there is one: the Administrator
 * typed the list, so the refusal may say whose line it is — in the dialog that sent it, never in a URL.
 * Nothing of the batch is written: the whole send is one transaction.
 */
export class InvitationRefusal extends DomainError {
  readonly refusal: InvitationRefusalCode;
  readonly person: string | null;

  constructor(refusal: InvitationRefusalCode, person: string | null = null) {
    super("VALIDATION_ERROR", `invitation refused: ${refusal}`, [refusal]);
    this.name = "InvitationRefusal";
    this.refusal = refusal;
    this.person = person;
  }
}

/** «Zile până expiră» as typed: a whole number from 1 to `INVITATION_DAYS_MAX`, or the send is refused (`INVITATION_BAD_DAYS`). */
export function validInvitationDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= INVITATION_DAYS_MAX;
}

/**
 * Until when an invitation keeps its place: the days the Administrator chose from now, capped by the
 * start — never a place kept past the moment the race begins. Not by the registration close (the
 * invitations review of 2026-10-02): the close is the public door's, and the invitations the club
 * sends late — organizers, pacemakers, volunteers — mostly go after it, as «Trimite-i oferta» does
 * (§642). Null when that instant is not ahead: the send is refused (`INVITATION_EVENT_CLOSED`).
 */
export function invitationDeadline(input: { now: Date; days: number; startsAt: Date }): Date | null {
  const days = Math.min(Math.max(Math.trunc(input.days), 1), INVITATION_DAYS_MAX);
  const at = Math.min(input.now.getTime() + days * 24 * 60 * 60_000, input.startsAt.getTime());
  return at > input.now.getTime() ? new Date(at) : null;
}

/**
 * The places free for invitations (§647): the allocator's count against the capacity, **less everyone
 * eligible who waits** (`countEligibleWaitlisted`: `WAITLISTED`, no offer yet) — whatever the event's
 * «Oferte automate» and whether the registration has closed. A free place somebody waits for is never
 * an invitation's: with automatic offers on and before the close the send's first step offers it to the
 * line (`fillAvailableSpots`), and with them off («Nu», §615) or after the close nothing offers it, yet
 * the place is still the waiting row's to be given — a staff-made allocation never goes ahead of anyone
 * waiting (AGENTS.md §15.11), and a newcomer queues while anybody waits (§615). Never below zero.
 */
export function invitationFreePlaces(input: { capacity: number; occupied: number; waiting: number }): number {
  return Math.max(input.capacity - input.occupied - Math.max(input.waiting, 0), 0);
}

/**
 * How many supplementary places a send needs (§642, one per invitation that needs a counted place and
 * finds none free for it — `invitationFreePlaces`, the waiting subtracted): the people who need one
 * beyond those places. Zero on an uncapped event, and zero for invitations «În afara locurilor», which
 * need none. The dialog's forecast and the server's check under the lock are this one function, so the
 * capacity the question names is the one the server accepts — «capacitatea devine {capacity + raises}».
 */
export function invitationRaises(input: { capacity: number | null; occupied: number; waiting: number; needed: number }): number {
  if (input.capacity === null || input.needed <= 0) return 0;
  return Math.max(input.needed - invitationFreePlaces({ capacity: input.capacity, occupied: input.occupied, waiting: input.waiting }), 0);
}

/**
 * The places free for invitations, read before the press (§647): `invitationFreePlaces` on the page's
 * counts — the waiting always subtracted, as the server subtracts them under the lock whatever the
 * auto-offer setting or the close. (With offers on and before the close the send's first step offers
 * the line the free places it is owed; the count comes out the same: each place offered is one fewer
 * free and one fewer waiting.) Null on an uncapped event. A forecast for the dialog; the server counts
 * again under the lock, and a different number refuses the send rather than raising unasked.
 */
export function invitationForecastFree(input: { capacity: number | null; occupied: number; waiting: number }): number | null {
  if (input.capacity === null) return null;
  return invitationFreePlaces({ capacity: input.capacity, occupied: input.occupied, waiting: input.waiting });
}

/** Whether the press confirmed exactly the places the send needs: the question named `capacity + raises`. */
export function confirmsInvitationRaises(capacity: number, raises: number, confirmedTo: number | null): boolean {
  return raises === 0 || (confirmedTo !== null && confirmedTo === capacity + raises);
}

export type InvitationState = "sent" | "accepted" | "expired" | "withdrawn";

/** What the backoffice and the link's page say an invitation is now: the stamps, then the deadline. */
export function invitationState(row: { acceptedAt: Date | null; withdrawnAt: Date | null; expiredAt: Date | null; expiresAt: Date }, now: Date): InvitationState {
  if (row.acceptedAt) return "accepted";
  if (row.withdrawnAt) return "withdrawn";
  if (row.expiredAt || row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "sent";
}

/** One person of the typed list: a name and an address as typed, and the line it came from. */
export type TypedInvitee = { name: string; email: string; line: number };

/**
 * «Nume <adresă>, una pe rând» read into people (§647). A line is the name and the address — the
 * address in angle brackets, or the last word with an @ in it — in any order a person would type it:
 * «Ana Pop <ana@example.invalid>», «Ana Pop ana@example.invalid», «ana@example.invalid Ana Pop», «Ana Pop, ana@example.invalid».
 * Blank lines are skipped. A line with no address, or no name, is returned in `unread` (by its number,
 * from 1), for the dialog to say before anything is sent. The address is checked by the canonicalizer
 * at the send, never here.
 */
export function parseInvitationLines(text: string): { people: TypedInvitee[]; unread: number[] } {
  const people: TypedInvitee[] = [];
  const unread: number[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const bracketed = line.match(/<([^<>\s]+@[^<>\s]+)>/);
    let email: string | null = bracketed ? bracketed[1] : null;
    let rest = bracketed ? line.replace(bracketed[0], " ") : line;
    if (!email) {
      const words = rest.split(/[\s,;]+/);
      const found = words.filter((word) => word.includes("@"));
      email = found.length === 1 ? found[0] : null;
      if (email) rest = words.filter((word) => word !== email).join(" ");
    }
    const name = rest.replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
    if (!email || name === "") {
      unread.push(index + 1);
      return;
    }
    people.push({ name, email: email.trim(), line: index + 1 });
  });
  return { people, unread };
}
