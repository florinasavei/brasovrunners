import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Registration } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { Locale } from "@/i18n/routing";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import type { TokenRejectionReason } from "@/modules/action-tokens/domain/token-state";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { invitationState } from "./domain/invitations";
import { findInvitationById } from "./invitation-repository";
import { publicFormEvent } from "./public-form-event";
import { lockEventForCapacity } from "./repository";
import { seatInvitedRegistration, submitRegistration } from "./service";

/**
 * An invitation's link (§NNN; `/registrations/invitation/[token]`): the page's read and the form's press.
 *
 * - `readInvitationLink` is the GET: the token read — charged one attempt (§39), never spent — and the
 *   invitation it is scoped to, in one read-only transaction (GET never mutates, §12.8). It says what
 *   the page shows: the form, prefilled with the invited name and the address, locked; or why not —
 *   accepted already, withdrawn, past its deadline, the event called off, replaced by a newer email (§619), or a link that
 *   does not work.
 * - `acceptInvitation` is the press: under the event lock, the invitation asked again — open and before
 *   its deadline, the event scheduled and not started — and only then the token spent (single use; a
 *   refusal returns and commits, so nothing is spent ahead of one); then the registration created through the one door
 *   (`submitRegistration`, the invitation's origin) and seated in the invitation's place
 *   (`seatInvitedRegistration`): the address proved by the link, «Sunt membru» set for a member the club
 *   picked, the place moved from the invitation to
 *   the declaration hold with no gap, the declaration's email queued. One transaction: a refusal of the
 *   form (a field, the terms changed, this runner on the address already) takes the token's spend back
 *   with everything else, and the same link still works.
 *
 * The address is never read from the form or a query string: it is the invitation's.
 */

export type InvitationLink =
  | {
      kind: "open";
      invitationId: string;
      name: string;
      email: string;
      /** A member picked from the members' zone (§524): the form presets «Sunt membru». */
      member: boolean;
      eventId: string;
      slug: string;
      eventTitle: string;
      expiresAt: Date;
    }
  /** `cancelled`: the event was called off since the send — not the deadline, which may well be ahead still. */
  | { kind: "accepted" | "withdrawn" | "expired" | "cancelled"; eventTitle: string | null; slug: string | null }
  /** A newer email carries the working link (§619). */
  | { kind: "replaced" }
  /** Spent: the form was sent with it already. */
  | { kind: "used" }
  /** Unknown, malformed, or refused by the attempt budget: the one generic answer (§13.2). */
  | { kind: "invalid" };

export async function readInvitationLink<T extends Record<string, unknown>>(db: Database<T>, secret: string, locale: Locale, now: Date): Promise<InvitationLink> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { kind: "invalid" };
  const context = await readActionTokenContext(db, { secret, purpose: "ACCEPT_INVITATION", now });
  if (!context.ok) return { kind: rejectionKind(context.reason) };
  const invitationId = context.token.invitationId;
  if (!invitationId) return { kind: "invalid" };
  return inReadOnlyTransaction(db, async (tx) => {
    const invitation = await findInvitationById(tx, invitationId);
    if (!invitation || invitation.participantId !== context.token.participantId) return { kind: "invalid" as const };
    const details = await findEventNotificationDetails(tx, invitation.eventId, locale);
    const [event] = await tx.select({ eventStatus: events.eventStatus, startsAt: events.startsAt }).from(events).where(eq(events.id, invitation.eventId)).limit(1);
    const state = invitationState(invitation, now);
    const title = details?.title ?? null;
    const slug = details?.slug ?? null;
    if (state !== "sent") return { kind: state, eventTitle: title, slug };
    /*
      A race called off since the send says so (the invitations review of 2026-10-03): cancelling an event
      leaves `event_invitations` as it was, so this page is the only thing that tells the invitee, and
      «the deadline has passed» would be a false reason. A race started since says the deadline passed.
    */
    if (event && event.eventStatus !== "SCHEDULED") return { kind: "cancelled" as const, eventTitle: title, slug };
    if (!event || event.startsAt.getTime() <= now.getTime() || !slug || !title) {
      return { kind: "expired" as const, eventTitle: title, slug };
    }
    return {
      kind: "open" as const,
      invitationId: invitation.id,
      name: invitation.name,
      email: invitation.email,
      member: invitation.memberStaffUserId !== null,
      eventId: invitation.eventId,
      slug,
      eventTitle: title,
      expiresAt: invitation.expiresAt,
    };
  });
}

const REFUSED_KINDS = ["accepted", "withdrawn", "expired", "cancelled", "replaced", "used", "invalid"] as const;
export type RefusedKind = (typeof REFUSED_KINDS)[number];

