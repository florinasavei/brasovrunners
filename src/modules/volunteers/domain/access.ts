import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Cine se poate oferi» (§NNN, amending §754 and §768; the owner, 2026-10-19: «invite only volunteer … Brașov Runners only
 * volunteers»): who may open the volunteers' form of one event — pure rules, so they are tested without a request. The database
 * holds the choice (`events.volunteers_access`, the closed set below) and the invitations (`event_volunteer_invitations`); the
 * session is read in `events/members-only.ts`, the link in `volunteers/invitations.ts`.
 *
 * **Three doors and one rule.** Whatever the choice, the form is shown only where `volunteerOfferClosedFor` says the offer is open
 * (a published, public event still ahead, with a role that needs people, and the notice and the agreement in force describing
 * volunteers): nothing here opens what that rule keeps shut. This only narrows who walks through it.
 *
 * - `ANYONE` — the page's own form, as it always was.
 * - `MEMBERS` — a signed-in member of the club (the members' zone's account: `MEMBER` or any staff role, §524, §552). Anybody
 *   else is told what the page is for and sent to the members' sign-in; never a form.
 * - `INVITED` — only a person holding the personal link of an invitation the club emailed. Without one the volunteers' page
 *   answers as closed (404), as a draft's page does.
 *
 * **A live invitation is a door in every choice.** The club wrote to that person; narrowing the choice afterwards (`ANYONE` →
 * `INVITED`) must not lock out somebody it had already invited, and widening it (`INVITED` → `ANYONE`) leaves the links working
 * until used. An invitation that is spent, withdrawn or past its date says so in a sentence instead.
 */
export const VOLUNTEERS_ACCESS = ["ANYONE", "MEMBERS", "INVITED"] as const;
export type VolunteersAccess = (typeof VOLUNTEERS_ACCESS)[number];

export const DEFAULT_VOLUNTEERS_ACCESS: VolunteersAccess = "ANYONE";

/** A posted or stored value as a choice, or null for anything else (a forged post is refused by name, never guessed). */
export function readVolunteersAccess(value: unknown): VolunteersAccess | null {
  return typeof value === "string" && (VOLUNTEERS_ACCESS as readonly string[]).includes(value) ? (value as VolunteersAccess) : null;
}

/** One press invites at most this many addresses: a longer list is a second press (the registrations' invitation's own bound, §647). */
export const VOLUNTEER_INVITATION_BATCH_MAX = 50;
/** The club's line in the email, at most this many characters (the table's CHECK). */
export const VOLUNTEER_INVITATION_MESSAGE_MAX = 500;
/** An event whose date is still to be announced has no end to expire on: its invitations are kept this long, and the event's own state closes them sooner. */
export const VOLUNTEER_INVITATION_UNDATED_DAYS = 365;

/** The refusals a send or a row press can meet (`Admin.volunteers.invite.errors.*`): markers, never a value. */
export const VOLUNTEER_INVITATION_REFUSALS = [
  "VINVITE_NOBODY",
  "VINVITE_TOO_MANY",
  "VINVITE_BAD_ADDRESS",
  "VINVITE_MESSAGE_LONG",
  "VINVITE_MESSAGE_ONE_LANGUAGE",
  "VINVITE_NOT_INVITED_ONLY",
  "VINVITE_EVENT_CLOSED",
  "VINVITE_NOT_OPEN",
  "VINVITE_NOT_FOUND",
] as const;
export type VolunteerInvitationRefusalCode = (typeof VOLUNTEER_INVITATION_REFUSALS)[number];

/**
 * A send or a press refused (the registrations' `InvitationRefusal`, §647): nothing of the batch is written — the whole send is one
 * transaction — and `unread` names the lines that could not be read, in the response and never in a URL (§14.5).
 */
export class VolunteerInvitationRefusal extends DomainError {
  readonly refusal: VolunteerInvitationRefusalCode;
  readonly unread: readonly string[];

  constructor(refusal: VolunteerInvitationRefusalCode, unread: readonly string[] = []) {
    super("VALIDATION_ERROR", `volunteer invitation refused: ${refusal}`, [refusal]);
    this.name = "VolunteerInvitationRefusal";
    this.refusal = refusal;
    this.unread = unread;
  }
}

/** The addresses of the send's box, one per line (commas and semicolons are read as line ends too), each by its identity. */
export type InvitationAddress = { deliveryEmail: string; canonicalEmail: string; canonicalizationVersion: number };

/**
 * «Adrese (una pe rând)»: every address that can be read, once by its identity (`canonicalizeEmail`, §10.4 — two spellings of one
 * inbox are one invitation), in the order typed; and the pieces that could not be read, as typed, so the refusal can name them.
 * Blank lines are nothing. The same person twice is not a refusal: they are asked once.
 */
