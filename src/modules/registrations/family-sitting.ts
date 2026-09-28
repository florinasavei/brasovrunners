import { and, asc, desc, eq, gt, inArray, isNotNull, like, lt, lte, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type FamilySitting, familySittings, type PendingFamilyEntry, pendingFamilyEntries } from "@/db/schema/family-entries";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { isUuid } from "@/shared/ids";
import { isFamilySitting, sittingLinkExpiresAt } from "./domain/family-sitting";
import { FAMILY_PASS_MINUTES, SIGNABLE_STATUSES } from "./domain/family-signing";
import { liveSittingEntries } from "./family-entries";

/**
 * The database's half of a family sitting (§519): the rows `submitRegistration` writes and reads
 * inside its own transaction, under the event's lock, and the presses of «Da, încă o persoană» and
 * «Nu mai înscriu pe nimeni». What a sitting is, and why, is `domain/family-sitting.ts`; the table
 * is `db/schema/family-entries.ts`.
 *
 * The one rule this module keeps (§NNN, amending §519; the owner, 2026-09-28: «sa inteleg ca nu
 * primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?»): **a form's email is never held; only
 * «Da, încă o persoană» holds, and only until the next form**. Every message a form of the sitting
 * queues is due at once, on the club's ordinary timing (§513). «Da» moves what the sitting still has
 * waiting — pending and never tried — to the window's end (`next_attempt_at`, the claim's own
 * condition, so the outbox needs no notion of a sitting); the next form sends it again, merged. From
 * the second person on, those messages become one: the individual ones are deleted while still
 * pending and never tried, and the family message takes their place. A message that has already left
 * is not taken back: the next family message names everybody still waiting, and supersedes it.
 */

/** The sitting a form names, locked, when it still takes forms: this event and address, not sent, not confirmed. */
export async function lockLiveSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sittingId: string,
  scope: { eventId: string; participantId: string },
  now: Date,
): Promise<FamilySitting | null> {
  if (!isUuid(sittingId)) return null;
  const [row] = await tx.select().from(familySittings).where(eq(familySittings.id, sittingId)).limit(1).for("update");
  if (!row) return null;
  if (row.eventId !== scope.eventId || row.participantId !== scope.participantId) return null;
  if (row.releasedAt !== null || row.confirmedAt !== null || row.heldUntil.getTime() <= now.getTime()) return null;
  return row;
}

/** A new sitting, scoped to the address's registration its one link will name. */
export async function openSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  values: { eventId: string; participantId: string; registrationId: string; locale: Locale; heldUntil: Date; now: Date },
): Promise<FamilySitting> {
  const [row] = await tx
    .insert(familySittings)
    .values({
      eventId: values.eventId,
      participantId: values.participantId,
      registrationId: values.registrationId,
      locale: values.locale,
      heldUntil: values.heldUntil,
      expiresAt: values.heldUntil,
      createdAt: values.now,
    })
    .returning();
  return row;
}

/** One more thing the sitting keeps: a registration it created, a message it may merge or a «Da» may hold, or both. */
export async function holdInSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sitting: FamilySitting,
  add: { registrationId?: string | null; outboxId?: string | null },
): Promise<FamilySitting> {
  const registrationIds =
    add.registrationId && !sitting.registrationIds.includes(add.registrationId) ? [...sitting.registrationIds, add.registrationId] : sitting.registrationIds;
  const heldOutboxIds = add.outboxId && !sitting.heldOutboxIds.includes(add.outboxId) ? [...sitting.heldOutboxIds, add.outboxId] : sitting.heldOutboxIds;
  const [row] = await tx.update(familySittings).set({ registrationIds, heldOutboxIds }).where(eq(familySittings.id, sitting.id)).returning();
  return row ?? { ...sitting, registrationIds, heldOutboxIds };
}

/** The sitting's own registrations still waiting for the address's confirmation — the ones its link confirms. */
export async function sittingPendingRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  sitting: Pick<FamilySitting, "registrationIds">,
) {
  if (sitting.registrationIds.length === 0) return [];
  return db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      birthDate: registrations.birthDate,
      emailLinkExpiresAt: registrations.emailLinkExpiresAt,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .where(and(inArray(registrations.id, [...sitting.registrationIds]), eq(registrations.status, "PENDING_EMAIL_CONFIRMATION")))
    .orderBy(asc(registrations.createdAt), asc(registrations.id));
}

