import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type FamilySitting, familySittings, type PendingFamilyEntry } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { isUuid } from "@/shared/ids";
import { isFamilySitting, sittingLinkExpiresAt } from "./domain/family-sitting";
import { liveSittingEntries } from "./family-entries";

/**
 * The database's half of a family sitting (§NNN): the rows `submitRegistration` writes and reads
 * inside its own transaction, under the event's lock, and the press of «Gata». What a sitting is,
 * and why, is `domain/family-sitting.ts`; the table is `db/schema/family-entries.ts`.
 *
 * The one rule this module keeps: **nothing the sitting holds leaves before «Gata» or the window**.
 * Each message a form of the sitting queues is written with `next_attempt_at` at the sitting's
 * `held_until`, which is the claim's own condition (`claimOutboxBatch`), so the outbox needs no
 * notion of a sitting. From the second person on, those messages become one: the individual ones
 * are deleted while still pending and never tried, and the family message takes their place, held
 * the same way. The drain that `enqueueEmail` schedules finds nothing due and tells the outbox job
 * when it will (`drain.ts`), so the window is kept even when nobody presses «Gata».
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

/** One more thing the sitting holds: a registration it created, a message it holds back, or both. */
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

/** The idempotency key of a sitting's one family message: one per sitting, whatever happens. */
export function familySittingMessageKey(sittingId: string): string {
  return `family-sitting:${sittingId}`;
}

/**
 * After each form of the sitting (§NNN), under the event's lock: the window moves to `heldUntil`,
 * and from the second person on the held messages become the one family message. Every message the
 * sitting still holds waits until `heldUntil`; the row learns when its link's last lapse is.
 */
export async function settleSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  sitting: FamilySitting,
  params: { heldUntil: Date; recipientEmail: string; now: Date },
): Promise<void> {
  const { heldUntil, now } = params;
  const entries = await liveSittingEntries(tx, sitting.id, now);
  const pending = await sittingPendingRegistrations(tx, sitting);
  let held = [...sitting.heldOutboxIds];

  if (isFamilySitting(pending.length + entries.length)) {
    const key = familySittingMessageKey(sitting.id);
    const queued = await enqueueEmail(tx, {
      participantId: sitting.participantId,
      // The registration the sitting's link is scoped to; the payload names the sitting, never a person (§12.12).
      registrationId: sitting.registrationId,
      messageType: "REGISTER_ANOTHER_PERSON",
      locale: sitting.locale,
      recipientEmail: params.recipientEmail,
      payload: { familySittingId: sitting.id },
      idempotencyKey: key,
      now,
      notBefore: heldUntil,
    });
    const familyId =
      queued?.id ?? (await tx.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)).limit(1))[0]?.id;
    const replaced = held.filter((id) => id !== familyId);
    // Only rows still waiting and never tried: a message that has left is not taken back.
    if (replaced.length > 0) {
      await tx
        .delete(emailOutbox)
        .where(and(inArray(emailOutbox.id, replaced), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
    }
    held = familyId ? [familyId] : [];
  }

  if (held.length > 0) {
    await tx
      .update(emailOutbox)
      .set({ nextAttemptAt: heldUntil })
      .where(and(inArray(emailOutbox.id, held), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
  }
  const expiresAt =
    sittingLinkExpiresAt([...pending.map((row) => row.emailLinkExpiresAt), ...entries.map((entry) => entry.expiresAt), sitting.expiresAt, heldUntil], now) ?? heldUntil;
  await tx.update(familySittings).set({ heldOutboxIds: held, heldUntil, expiresAt }).where(eq(familySittings.id, sitting.id));
}

/**
 * «Gata» (§NNN): what the sitting holds leaves now, and the sitting takes no more forms. Pressed
 * twice, or after the window, it does nothing. The id comes from the browser's sealed half; a
 * sitting that held nothing — a re-send about a registration outside it went at once — has nothing
 * to release, and the screen after it says the same either way (§39).
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
 * Everybody the family message and its page name as joining now (§NNN): the sitting's registrations
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
 * The sittings nobody can act on any more, deleted by the registration maintenance job (§NNN), as the
 * kept forms are. The rows hold ids and instants, never a name; a kept form they pointed at stays
 * until its own lapse (`sitting_id` is set to null).
 */
export async function purgeLapsedFamilySittings<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const gone = await db.delete(familySittings).where(lte(familySittings.expiresAt, now)).returning({ id: familySittings.id });
  return gone.length;
}
