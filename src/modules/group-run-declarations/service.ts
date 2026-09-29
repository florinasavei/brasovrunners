import { and, eq, inArray, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { startHeldBack } from "@/modules/events/domain/dated";
import { recordAuditEvent } from "@/modules/audit/repository";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { asksForIdDocument } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { classifySubmission } from "@/modules/registrations/service";
import { heldRefusal, holdReason } from "@/modules/registrations/declaration-hold";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { birthDateRefusal, ERASE_REASON_MAX, ID_DOCUMENT_MAX, keptSignature, signerIdentity, signingOpen, TYPED_NAME_MAX } from "./domain";
import { groupRunMergeValues, groupRunTextHash } from "./facts";
import { insertGroupRunDeclaration, listCoveringSignatures, listSeriesDatesOf } from "./repository";
import { factsToKeep } from "./series";

/**
 * Signing a group run's optional self-declaration, and erasing one (§393).
 *
 * **Never a registration.** A group run is turned up to (§111): signing creates no participant, no
 * registration and no place, touches no capacity and passes through no allocator. It writes one
 * `group_run_declarations` row and queues two messages through the outbox (§68): the signer's copy
 * with the PDF (`GROUP_RUN_DECLARATION_SIGNED`) and, when the club has a declarations mailbox, the
 * archive copy with the identity document masked (`GROUP_RUN_DECLARATION_ARCHIVE`, §99, §320) — in
 * the transaction that writes the row, so a rolled-back signature leaves no message and a message
 * never describes a signature that is not there.
 *
 * **The guards are the public forms'** (§97, §19.4): the honeypot and the timing check answer as a
 * signature would and write nothing (a distinct answer tells a script which check it tripped); the
 * Turnstile verdict is asked by the action; and a throttle keyed on a hash of the signer's
 * canonical address, because every post spends two messages of the club's allowance.
 *
 * **One per person, series and version (§523).** A series' signature covers every date of the run
 * (§113), so a returning runner who signs again writes no second row: the one they signed for the
 * version in force is kept and its copy sent again (`keptSignature`), and the unique index on
 * (version, series, signer) holds two presses at once to one row. A newer version is a new row
 * beside the older one, which stays as evidence: a public press, which nobody verified, never
 * deletes a signature — only the Administrator's audited erase does. Nothing on the page tells a
 * kept signature from a new one.
 *
 * **Bound to the text that was read (§57).** The page posts the version's id and hash; a different
 * version in force at the press is refused with `CONFLICT` (`DECLARATION_CHANGED`) and nothing is
 * written. A version's hash covers both languages (§46), so the signer may ask for the PDF in the
 * other language and still sign exactly the version they read.
 */

export type GroupRunSigningInput = {
  eventId: string;
  documentId: string;
  contentSha256: string;
  accepted: boolean;
  typedName: string;
  /** The kind and the series and number, composed by the action (§283); absent or empty when not typed. */
  idDocument?: string;
  /**
   * The signer's birth date, `YYYY-MM-DD` (§440): asked only while the run has a minimum age, and
   * counted against it on the run's day — never stored, never in the declaration or the PDF.
   */
  birthDate?: string;
  email: string;
  /** The language the declaration is signed in, and the PDF and the email are written in (§97). */
  locale: Locale;
  honeypot?: string;
  renderedAt?: string;
  /**
   * Whether a members' session posted this (§552), asked of the account by the action — only when the
   * run is the members' alone, which takes a signature only from one, as its page opens only for one.
   */
  membersSession?: () => Promise<boolean>;
};

export type GroupRunSigningOutcome =
  /**
   * Signed: the row and the messages are written — or, when the same person had already signed the
   * version in force for this run (`kept`, §523), that row is kept and its copy sent again. The page
   * answers both alike; `kept` is for the tests and the log, never for the visitor.
   */
  | { outcome: "signed"; id: string; kept: boolean }
  /** A bot's post: answered as signed, and nothing written. */
  | { outcome: "ignored" }
  /** Too many from this address this hour. */
  | { outcome: "limited"; retryAfter: number };

/** The event facts that decide whether a signature may be taken now. */
export type SignableEvent = {
  id: string;
  type: string;
  surface: string | null;
  offersGroupRunDeclaration: boolean;
  editorialStatus: string;
  eventStatus: string;
  startsAt: Date;
  /** The event's own minimum age (§329), zero for none: the signing page's door (§440). */
  minAge: number;
  /** The run's own zone: the day the minimum age is counted on (§321). */
  timezone: string;
  /** «Doar pentru membrii BVR» (§552): signed only behind a members' session. Absent on a fixture: false. */
  membersOnly?: boolean;
};

export async function findSignableEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<SignableEvent | undefined> {
  const [row] = await db
    .select({
      id: events.id,
      type: events.type,
      surface: events.surface,
      offersGroupRunDeclaration: events.offersGroupRunDeclaration,
      editorialStatus: events.editorialStatus,
      eventStatus: events.eventStatus,
      startsAt: events.startsAt,
      minAge: events.minAge,
      timezone: events.timezone,
      dateToBeAnnounced: events.dateToBeAnnounced,
      timeToBeAnnounced: events.timeToBeAnnounced,
      membersOnly: events.membersOnly,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  // A run whose date is to be announced (§533) has nothing to sign for yet: its start is only the
  // organizer's provisional note, and the signed PDF and its email would print it. Not signable, as
  // the page (which answers 404) says — asked here too, for a stale form or a post to the action.
  if (!row || startHeldBack(row)) return undefined;
  return row;
}

function declarationChanged(): DomainError {
  return new DomainError("CONFLICT", "DECLARATION_CHANGED: the text in force is not the one that was read");
}

export async function signGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  input: GroupRunSigningInput,
  now: Date,
): Promise<GroupRunSigningOutcome> {
  // The form's silence (§19.4): a trap filled with something that is not the signer's own
  // address, or a post faster than a person reads — answered as signed, nothing written.
  // A trap holding the signer's own address or name is a password manager, not a bot (§282).
  const verdict = classifySubmission({ honeypot: input.honeypot, renderedAt: input.renderedAt, email: input.email, firstName: input.typedName }, now);
  if (verdict !== "ok" && verdict !== "autofill") return { outcome: "ignored" };

  // A posted id that is not a uuid names no run, and never reaches a uuid column (§376): the
  // form's own "closed" answer rather than PostgreSQL's 22P02 and a 500.
  if (!isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");
  if (!isUuid(input.documentId)) throw declarationChanged();

  const event = await findSignableEvent(db, input.eventId);
  const key = event ? offeredGroupRunDeclarationKey(event) : null;
  if (!event || !key || !signingOpen(event, now)) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");
  // A run for the members alone (§552) is signed for behind a members' session only — the same
  // answer as a run that offers nothing, so a post says nothing about whether such a run exists.
  if (event.membersOnly === true && !(await input.membersSession?.())) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");

  // The text in force, in the language chosen for it — the same version in both (§46).
  const document = await findCurrentApprovedDocument(db, key, input.locale, now);
  if (!document) throw new DomainError("NOT_FOUND", "the club has no approved declaration of this kind");

  // A signature takes an address and an identity document: without an approved privacy notice in
  // force to say why and for how long, nothing is taken — the rule a registration answers to
  // (`submitRegistration`, BR-REQ-053-01), in the same words. NOT_FOUND, so the page says the
  // declaration cannot be signed, which is true, and the run's page draws no button meanwhile.
  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError("NOT_FOUND", "no approved privacy notice exists yet; the declaration cannot be signed");
  }
  if (document.id !== input.documentId || document.contentSha256 !== input.contentSha256) throw declarationChanged();

  // Every box that is wrong at once, so the summary can name each (§47).
  const typedName = input.typedName.trim();
  const idDocument = (input.idDocument ?? "").trim();
  const needsDocument = asksForIdDocument(document.body);
  let canonicalEmail: string | null = null;
  try {
    canonicalEmail = canonicalizeEmail(input.email).canonicalEmail;
  } catch (error) {
    if (!(error instanceof InvalidEmailError)) throw error;
  }
  const invalid = [
    ...(needsDocument && (idDocument === "" || idDocument.length > ID_DOCUMENT_MAX) ? ["idDocument"] : []),
    ...birthDateRefusal(event, input.birthDate),
    ...(typedName === "" || typedName.length > TYPED_NAME_MAX ? ["typedName"] : []),
    ...(canonicalEmail === null ? ["email"] : []),
    ...(input.accepted ? [] : ["accepted"]),
  ];
  if (invalid.length > 0) throw new DomainError("VALIDATION_ERROR", `${invalid.join(", ")}: the declaration is incomplete`, invalid);

  // Per address, hashed (§322): the bucket needs equality and nothing else.
  const throttle = await consumeRateLimit(db, "group-run-declaration", emailBucketKey("group-run-declaration", canonicalEmail as string), now);
  if (!throttle.allowed) return { outcome: "limited", retryAfter: throttle.retryAfter };

  // The blanks as the signer read them, kept on the row for the PDF (§523): the run's and the series'.
  const facts = await groupRunMergeValues(db, event.id, input.locale, document.body);
  const signerKey = signerIdentity(input.email, typedName) as string;

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Database<T>;
    /*
      One declaration per person, series and version (§523): the signatures of the version in force
      that cover this date — signed on it, or for its series on any date of it (§113). The same
      person's is kept and sent again; otherwise this one is written. Nothing is deleted: an older
      version's signature stays beside the new one, as the evidence for the runs it covered (§53).
    */
    const dates = (await listSeriesDatesOf(txDb, event.id)).map((date) => date.id);
    const existing = keptSignature(await listCoveringSignatures(txDb, event.id, dates, document.id), { email: input.email, typedName }, document.id);
    const resend = async (kept: { id: string; email: string }) => {
      // Their copy again, to the address the row keeps (the same mailbox, canonically): no second
      // row, no second archive copy, and the page answers as it does to a signature (§39's rule).
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "GROUP_RUN_DECLARATION_SIGNED",
        locale: input.locale,
        recipientEmail: kept.email,
        payload: { groupRunDeclarationId: kept.id },
        idempotencyKey: `group-run-declaration:${kept.id}:signed:${now.getTime()}`,
        now,
      });
      return { outcome: "signed" as const, id: kept.id, kept: true };
    };
    if (existing) return resend(existing);
    const signedFacts = facts ? factsToKeep(facts.values) : null;
    const storedDocument = needsDocument ? idDocument : null;
    const row = await insertGroupRunDeclaration(txDb, {
      // The proof of signing (§NNN): the exact text this signer's PDF prints, hashed before the row is written.
      textHash: await groupRunTextHash(txDb, {
        eventId: event.id,
        document,
        signedFacts,
        signer: { typedName, idDocument: storedDocument, locale: input.locale, acceptedAt: now },
      }),
      eventId: event.id,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: input.locale,
      typedName,
      idDocument: storedDocument,
      email: input.email.trim(),
      acceptedAt: now,
      createdAt: now,
      seriesKey: facts?.seriesKey ?? null,
      signerKey,
      signedFacts,
    });
    if (!row) {
      /*
        Another press for the same person wrote the row between our read and our write (§523): the
        unique index refused this one, and nothing was written. Theirs is the signature; send it.
      */
      const [raced] = await listCoveringSignatures(txDb, event.id, dates, document.id).then((rows) =>
        rows.filter((candidate) => signerIdentity(candidate.email, candidate.typedName) === signerKey),
      );
      if (!raced) throw new Error("the declaration was not written");
      return resend(raced);
    }
    // The signer's copy, with the PDF: no participant, no registration, no token (§393).
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "GROUP_RUN_DECLARATION_SIGNED",
      locale: input.locale,
      recipientEmail: row.email,
      payload: { groupRunDeclarationId: row.id },
      idempotencyKey: `group-run-declaration:${row.id}:signed`,
      now,
    });
    // The club's archive copy (§99), to the mailbox the club named, with its copies (§244).
    const copies = resolveDeclarationCopies(await readClubNotices(tx), env.DECLARATIONS_ARCHIVE_TO);
    if (copies.to) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "GROUP_RUN_DECLARATION_ARCHIVE",
        // The club reads Romanian; the message is bilingual regardless (§96).
        locale: "ro",
        recipientEmail: copies.to,
        payload: { groupRunDeclarationId: row.id, cc: [...copies.cc], bcc: [...copies.bcc] },
        idempotencyKey: `group-run-declaration:${row.id}:archive`,
        now,
      });
    }
    return { outcome: "signed" as const, id: row.id, kept: false };
  });
}