/**
 * The idempotency key of a sitting's family message. The first is `family-sitting:<id>`; once that one
 * has left while the sitting still takes forms (§NNN: a form's email is never held), the next form's
 * family message is a new one, keyed by its instant as well — the sitting's lock makes it one per form.
 */
export function familySittingMessageKey(sittingId: string, at?: Date): string {
  return at ? `family-sitting:${sittingId}:${at.toISOString()}` : `family-sitting:${sittingId}`;
}

/**
 * The sitting's messages that have not left yet — pending and never tried — locked, so the outbox
 * job's claim (which skips a locked row) cannot take one between this read and the merge.
 */
async function waitingSittingMessages<T extends Record<string, unknown>>(tx: Transaction<T>, sitting: Pick<FamilySitting, "heldOutboxIds">) {
  if (sitting.heldOutboxIds.length === 0) return [];
  return tx
    .select({ id: emailOutbox.id, messageType: emailOutbox.messageType, payloadJson: emailOutbox.payloadJson })
    .from(emailOutbox)
    .where(and(inArray(emailOutbox.id, [...sitting.heldOutboxIds]), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)))
    .for("update");
}

/**
 * Whether a message of the sitting is still to leave or leaving (§519, §NNN): the same person sent
 * again in the sitting is then told by it, and nothing more is queued. Once they have all left, the
 * form is an ordinary re-send.
 */
export async function sittingHasMessageToLeave<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sitting: Pick<FamilySitting, "heldOutboxIds">,
): Promise<boolean> {
  if (sitting.heldOutboxIds.length === 0) return false;
  const [row] = await tx
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(inArray(emailOutbox.id, [...sitting.heldOutboxIds]), inArray(emailOutbox.status, ["PENDING", "PROCESSING"])))
    .limit(1);
  return row !== undefined;
}

/**
 * After each form of the sitting (§519, §NNN), under the event's lock. The form's own message is
 * already queued, due at once: a form's email is never held. From the second person on, what the
 * sitting still has waiting becomes the one family message — the one still waiting, or a new one
 * when the last has left — and the individual messages it replaces are deleted while still pending
 * and never tried. Whatever a «Da» held is due again now: the form it waited for has come. The
 * sitting takes forms, and a «Da» holds, until `heldUntil`, the club's window from this form; the
 * row learns when its link's last lapse is.
 */
