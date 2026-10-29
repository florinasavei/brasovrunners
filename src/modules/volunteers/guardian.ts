import { and, eq, isNull, ne } from "drizzle-orm";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { recordAuditEvent } from "@/modules/audit/repository";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { type MergeValues, namesVolunteerGuardian } from "@/modules/legal-documents/domain/merge-fields";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { type SignatureTrace, traceColumns } from "@/modules/legal-documents/domain/signature-trace";
import { findCurrentApprovedDocument, volunteerMinorsOpen } from "@/modules/legal-documents/repository";
import { DEFAULT_TOKEN_HOURS } from "@/modules/notifications/domain/token-lifetime";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  acceptedAtWords,
  agreementBlanks,
  agreementBody,
  type AgreementFacts,
  agreementMergeValues,
  canonicalOrNull,
  volunteerRoles,
} from "./agreement";
import { agreementRolesStamp, isVolunteerMinor, refusedFields, type RoleWords, volunteerGuardianAcceptSchema } from "./domain/volunteer";

/**
 * The parent's or guardian's agreement for a volunteer under eighteen (§768, amending §758; the owner, 2026-10-14:
 * «voluntarii trebuie să aibă cel puțin 14 ani, nu 18» and «fă cu acord ceva»).
 *
 * From fourteen a volunteer is taken only with a parent or guardian who accepts the **same volunteer agreement** in
 * their own name — the text in force carries a minors' clause for it (`{{volunteerGuardian}}`), and the privacy notice
 * names the guardian's data (`{{volunteerMinors}}`); until both are in force in every language nobody under eighteen is
 * taken (`volunteerMinorsOpen`). It is §758's flow again, for a second person, in the two ways the volunteer's own
 * agreement has besides the form:
 *
 * - **from a link** — an email with a single-use link goes to the guardian's address at the minor's sign-up, and again
 *   at an organizer's «Trimite linkul părintelui»; minted when the email leaves (`mintVolunteerGuardianLink`), only its
 *   SHA-256 kept on the row, single use, and the page it opens never writes (AGENTS.md §12.8): reading it is
 *   `readVolunteerGuardianLink`, accepting is the page's POST, `acceptVolunteerGuardianByLink` — the typed name is the
 *   acceptance, the same proof the volunteer's own keeps (the version, the moment, the language, the fingerprint of the
 *   text read with its blanks, the blanks);
 * - **on paper at the desk** — «Acordul părintelui pe hârtie» records that the guardian signed the printed agreement,
 *   naming the staff member who recorded it (`recordPaperVolunteerGuardian`). A staff member never signs for the
 *   guardian (CLAUDE.md: no staff-signed declaration).
 *
 * Until it is recorded the volunteer's card says «Acordul părintelui lipsește» and «Confirmă» is refused
 * (`guardianAllowsConfirm`, `changeVolunteer`).
 */

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayManage(actor: Actor): void {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an event's volunteers`);
  }
}

function assertIds(...ids: readonly string[]): void {
  if (ids.some((id) => !isUuid(id))) throw new DomainError("NOT_FOUND", "the event or the volunteer is not there");
}

/** The guardian's acceptance as the row keeps it, in one shape — the volunteer's own (`AgreementAcceptanceColumns`) with the guardian's names. */
export type GuardianAcceptanceColumns = {
  guardianDocumentId: string;
  guardianAcceptedAt: Date;
  guardianMethod: "LINK" | "PAPER";
  guardianLocale: Locale;
  guardianTextHash: string;
  guardianFacts: AgreementFacts;
  guardianTypedName: string | null;
  /** The guardian's electronic acceptance's trace (§771): the IP address and browser of the press; null for «PAPER». */
  guardianIp: string | null;
  guardianUserAgent: string | null;
  guardianRecordedByStaffUserId: string | null;
  guardianTokenHash: null;
  guardianTokenExpiresAt: null;
};

/**
 * One acceptance by the guardian, as the row keeps it: the version, the moment, the way, the language, the blanks
 * as filled — the guardian's name in `{{volunteerGuardian}}` — and the fingerprint of the text with them (§556), hashed
 * before the row is written, in the caller's transaction. Any live link dies with it.
 */