/**
 * An Administrator erases one group-run declaration (§393, the shape of §67 and §88).
 *
 * The audit row first, in the same transaction: who acted, why, and the event — never who had
 * signed (`AGENTS.md` §12.12). Then the messages about it that still hold the signer's address, and
 * the row. A role below Administrator is refused here, whatever the screen drew (BR-REQ-060-01).
 */
export async function eraseGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { id: string; reason: string },
  now: Date,
): Promise<{ eventId: string }> {
  const reason = assertMayErase(actor, input.reason);
  if (!isUuid(input.id)) throw new DomainError("NOT_FOUND", "no such declaration");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, version: groupRunDeclarations.declarationVersion })
      .from(groupRunDeclarations)
      .where(eq(groupRunDeclarations.id, input.id))
      .limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "no such declaration");
    await eraseSignature(tx, actor, row, reason, now);
    return { eventId: row.eventId };
  });
}

/**
 * The ticked signatures of one run erased in one press (§532; the owner, 2026-09-28: «să pot face
 * batch delete și la declarații, cu confirmarea numărului șters»).
 *
 * Each one exactly as `eraseGroupRunDeclaration` erases one — the same `eraseSignature`: its audit
 * row first (who and why, never who had signed), its messages, the row — so the batch bypasses
 * nothing. One reason for all of them, as the batch screen asks once.
 *
 * `ids` is the set the confirm dialog counted, and it must still be the run's, whole: a signature
 * erased meanwhile (another tab, a colleague) or one not of this run refuses the whole press with a
 * `CONFLICT` and erases nothing, because the Administrator confirmed "N declarations", not the
 * N − 1 the rows became. One transaction, the rows locked, so two presses never share a signature.
 */