export async function settleSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sitting: FamilySitting,
  params: { heldUntil: Date; recipientEmail: string; now: Date },
): Promise<void> {
  const { heldUntil, now } = params;
  const entries = await liveSittingEntries(tx, sitting.id, now);
  const pending = await sittingPendingRegistrations(tx, sitting);
  const waiting = await waitingSittingMessages(tx, sitting);
  let held = waiting.map((row) => row.id);
  let replaced: string[] = [];

  if (isFamilySitting(pending.length + entries.length)) {
    const stillWaiting = waiting.find(
      (row) => row.messageType === "REGISTER_ANOTHER_PERSON" && (row.payloadJson as { familySittingId?: unknown } | null)?.familySittingId === sitting.id,
    );
    let familyId = stillWaiting?.id;
    if (!familyId) {
      const family = (idempotencyKey: string) =>
        enqueueEmail(tx, {
          participantId: sitting.participantId,
          // The registration the sitting's link is scoped to; the payload names the sitting, never a person (§12.12).
          registrationId: sitting.registrationId,
          messageType: "REGISTER_ANOTHER_PERSON",
          locale: sitting.locale,
          recipientEmail: params.recipientEmail,
          payload: { familySittingId: sitting.id },
          idempotencyKey,
          now,
        });
      // The first family message, or — the first one having left — a new one that names everybody still waiting.
      familyId = (await family(familySittingMessageKey(sitting.id)))?.id ?? (await family(familySittingMessageKey(sitting.id, now)))?.id;
    }
    replaced = held.filter((id) => id !== familyId);
    // Only rows still waiting and never tried (locked above): a message that has left is not taken back.
    if (replaced.length > 0) {
      await tx
        .delete(emailOutbox)
        .where(and(inArray(emailOutbox.id, replaced), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
    }
    held = familyId ? [familyId] : [];
  }

  // What a «Da» held leaves now, with this form (§NNN); a message due already is left as it is.
  if (held.length > 0) {
    const released = await tx
      .update(emailOutbox)
      .set({ nextAttemptAt: now })
      .where(and(inArray(emailOutbox.id, held), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0), gt(emailOutbox.nextAttemptAt, now)))
      .returning({ id: emailOutbox.id });
    // Sent after this response, as a message queued now would be (§68) — a form that queued nothing of its own included.
    if (released.length > 0) drainOutboxAfterResponse();
  }
  // The sitting keeps its messages' ids, less the ones the family message replaced: a «Da» holds what is still waiting.
  const kept = [...new Set([...sitting.heldOutboxIds.filter((id) => !replaced.includes(id)), ...held])];
  const expiresAt =
    sittingLinkExpiresAt([...pending.map((row) => row.emailLinkExpiresAt), ...entries.map((entry) => entry.expiresAt), sitting.expiresAt, heldUntil], now) ?? heldUntil;
  await tx.update(familySittings).set({ heldOutboxIds: kept, heldUntil, expiresAt }).where(eq(familySittings.id, sitting.id));
}

/**
 * «Nu mai înscriu pe nimeni» on the next form (§519, §NNN — once «Gata» on the screen after the form):
 * what a «Da» held leaves now, and the sitting takes no more forms. Pressed twice, or after the
 * window, it does nothing. The id comes from the browser's sealed half; a sitting that held nothing
 * — its messages had left already — has nothing to release, and the screen after it says the same
 * either way (§39).
 */
export async function releaseFamilySitting<T extends Record<string, unknown>>(db: Database<T>, sittingId: string, now: Date): Promise<void> {
  if (!isUuid(sittingId)) return;
  const released = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(familySittings).where(eq(familySittings.id, sittingId)).limit(1).for("update");
    if (!row || row.releasedAt !== null || row.confirmedAt !== null) return false;
    if (row.heldOutboxIds.length > 0) {
      await tx
        .update(emailOutbox)
        .set({ nextAttemptAt: now })
        .where(and(inArray(emailOutbox.id, [...row.heldOutboxIds]), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
    }
    await tx
      .update(familySittings)
      .set({ releasedAt: now, heldUntil: row.heldUntil.getTime() < now.getTime() ? row.heldUntil : now })
      .where(eq(familySittings.id, row.id));
    return row.heldOutboxIds.length > 0;
  });
  // Sent after this response, as a message queued now would be (§68).
  if (released) drainOutboxAfterResponse();
}

/**
 * «Da, încă o persoană» (§519, §NNN): the one press that holds. What the sitting still has waiting —
 * pending and never tried — waits for the next form, until the club's window from this press; the
 * next form sends it again, merged into one family message, and a next form never sent lets it go at
 * the window's end. A message that has left already is not taken back. A sitting already ended,
 * confirmed or past its window is left as it is, and the next form opens a sitting of its own. The id
 * comes from the browser's sealed half; nothing is said back (§39).
 */
export async function continueFamilySitting<T extends Record<string, unknown>>(
  db: Database<T>,
  sittingId: string,
  heldUntil: Date,
  now: Date,
): Promise<void> {
  if (!isUuid(sittingId)) return;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(familySittings).where(eq(familySittings.id, sittingId)).limit(1).for("update");
    if (!row || row.releasedAt !== null || row.confirmedAt !== null || row.heldUntil.getTime() <= now.getTime()) return;
    if (row.heldOutboxIds.length > 0) {
      await tx
        .update(emailOutbox)
        .set({ nextAttemptAt: heldUntil })
        .where(and(inArray(emailOutbox.id, [...row.heldOutboxIds]), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
    }
    await tx
      .update(familySittings)
      .set({ heldUntil, expiresAt: row.expiresAt.getTime() < heldUntil.getTime() ? heldUntil : row.expiresAt })
      .where(eq(familySittings.id, row.id));
  });
}

/**
 * A verification email a sitting held (§519), rendered now — it is leaving: the registration's link
 * lives the club's email-link window («Termene», §377) from this send, as the message says («valabil
 * 48 de ore»), not from the form sent a window and a pinger's wait earlier. The same rule as the
 * family message's (`extendSittingLinks`): only a link still live, lengthened and never shortened.
 */
export async function extendHeldVerificationLink<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  until: Date,
  now: Date,
): Promise<Date | null> {
  const [row] = await db
    .update(registrations)
    .set({ emailLinkExpiresAt: until })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        gt(registrations.emailLinkExpiresAt, now),
        lt(registrations.emailLinkExpiresAt, until),
      ),
    )
    .returning({ emailLinkExpiresAt: registrations.emailLinkExpiresAt });
  return row?.emailLinkExpiresAt ?? null;
}