export async function guardianAcceptance<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    eventId: string;
    volunteerName: string;
    guardianName: string;
    roles: { assigned: readonly (RoleWords & { id: string })[]; chosen: readonly RoleWords[] };
    locale: Locale;
    document: { id: string; title: string; body: unknown };
    method: "LINK" | "PAPER";
    typedName: string | null;
    recordedBy?: string | null;
    /** The IP address and browser of the press (§771), kept for «LINK» and dropped for «PAPER», whatever is passed. */
    trace?: SignatureTrace;
  },
  now: Date,
): Promise<GuardianAcceptanceColumns> {
  const blanks = await agreementBlanks(db, {
    eventId: input.eventId,
    name: input.volunteerName,
    roles: input.roles,
    locale: input.locale,
    body: input.document.body,
    guardianName: input.guardianName,
  });
  const facts: AgreementFacts = { ...blanks.facts, signedAt: acceptedAtWords(now, input.locale, blanks.timezone) };
  const trace = traceColumns(input.trace, input.method !== "PAPER");
  return {
    guardianDocumentId: input.document.id,
    guardianAcceptedAt: now,
    guardianMethod: input.method,
    guardianLocale: input.locale,
    guardianTextHash: signedTextHash({ title: input.document.title, body: agreementBody(input.document.body), values: facts }),
    guardianFacts: facts,
    guardianTypedName: input.typedName,
    guardianIp: trace.ip,
    guardianUserAgent: trace.userAgent,
    guardianRecordedByStaffUserId: input.recordedBy ?? null,
    guardianTokenHash: null,
    guardianTokenExpiresAt: null,
  };
}

// ---------------------------------------------------------------------------------------------
// The link (AGENTS.md §12.8: hashed at rest, single use, GET never mutates)
// ---------------------------------------------------------------------------------------------

/**
 * A fresh link for one volunteer's guardian, minted when its email renders (`notifications/render.ts`), never when it is
 * queued: the secret is in the email alone (§14.5), the row keeps its SHA-256 and its expiry, and a newer link replaces
 * the older one in the same statement. Null for a row whose guardian has accepted since, that was cancelled or deleted,
 * that is no longer under eighteen, or whose guardian address is no longer the one the email goes to
 * (`recipientEmail`, compared through the canonicalizer, §10.4): an organizer corrected it while the email waited, and
 * whoever reads the old mailbox must not accept in the guardian's name. Nothing left to ask there, and the email is withdrawn.
 */
export async function mintVolunteerGuardianLink<T extends Record<string, unknown>>(
  db: Database<T>,
  volunteerId: string,
  recipientEmail: string,
  now: Date,
): Promise<{ secret: string; expiresAt: Date } | null> {
  if (!isUuid(volunteerId)) return null;
  const recipient = canonicalOrNull(recipientEmail);
  if (recipient === null) return null;
  const [current] = await db
    .select({ guardianEmail: eventVolunteers.guardianEmail, age: eventVolunteers.age })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.id, volunteerId), isNull(eventVolunteers.guardianAcceptedAt), ne(eventVolunteers.state, "CANCELLED")))
    .limit(1);
  if (!current?.guardianEmail || !isVolunteerMinor(current.age) || canonicalOrNull(current.guardianEmail) !== recipient) return null;
  const secret = generateTokenSecret();
  const expiresAt = new Date(now.getTime() + DEFAULT_TOKEN_HOURS * 60 * 60_000);
  const [row] = await db
    .update(eventVolunteers)
    .set({ guardianTokenHash: hashTokenSecret(secret), guardianTokenExpiresAt: expiresAt })
    // The address read above, in the statement itself: a correction between the two is not minted for.
    .where(
      and(
        eq(eventVolunteers.id, volunteerId),
        eq(eventVolunteers.guardianEmail, current.guardianEmail),
        isNull(eventVolunteers.guardianAcceptedAt),
        ne(eventVolunteers.state, "CANCELLED"),
      ),
    )
    .returning({ id: eventVolunteers.id });
  return row ? { secret, expiresAt } : null;
}