export async function eraseGroupRunDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { eventId: string; ids: readonly string[]; reason: string },
  now: Date,
): Promise<{ erased: number }> {
  const reason = assertMayErase(actor, input.reason);
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) throw new DomainError("VALIDATION_ERROR", "no declaration was ticked", ["declarationIds"]);
  if (!isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");
  if (!ids.every(isUuid)) throw new DomainError("CONFLICT", "the ticked declarations changed; nothing was erased");

  return db.transaction(async (tx) => {
    const dates = (await listSeriesDatesOf(tx, input.eventId)).map((date) => date.id);
    if (dates.length === 0) throw new DomainError("NOT_FOUND", "no such event");
    const rows = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, version: groupRunDeclarations.declarationVersion })
      .from(groupRunDeclarations)
      .where(and(inArray(groupRunDeclarations.id, ids), inArray(groupRunDeclarations.eventId, dates)))
      .for("update");
    if (rows.length !== ids.length) {
      throw new DomainError("CONFLICT", `the ticked declarations changed (${rows.length} of ${ids.length} still there); nothing was erased`);
    }
    for (const row of rows) await eraseSignature(tx, actor, row, reason, now);
    return { erased: rows.length };
  });
}

/**
 * «Păstrează: reclamație / litigiu în curs» on one group-run declaration (§NNN), or its release: an
 * Administrator's, with a reason, the audit row in the same transaction — who, why, the event and the
 * declaration's id, never who had signed. While it is set no erase takes the row and no delete of the
 * run's last date cascades it away (`refuseHeldGroupRunDeclarationsOfEvent`). The retention sweep never
 * deletes a group-run row (§503); the hold is what lets the club answer a withdrawal request with
 * «not yet» while a complaint is open, as the declaration's own retention sentence says.
 *
 * `eventId` is the date whose backoffice page the press came from; the row must be the run's (§523).
 */