/**
 * The family's order (§519, `compareFamilyOrder`): the registrations of every sitting of this address
 * at this event that the family's one button confirmed, in the order the forms were sent — the index
 * a registration has here is its `familyRank`. Empty for an address that never confirmed a sitting.
 */
export async function sittingOrderFor<T extends Record<string, unknown>>(db: Database<T>, participantId: string, eventId: string): Promise<string[]> {
  const rows = await db
    .select({ registrationIds: familySittings.registrationIds })
    .from(familySittings)
    .where(and(eq(familySittings.participantId, participantId), eq(familySittings.eventId, eventId), isNotNull(familySittings.confirmedAt)))
    .orderBy(asc(familySittings.confirmedAt), asc(familySittings.id));
  return rows.flatMap((row) => row.registrationIds);
}

/** The sitting whose one button confirmed this registration (§519), if one did. */
export async function confirmedSittingOf<T extends Record<string, unknown>>(db: Database<T>, registrationId: string): Promise<FamilySitting | undefined> {
  const [row] = await db
    .select()
    .from(familySittings)
    .where(and(isNotNull(familySittings.confirmedAt), sql`${familySittings.registrationIds} @> ${JSON.stringify([registrationId])}::jsonb`))
    .orderBy(desc(familySittings.confirmedAt))
    .limit(1);
  return row;
}

/** The idempotency key of a family's one confirmation (§519): one per sitting, whoever signs first. */
export function familyConfirmedMessageKey(sittingId: string): string {
  return `family-sitting:${sittingId}:confirmed`;
}

/**
 * A family confirmed together gets one confirmation (§519; the owner, 2026-09-27: «statusul CONFIRMAT
 * trebuie să fie pentru toată familia, și în mail trebuie să vină toate QR-urile pentru toată familia»):
 * «Confirmat: 3 persoane la …», every person's QR code, desk code and race number under their name,
 * read at send time (`render.ts`) — instead of one confirmation per signature.
 *
 * Called by each signature of a person the family's button confirmed, under the event's lock. The
 * first queues the message; each one after it moves it. It leaves once nobody in the family is left
 * to sign here, or the wizard's half hour after the last signature (`FAMILY_PASS_MINUTES`) — a person
 * put off for later is not waited for longer than the wizard waits. Its club copy is one message, as
 * for any confirmation (§320), and moves with it.
 *
 * Returns false when the family's message has already left (or is leaving): the signer then gets the
 * confirmation they always had, of their own. The row is locked first, so a batch claiming it at this
 * instant either waits for this signature — and renders it — or has it already, and the signer is told
 * alone (`claimOutboxBatch` skips a locked row).
 */
export async function queueFamilyConfirmed<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sitting: FamilySitting,
  confirmed: Registration,
  recipientEmail: string,
  now: Date,
): Promise<boolean> {
  const key = familyConfirmedMessageKey(sitting.id);
  const unsigned = await tx
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(inArray(registrations.id, [...sitting.registrationIds]), inArray(registrations.status, [...SIGNABLE_STATUSES])))
    .limit(1);
  const releaseAt = unsigned.length === 0 ? now : new Date(now.getTime() + FAMILY_PASS_MINUTES * 60_000);

  const [existing] = await tx.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)).limit(1).for("update");
  if (existing) {
    if (existing.status !== "PENDING") return false;
    if (existing.attemptCount === 0) {
      // The participant's message and its club copies, which carry the key as their prefix.
      await tx
        .update(emailOutbox)
        .set({ nextAttemptAt: releaseAt })
        .where(and(or(eq(emailOutbox.idempotencyKey, key), like(emailOutbox.idempotencyKey, `${key}:club-copy:%`)), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
      if (releaseAt.getTime() <= now.getTime()) drainOutboxAfterResponse();
    }
    return true;
  }
  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    // The first signer's: the event, the language and the club copy's test are read through it.
    registrationId: confirmed.id,
    messageType: "REGISTRATION_CONFIRMED",
    locale: sitting.locale,
    recipientEmail,
    // The sitting by its id alone — never a name or a number in the outbox (§12.12).
    payload: { familySittingId: sitting.id },
    idempotencyKey: key,
    now,
    notBefore: releaseAt,
  });
  return true;
}