export function parseInvitationAddresses(text: string): { addresses: InvitationAddress[]; unread: string[] } {
  const addresses: InvitationAddress[] = [];
  const unread: string[] = [];
  const seen = new Set<string>();
  for (const piece of text.split(/[\s,;]+/)) {
    const typed = piece.trim();
    if (typed === "") continue;
    try {
      const identity = canonicalizeEmail(typed);
      if (seen.has(identity.canonicalEmail)) continue;
      seen.add(identity.canonicalEmail);
      addresses.push({ deliveryEmail: identity.deliveryEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion });
    } catch {
      unread.push(typed.length > 80 ? `${typed.slice(0, 79)}…` : typed);
    }
  }
  return { addresses, unread };
}

/** Where an invitation stands (`event_volunteer_invitations`): two stamps and the event's own state, never a status column. */
export type VolunteerInvitationStanding = "open" | "used" | "withdrawn" | "expired";

/**
 * Where an invitation stands, asking the event as it is now (`volunteerEventAhead`) and not the deadline stored at the send: a race
 * moved to a later day keeps its links alive, and one called off or over closes them, whatever `expires_at` recorded (§NNN). A spent
 * link says so even after the event; a withdrawn one says so before it is called expired.
 */
export function invitationStandingOf(invitation: { usedAt: Date | null; withdrawnAt: Date | null }, eventAhead: boolean): VolunteerInvitationStanding {
  if (invitation.usedAt) return "used";
  if (invitation.withdrawnAt) return "withdrawn";
  return eventAhead ? "open" : "expired";
}

/**
 * The deadline recorded at the send: the event's end (its start with no end), or a year from the send for a date still to be announced.
 * A record, not the rule (`invitationStandingOf` asks the event).
 * Never earlier than the send itself: an event that is over is refused before this is asked (`VINVITE_EVENT_CLOSED`).
 */
export function invitationExpiry(event: { startsAt: Date | null; endsAt: Date | null }, now: Date): Date {
  const over = event.endsAt ?? event.startsAt;
  return over ?? new Date(now.getTime() + VOLUNTEER_INVITATION_UNDATED_DAYS * 24 * 60 * 60_000);
}

/**
 * What a link read (or none) came to, for the page: `null` is no link at all; the rest is the standing of the invitation it names,
 * or `invalid` for a link that names none (unknown, malformed, or for another event) — one generic answer (§13.2).
 */
export type InviteReading = null | { standing: VolunteerInvitationStanding | "invalid" };

/**
 * The door the volunteers' page opens for this visitor, given the event's choice and what the visitor holds. `member` is whether a
 * signed-in member (or a colleague) reads the page; `invite` what the address's `?invite=` came to.
 *
 * - `invite` — a live invitation: the form, with the invited address locked.
 * - `inviteRefused` — `INVITED` and a link that has been spent, withdrawn or has run out: a sentence, with its reason, and no form.
 * - `open` — `ANYONE`: the form.
 * - `member` — `MEMBERS` and a member: the form, prefilled from the account.
 * - `signIn` — `MEMBERS` and a stranger: one sentence and the way into the members' zone.
 * - `closed` — `INVITED` and no link, or a link that names no invitation: the page answers 404.
 *
 * **A dead link does not shut a door the choice opens.** Under `ANYONE`, and under `MEMBERS` for a member, a spent, withdrawn or
 * run-out link leaves the ordinary door and says which in a sentence above it (`refused`); under `MEMBERS` for a stranger it leaves
 * the sign-in with the sentence. A link that names nothing (`invalid`) says nothing there — there is nothing to tell — and under
 * `INVITED` it is a 404, as no link is: the page does not confirm that an address is wrong rather than absent.
 */
export type InviteRefusal = "used" | "withdrawn" | "expired";

export type VolunteerDoor =
  | { kind: "open"; refused?: InviteRefusal }
  | { kind: "member"; refused?: InviteRefusal }
  | { kind: "signIn"; refused?: InviteRefusal }
  | { kind: "invite" }
  | { kind: "inviteRefused"; reason: InviteRefusal }
  | { kind: "closed" };

export function volunteerDoorFor(input: { access: VolunteersAccess; member: boolean; invite: InviteReading }): VolunteerDoor {
  const standing = input.invite?.standing ?? null;
  if (standing === "open") return { kind: "invite" };
  const refused: InviteRefusal | null = standing === null || standing === "invalid" ? null : standing;
  if (input.access === "INVITED") return refused ? { kind: "inviteRefused", reason: refused } : { kind: "closed" };
  const ordinary: "open" | "member" | "signIn" = input.access === "ANYONE" ? "open" : input.member ? "member" : "signIn";
  return refused ? { kind: ordinary, refused } : { kind: ordinary };
}

/**
 * Whether the server accepts a sign-up arriving with these credentials (the action's gate, asked again by the service — a hidden form
 * is not a permission, BR-REQ-060-01). `invite` is a live invitation for this event (the service has read it); `member` is the
 * account the request carries, or null.
 */
export function mayVolunteerWith(input: { access: VolunteersAccess; member: boolean; invite: boolean }): boolean {
  if (input.invite) return true;
  if (input.access === "ANYONE") return true;
  return input.access === "MEMBERS" && input.member;
}