export async function setGroupRunDeclarationHold<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { eventId: string; id: string; hold: boolean; reason: string },
  now: Date,
): Promise<{ eventId: string }> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "holding a declaration is an Administrator's");
  const reason = holdReason(input.reason);
  if (!isUuid(input.id) || !isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "no such declaration");
  return db.transaction(async (tx) => {
    const dates = (await listSeriesDatesOf(tx, input.eventId)).map((date) => date.id);
    const [row] = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, held: groupRunDeclarations.retentionHold })
      .from(groupRunDeclarations)
      .where(and(eq(groupRunDeclarations.id, input.id), inArray(groupRunDeclarations.eventId, dates.length > 0 ? dates : [input.eventId])))
      .limit(1)
      // Locked, as `eraseSignature` locks it: a hold and an erase at once run one after the other (§NNN).
      .for("update");
    if (!row) throw new DomainError("NOT_FOUND", "no such declaration");
    if (!input.hold && !row.held) return { eventId: row.eventId };
    await tx
      .update(groupRunDeclarations)
      .set(
        input.hold
          ? { retentionHold: true, retentionHoldReason: reason, retentionHoldAt: now, retentionHoldByStaffUserId: actor.id }
          : { retentionHold: false, retentionHoldReason: null, retentionHoldAt: null, retentionHoldByStaffUserId: null },
      )
      .where(eq(groupRunDeclarations.id, row.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: input.hold ? "event.group_run_declaration_hold_set" : "event.group_run_declaration_hold_cleared",
      entityType: "event",
      entityId: row.eventId,
      metadata: { groupRunDeclarationId: row.id, reason },
      now,
    });
    return { eventId: row.eventId };
  });
}