export type InvitationAcceptance = { ok: true; registration: Registration } | { ok: false; kind: RefusedKind };

/** A `refused=` marker on the link's page: one of the press's answers, or not one at all. */
export function isRefusedKind(value: unknown): value is RefusedKind {
  return typeof value === "string" && (REFUSED_KINDS as readonly string[]).includes(value);
}

/** What a refused token says on the page: a newer email, the form sent already, or the generic answer. */
function rejectionKind(reason: TokenRejectionReason): "replaced" | "used" | "invalid" {
  return reason === "SUPERSEDED" ? "replaced" : reason === "ALREADY_USED" ? "used" : "invalid";
}

export async function acceptInvitation<T extends Record<string, unknown>>(db: Database<T>, secret: string, rawInput: Record<string, unknown>, now: Date): Promise<InvitationAcceptance> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { ok: false, kind: "invalid" };
  // The club's deadlines (§377), before the transaction: the declaration hold's length comes from here.
  const settings = await currentDeadlines(db);
  /*
    The token's scope first, read before the transaction (in a read-only one of its own, §12.8), so the
    event row can be locked — the serialization point every capacity decision takes (§10.6) — before the
    token is spent and the invitation asked: a withdrawal or the sweep's expiry, which take the same
    lock, are either wholly before this press or wholly after it.
  */
  const peek = await readActionTokenContext(db, { secret, purpose: "ACCEPT_INVITATION", now });
  if (!peek.ok) return { ok: false, kind: rejectionKind(peek.reason) };
  const scopedId = peek.token.invitationId;
  if (!scopedId) return { ok: false, kind: "invalid" };
  return db.transaction(async (tx) => {
    const scoped = await findInvitationById(tx, scopedId);
    if (!scoped) return { ok: false as const, kind: "invalid" as const };
    const lockedEvent = await lockEventForCapacity(tx, scoped.eventId);
    if (!lockedEvent) return { ok: false as const, kind: "invalid" as const };

    /*
      Every refusal before the spend, under the lock (the invitations review of 2026-10-03): a refusal
      returns `{ ok: false }`, which commits, so a token spent ahead of it would be gone with nobody
      registered — and the page's next read would say «already used». The invitation asked again now
      that the lock is held — open and before its deadline, still the token's person — and the event
      still scheduled and not started; only then the token is spent.
    */
    const invitation = await findInvitationById(tx, scoped.id);
    if (!invitation || invitation.participantId !== peek.token.participantId) return { ok: false as const, kind: "invalid" as const };
    const state = invitationState(invitation, now);
    if (state !== "sent") return { ok: false as const, kind: state };
    // Called off: said as such, never as a passed deadline; started: the deadline (capped by the start) has passed.
    if (lockedEvent.eventStatus !== "SCHEDULED") return { ok: false as const, kind: "cancelled" as const };
    if (lockedEvent.startsAt.getTime() <= now.getTime()) return { ok: false as const, kind: "expired" as const };

    // Single use (BR-REQ-036-02): one UPDATE, so of two presses at once only one spends it.
    const consumed = await consumeActionToken(tx, { secret, purpose: "ACCEPT_INVITATION", now });
    // Not spent (used, superseded by a resend since the peek): nothing was written, the refusal may commit.
    if (!consumed.ok) return { ok: false as const, kind: rejectionKind(consumed.reason) };
    // The row spent is the one peeked; were it not, throwing takes the spend back with the transaction.
    if (consumed.token.invitationId !== invitation.id || consumed.token.participantId !== invitation.participantId) {
      throw new Error("the invitation token changed between its read and its spend");
    }

    const event = publicFormEvent(lockedEvent, lockedEvent.publishedAt);
    const created = await submitRegistration(
      tx,
      event,
      /*
        The address is the invitation's, never one posted (§12.8): typed twice nowhere, locked on the form.
        And a member picked from the members' zone (§524) is registered as a club member whatever is
        posted: the club named the account, so an unticked box or a draft without JavaScript cannot leave
        `club_member_declared` unset. Anybody typed answers «Sunt membru» themselves.
      */
      { ...rawInput, email: invitation.email, emailConfirm: invitation.email, ...(invitation.memberStaffUserId !== null ? { clubMemberDeclared: true } : {}) },
      now,
      "REAL",
      { source: "PUBLIC", createdByStaffUserId: null, invitation: { participantId: invitation.participantId } },
    );
    if (!created.registrationId) throw new DomainError("CONFLICT", "the invitation created no registration");
    const registration = await seatInvitedRegistration(tx, event, created.registrationId, invitation, now, settings);
    return { ok: true as const, registration };
  });
}