/** The row a live guardian link opens: unknown, spent, expired, cancelled or no longer a minor all read as none — one answer (§13.2). */
async function liveGuardianRow<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date, lock: boolean) {
  if (!isWellFormedTokenSecret(secret)) return undefined;
  const query = db
    .select({
      id: eventVolunteers.id,
      eventId: eventVolunteers.eventId,
      name: eventVolunteers.name,
      age: eventVolunteers.age,
      locale: eventVolunteers.locale,
      state: eventVolunteers.state,
      email: eventVolunteers.email,
      agreementAcceptedAt: eventVolunteers.agreementAcceptedAt,
      guardianName: eventVolunteers.guardianName,
      guardianAcceptedAt: eventVolunteers.guardianAcceptedAt,
      expiresAt: eventVolunteers.guardianTokenExpiresAt,
    })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.guardianTokenHash, hashTokenSecret(secret)));
  const [row] = lock ? await query.for("update").limit(1) : await query.limit(1);
  if (
    !row ||
    row.guardianAcceptedAt !== null ||
    row.guardianName === null ||
    !isVolunteerMinor(row.age) ||
    row.state === "CANCELLED" ||
    !row.expiresAt ||
    row.expiresAt.getTime() <= now.getTime()
  ) {
    return undefined;
  }
  return { ...row, guardianName: row.guardianName };
}

export type GuardianLinkView =
  /** The link is good: the guardian, the volunteer, the event, and the agreement in force in this language, filled. */
  | {
      status: "open";
      guardianName: string;
      volunteerName: string;
      eventTitle: string;
      document: { id: string; version: number; effectiveAt: Date; title: string; body: unknown };
      /** The blanks as accepting now would fill them, `{{volunteerGuardian}}` included; the moment stays a blank until it happens. */
      values: MergeValues;
    }
  /** No agreement in force in this language: nothing to accept until the club approves one. */
  | { status: "noAgreement" }
  /** Unknown, spent, expired, or the volunteer was cancelled: one answer whatever the reason (§13.2). */
  | { status: "invalid" };

/**
 * What the guardian's page shows — a read, never a write (AGENTS.md §12.8: a mail scanner that opens the link accepts
 * nothing). The agreement is the one in force in the page's language, filled for the volunteer and their roles as
 * accepting would fill it, with the guardian's name in the minors' clause.
 */
export async function readVolunteerGuardianLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
): Promise<GuardianLinkView> {
  const row = await liveGuardianRow(db, secret, now, false);
  if (!row) return { status: "invalid" };
  const document = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, locale, now);
  // A version without the minors' clause is no text for a guardian to accept (the same gate as `volunteerMinorsOpen`): a link
  // minted before the club approved such a version finds nothing to accept, and nothing is recorded against words that never name them.
  if (!document || !namesVolunteerGuardian(document.body)) return { status: "noAgreement" };
  const roles = await volunteerRoles(db, row);
  if (roles.assigned.length === 0 && roles.chosen.length === 0) return { status: "invalid" };
  const blanks = await agreementBlanks(db, {
    eventId: row.eventId,
    name: row.name,
    roles,
    locale,
    body: document.body,
    guardianName: row.guardianName,
  });
  return {
    status: "open",
    guardianName: row.guardianName,
    volunteerName: row.name,
    eventTitle: blanks.facts.event,
    document: { id: document.id, version: document.version, effectiveAt: document.effectiveAt, title: document.title, body: document.body },
    values: agreementMergeValues(blanks.facts),
  };
}

export type GuardianAcceptOutcome = { outcome: "accepted"; volunteerId: string } | { outcome: "invalid" } | { outcome: "noAgreement" };

/**
 * «Îmi dau acordul» on the link's page — the POST, the only write the link leads to. Refuses, as the guardian's own
 * fix, a tick or a typed name not given (`VALIDATION_ERROR` naming `agreement` or `typedName`); answers `invalid` for a
 * link that is unknown, spent, expired, replaced or whose volunteer was cancelled, and `noAgreement` while no version
 * is in force in the page's language. On a good link, in one transaction: the row locked by its hash, the acceptance
 * written (the version in force, the moment, `LINK`, the language, the fingerprint, the blanks, the typed name) and
 * the hash cleared in the same statement that matches it — a second press, a second tab, finds nothing (single use) —
 * the volunteer's copy queued again, now with the guardian's acceptance on the PDF (`VOLUNTEER_AGREEMENT_ACCEPTED`,
 * only once the volunteer accepted their own), and the act audited with no name.
 */
export async function acceptVolunteerGuardianByLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  rawInput: unknown,
  now: Date,
  /** The IP address and browser of the press (§771), read by the action: the guardian's electronic acceptance's trace. */
  trace?: SignatureTrace,
): Promise<GuardianAcceptOutcome> {
  const parsed = volunteerGuardianAcceptSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "the guardian's acceptance is incomplete", refusedFields(parsed.error));
  const input = parsed.data;
  if (!isWellFormedTokenSecret(secret)) return { outcome: "invalid" };
  const hash = hashTokenSecret(secret);

  return db.transaction(async (tx): Promise<GuardianAcceptOutcome> => {
    const row = await liveGuardianRow(tx, secret, now, true);
    if (!row) return { outcome: "invalid" };
    const document = await findCurrentApprovedDocument(tx, VOLUNTEER_AGREEMENT_KEY, input.locale, now);
    if (!document || !namesVolunteerGuardian(document.body)) return { outcome: "noAgreement" };
    const roles = await volunteerRoles(tx, row);
    if (roles.assigned.length === 0 && roles.chosen.length === 0) return { outcome: "invalid" };
    const acceptance = await guardianAcceptance(
      tx,
      {
        eventId: row.eventId,
        volunteerName: row.name,
        guardianName: row.guardianName,
        roles,
        locale: input.locale,
        document,
        method: "LINK",
        typedName: input.typedName,
        trace,
      },
      now,
    );
    const [written] = await tx
      .update(eventVolunteers)
      .set({ ...acceptance, updatedAt: now })
      // The hash in the WHERE: the statement that spends the link is the one that matches it.
      .where(and(eq(eventVolunteers.id, row.id), eq(eventVolunteers.guardianTokenHash, hash), isNull(eventVolunteers.guardianAcceptedAt)))
      .returning({ id: eventVolunteers.id });
    if (!written) return { outcome: "invalid" };
    await queueVolunteerCopy(tx, row, null, now);
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      action: "volunteer.guardian_accepted",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id, version: document.version, method: "LINK" },
      now,
    });
    return { outcome: "accepted", volunteerId: row.id };
  });
}

/**
 * The volunteer's copy of the agreement, queued again once their guardian has accepted (§768): the PDF the send attaches
 * carries both acceptances. Only for a volunteer who accepted their own — nothing to copy before that — and never for a
 * row with no address (§864): nothing is queued for it at all.
 */
async function queueVolunteerCopy<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  row: { id: string; eventId: string; email: string | null; locale: Locale; agreementAcceptedAt: Date | null },
  actorId: string | null,
  now: Date,
): Promise<void> {
  if (!row.agreementAcceptedAt || row.email === null) return;
  await enqueueEmail(tx, {
    participantId: null,
    registrationId: null,
    messageType: "VOLUNTEER_AGREEMENT_ACCEPTED",
    locale: row.locale,
    recipientEmail: row.email,
    payload: { eventId: row.eventId, volunteerId: row.id },
    idempotencyKey: `volunteer:${row.id}:guardian-accepted:${now.getTime()}`,
    ...(actorId ? { requestedByStaffUserId: actorId } : {}),
    now,
  });
}

// ---------------------------------------------------------------------------------------------
// The organizers' two verbs
// ---------------------------------------------------------------------------------------------

/** The volunteer of this event, locked for the change; NOT_FOUND for another event's or none. */
async function lockedMinor<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, id: string) {
  const [row] = await tx
    .select()
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.id, id), eq(eventVolunteers.eventId, eventId)))
    .for("update")
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "the volunteer is not there");
  if (row.state === "CANCELLED") throw new DomainError("CONFLICT", "a cancelled volunteer's guardian is not asked");
  if (!isVolunteerMinor(row.age) || row.guardianName === null) throw new DomainError("CONFLICT", "this volunteer is not under eighteen");
  if (row.guardianAcceptedAt) throw new DomainError("VOLUNTEER_GUARDIAN_ACCEPTED", "the guardian has accepted the agreement");
  return { ...row, guardianName: row.guardianName };
}

/**
 * «Trimite linkul părintelui» (§768): one email with the volunteer agreement and a single-use link to accept it in the
 * guardian's name, to the guardian's address — minted at the send, so a press queues a message and never a secret
 * (§14.5). Refuses an actor who may not (FORBIDDEN), a volunteer not of this event (NOT_FOUND), one who is not under
 * eighteen or was cancelled (CONFLICT), one whose guardian has accepted (`VOLUNTEER_GUARDIAN_ACCEPTED`) or has no address
 * (`VOLUNTEER_GUARDIAN_NO_EMAIL`: the consent is taken on paper), a volunteer the club entered with no address of their own
 * (`VOLUNTEER_NO_EMAIL`, §864: such a row is on the list only and gets no email of any kind — its agreements, the guardian's
 * too, are signed on paper; the card draws no button for it), and any press while the club may not take minors
 * (`VOLUNTEER_MINORS_CLOSED`). Each press is its own email (a resend is a new trigger, §12.11) and the newest link replaces
 * the older one when it leaves.
 */