/** The role and the reason every erase asks for (§393, §67): the trimmed reason, or a refusal. */
function assertMayErase(actor: Pick<StaffUser, "role">, typed: string): string {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "erasing a declaration is an Administrator's");
  const reason = typed.trim();
  if (reason === "" || reason.length > ERASE_REASON_MAX) throw new DomainError("VALIDATION_ERROR", "reason: say why", ["reason"]);
  return reason;
}

/**
 * One signature erased, inside the caller's transaction — the one path the single and the batch
 * erase share. The audit row first: who acted, why, the event and the version — never who had
 * signed (`AGENTS.md` §12.12). Then the signer's and the club's messages, which carry the address
 * and name the row, and the row.
 */
async function eraseSignature<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Pick<StaffUser, "id">,
  row: { id: string; eventId: string; version: number },
  reason: string,
  now: Date,
): Promise<void> {
  // Kept for a complaint or a dispute (§NNN): no erase — the signer's request included — until an
  // Administrator clears the hold. The batch refuses whole, as it does for a set that changed. The
  // row is locked until the delete commits, so a hold pressed meanwhile waits and then finds nothing.
  const [locked] = await tx
    .select({ held: groupRunDeclarations.retentionHold })
    .from(groupRunDeclarations)
    .where(eq(groupRunDeclarations.id, row.id))
    .limit(1)
    .for("update");
  if (locked?.held) throw heldRefusal();
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "event.group_run_declaration_erased",
    entityType: "event",
    entityId: row.eventId,
    metadata: { reason, declarationVersion: row.version },
    now,
  });
  await tx.delete(emailOutbox).where(sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId' = ${row.id}`);
  await tx.delete(groupRunDeclarations).where(and(eq(groupRunDeclarations.id, row.id), eq(groupRunDeclarations.eventId, row.eventId)));
}