/**
 * The family message is rendered — it is leaving now (§519): everything its one link acts on lives
 * the club's email-link window («Termene», §377) from this instant, as the message says («linkul e
 * valabil 48 de ore»), not from the form that was sent a window and a pinger's wait earlier. Only
 * what is still live is lengthened, and never shortened: a registration whose link already lapsed and
 * a kept form past its time stay lapsed. Returns the sitting with its new lapse, for the token.
 */
export async function extendSittingLinks<T extends Record<string, unknown>>(
  db: Database<T>,
  sitting: FamilySitting,
  until: Date,
  now: Date,
): Promise<FamilySitting> {
  return db.transaction(async (tx) => {
    if (sitting.registrationIds.length > 0) {
      await tx
        .update(registrations)
        .set({ emailLinkExpiresAt: until })
        .where(
          and(
            inArray(registrations.id, [...sitting.registrationIds]),
            eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
            gt(registrations.emailLinkExpiresAt, now),
            lt(registrations.emailLinkExpiresAt, until),
          ),
        );
    }
    await tx
      .update(pendingFamilyEntries)
      .set({ expiresAt: until })
      .where(and(eq(pendingFamilyEntries.sittingId, sitting.id), gt(pendingFamilyEntries.expiresAt, now), lt(pendingFamilyEntries.expiresAt, until)));
    if (sitting.expiresAt.getTime() >= until.getTime()) return sitting;
    const [row] = await tx.update(familySittings).set({ expiresAt: until }).where(eq(familySittings.id, sitting.id)).returning();
    return row ?? { ...sitting, expiresAt: until };
  });
}

export async function findSittingById<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<FamilySitting | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select().from(familySittings).where(eq(familySittings.id, id)).limit(1);
  return row;
}

/** The sitting the family message's token was minted for — the one its page reads and its press confirms. */
export async function findSittingByToken<T extends Record<string, unknown>>(db: Database<T>, tokenId: string): Promise<FamilySitting | undefined> {
  const [row] = await db.select().from(familySittings).where(eq(familySittings.actionTokenId, tokenId)).limit(1);
  return row;
}

/** The renderer, at send time: the token it just minted is the one the family message carries. */
export async function linkSittingToken<T extends Record<string, unknown>>(db: Database<T>, sittingId: string, tokenId: string): Promise<void> {
  await db.update(familySittings).set({ actionTokenId: tokenId }).where(eq(familySittings.id, sittingId));
}

/** Whether the sitting's link can still act: not confirmed, and something in it not lapsed. */
export function sittingStillOpen(sitting: Pick<FamilySitting, "confirmedAt" | "expiresAt">, now: Date): boolean {
  return sitting.confirmedAt === null && sitting.expiresAt.getTime() > now.getTime();
}

/**
 * Everybody the family message and its page name as joining now (§519): the sitting's registrations
 * still waiting for the address, then its kept forms, each in the order they were sent.
 */
export async function sittingPeople<T extends Record<string, unknown>>(
  db: Database<T>,
  sitting: FamilySitting,
  now: Date,
): Promise<{
  registrations: Awaited<ReturnType<typeof sittingPendingRegistrations>>;
  entries: PendingFamilyEntry[];
}> {
  return { registrations: await sittingPendingRegistrations(db, sitting), entries: await liveSittingEntries(db, sitting.id, now) };
}

/**
 * The sittings nobody can act on any more, deleted by the registration maintenance job (§519), as the
 * kept forms are. The rows hold ids and instants, never a name; a kept form they pointed at stays
 * until its own lapse (`sitting_id` is set to null).
 */
export async function purgeLapsedFamilySittings<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const gone = await db.delete(familySittings).where(lte(familySittings.expiresAt, now)).returning({ id: familySittings.id });
  return gone.length;
}