export async function requestVolunteerGuardian<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: string },
  now: Date,
): Promise<void> {
  assertMayManage(actor);
  assertIds(request.eventId, request.id);
  if (!(await volunteerMinorsOpen(db, now))) throw new DomainError("VOLUNTEER_MINORS_CLOSED", "the notice and the agreement in force do not describe minors");
  await db.transaction(async (tx) => {
    const row = await lockedMinor(tx, request.eventId, request.id);
    if (row.email === null) throw new DomainError("VOLUNTEER_NO_EMAIL", "the volunteer has no address: the parent's consent is taken on paper");
    if (row.guardianEmail === null) throw new DomainError("VOLUNTEER_GUARDIAN_NO_EMAIL", "the guardian has no address: the consent is taken on paper");
    await tx.update(eventVolunteers).set({ guardianRequestedAt: now, updatedAt: now }).where(eq(eventVolunteers.id, row.id));
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "VOLUNTEER_GUARDIAN_REQUEST",
      locale: row.locale,
      recipientEmail: row.guardianEmail,
      payload: { eventId: row.eventId, volunteerId: row.id },
      idempotencyKey: `volunteer:${row.id}:guardian-request:${now.getTime()}`,
      requestedByStaffUserId: actor.id,
      now,
    });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.guardian_requested",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id },
      now,
    });
  });
}

/**
 * «Acordul părintelui pe hârtie» (§768): the guardian signed the printed agreement at the desk, and an organizer records
 * it — the version in force in the volunteer's language (the one the desk's PDF prints), the moment of the press,
 * `PAPER`, and who recorded it; the signed sheet stays with the club. Refuses as `requestVolunteerGuardian` does, and —
 * `VOLUNTEER_AGREEMENT_REPRINT` — when the version in force or the volunteer's roles are no longer the ones the card
 * printed (`printed`): what the row records must be what the sheet says. The staff member records the guardian's
 * signature; they never sign for them.
 */
export async function recordPaperVolunteerGuardian<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: string; printed: { documentId: string; roles: string } },
  now: Date,
): Promise<void> {
  assertMayManage(actor);
  assertIds(request.eventId, request.id);
  if (!(await volunteerMinorsOpen(db, now))) throw new DomainError("VOLUNTEER_MINORS_CLOSED", "the notice and the agreement in force do not describe minors");
  await db.transaction(async (tx) => {
    const row = await lockedMinor(tx, request.eventId, request.id);
    const document = await findCurrentApprovedDocument(tx, VOLUNTEER_AGREEMENT_KEY, row.locale, now);
    if (!document) throw new DomainError("VOLUNTEER_AGREEMENT_MISSING", "no volunteer agreement is in force");
    const roles = await volunteerRoles(tx, row);
    const stamp = agreementRolesStamp(roles.assigned.map((role) => role.id), roles.chosen.map((role) => role.id));
    if (document.id !== request.printed.documentId || stamp !== request.printed.roles) {
      throw new DomainError("VOLUNTEER_AGREEMENT_REPRINT", "the version in force or the roles changed since the sheet was printed");
    }
    if (roles.assigned.length === 0 && roles.chosen.length === 0) throw new DomainError("NOT_FOUND", "the volunteer has no role");
    const acceptance = await guardianAcceptance(
      tx,
      {
        eventId: row.eventId,
        volunteerName: row.name,
        guardianName: row.guardianName,
        roles,
        locale: row.locale,
        document,
        method: "PAPER",
        typedName: null,
        recordedBy: actor.id,
      },
      now,
    );
    await tx.update(eventVolunteers).set({ ...acceptance, updatedAt: now }).where(eq(eventVolunteers.id, row.id));
    await queueVolunteerCopy(tx, row, actor.id, now);
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.guardian_recorded",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id, version: document.version, method: "PAPER" },
      now,
    });
  });
}
