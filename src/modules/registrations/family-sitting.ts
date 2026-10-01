import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type FamilySitting, familyPlaceHolds, familySittings, type PendingFamilyEntry, pendingFamilyEntries } from "@/db/schema/family-entries";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { notHeldByMailgun } from "@/modules/notifications/mailgun-stop";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { isUuid } from "@/shared/ids";
import { FAMILY_HELD, familyHeldUntil, isFamilySitting, SITTING_HELD, type SittingSeed, sittingLinkExpiresAt } from "./domain/family-sitting";
import { FAMILY_PASS_MINUTES, SIGNABLE_STATUSES } from "./domain/family-signing";
import { liveSittingEntries } from "./family-entries";

/**
 * The database's half of a family sitting (§519): the rows `submitRegistration` writes and reads
 * inside its own transaction, under the event's lock, and the presses of «Da, încă o persoană» and
 * «Gata». What a sitting is, and why, is `domain/family-sitting.ts`; the table is
 * `db/schema/family-entries.ts`.
 *
 * **No sitting without a press** (§536, amending §519; the owner, 2026-09-28: «sa inteleg ca nu
 * primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?»). The first form is an ordinary form:
 * its email is due at once, on the club's ordinary timing, and no row is written. «Da, încă o
 * persoană» opens the sitting (`continueFamilySitting`): it takes in the first form's registration or
 * kept form, and holds its message when it has not left yet.
 *
 * From that press on, §519's rule is kept whole: **nothing the sitting holds leaves before «Gata» or
 * the window**. Each message a form of the sitting queues is written with `next_attempt_at` at the
 * sitting's `held_until`, which is the claim's own condition (`claimOutboxBatch`), so the outbox needs
 * no notion of a sitting. From the second person on, those messages become one: the individual ones
 * are deleted while still pending and never tried, and the family message takes their place, held
 * the same way. The drain that `enqueueEmail` schedules finds nothing due and tells the outbox job
 * when it will (`drain.ts`), so the window is kept even when nobody presses «Gata».
 */

/**
 * The sitting a form names, locked, when it still takes forms: this event and address, not sent, not
 * confirmed, within its window — and before its fixed reservation deadline (§543, the review of
 * 2026-09-28, round three): a form after it opens a new sitting, with a deadline of its own.
 */
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
  if (!reservationStillAhead(row, now)) return null;
  return row;
}

/** Whether a sitting's fixed reservation deadline (§543) is still ahead; a sitting written before the column has none yet. */
function reservationStillAhead(row: Pick<FamilySitting, "reservedUntil">, now: Date): boolean {
  return row.reservedUntil === null || row.reservedUntil.getTime() > now.getTime();
}

/**
 * A new sitting, scoped to the address's registration its one link will name, with its reservation
 * deadline written once (§543): `reservedUntil`, which nothing moves afterwards. `id`, when given, is
 * the random id the browser's half already carries (a first form that wrote nothing, whose «Da» took a
 * hold under it, `family_place_holds`): the sitting then adopts that hold by its key.
 */
export async function openSitting<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  values: { id?: string; eventId: string; participantId: string; registrationId: string; locale: Locale; heldUntil: Date; reservedUntil: Date; now: Date },
): Promise<FamilySitting> {
  const [row] = await tx
    .insert(familySittings)
    .values({
      ...(values.id ? { id: values.id } : {}),
      reservedUntil: values.reservedUntil,
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
      // Another adult's row keeps no fitness statement of theirs (§421, §543): the press asks the holder's tick.
      fitnessDeclaredAt: registrations.fitnessDeclaredAt,
      // The family's reservation (§543): the email and its page say each person's place.
      holdExpiresAt: registrations.holdExpiresAt,
    })
    .from(registrations)
    .where(and(inArray(registrations.id, [...sitting.registrationIds]), eq(registrations.status, "PENDING_EMAIL_CONFIRMATION")))
    .orderBy(asc(registrations.createdAt), asc(registrations.id));
}

/**
 * The idempotency key of a sitting's one family message: one per sitting, whatever happens. A sitting
 * holds its family message until «Gata» or its window, and takes no form after either, so a second
 * family message of one sitting is never needed — and a family email's button is never superseded.
 */
export function familySittingMessageKey(sittingId: string): string {
  return `family-sitting:${sittingId}`;
}

/**
 * Whether a message of the sitting is still to leave or leaving (§519, §536): the same person sent
 * again in the sitting is then told by it, and nothing more is queued. When nothing of the sitting is
 * waiting — «Da» came after the first form's email had left — the form is an ordinary re-send.
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
 * A held row's payload with the instant it is let go (`FAMILY_HELD_UNTIL`, §623), written in the same
 * statement as every not-before the family's path sets — the hold, its move, «Gata» — so the two never
 * disagree. Only here: the outbox's own writes (a retry, a pause, a deferral) leave it as it is.
 */
function withHeldUntil(at: Date) {
  return sql`${emailOutbox.payloadJson} || ${JSON.stringify(familyHeldUntil(at))}::jsonb`;
}

/**
 * After each form of the sitting (§519), under the event's lock: the window moves to `heldUntil`,
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
      // `FAMILY_HELD` (§540): held until «Gata» or the window, the queue panel (§529) counts it as the
      // family's hold, not as a retry. The renderer ignores the flag on this message.
      payload: { familySittingId: sitting.id, [FAMILY_HELD]: true, ...familyHeldUntil(heldUntil) },
      idempotencyKey: key,
      now,
      notBefore: heldUntil,
    });
    const familyId =
      queued?.id ?? (await tx.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)).limit(1))[0]?.id;
    const replaced = held.filter((id) => id !== familyId);
    // Only rows still waiting and never tried: a message that has left is not taken back. A row Mailgun
    // stopped goes too (§622): the stop is recorded apart from it (`platform_settings.mailgunStop`), so
    // deleting it ends no pause, and keeping it would send the person both it and the family message.
    if (replaced.length > 0) {
      await tx
        .delete(emailOutbox)
        .where(and(inArray(emailOutbox.id, replaced), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0)));
    }
    held = familyId ? [familyId] : [];
  }

  if (held.length > 0) {
    // A row Mailgun stopped keeps its turn (§622): held to the sitting's window, its pause would be stretched to it.
    await tx
      .update(emailOutbox)
      .set({ nextAttemptAt: heldUntil, payloadJson: withHeldUntil(heldUntil) })
      .where(and(inArray(emailOutbox.id, held), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0), notHeldByMailgun()));
  }
  const expiresAt =
    sittingLinkExpiresAt([...pending.map((row) => row.emailLinkExpiresAt), ...entries.map((entry) => entry.expiresAt), sitting.expiresAt, heldUntil], now) ?? heldUntil;
  await tx.update(familySittings).set({ heldOutboxIds: held, heldUntil, expiresAt }).where(eq(familySittings.id, sitting.id));
}

/**
 * «Gata» (§519): what the sitting holds leaves now, and the sitting takes no more forms. Pressed
 * twice, or after the window, it does nothing. The id comes from the browser's sealed half; a
 * sitting that held nothing — a re-send about a registration outside it went at once, or «Da» came
 * after the first form's email had left — has nothing to release, and the screen after it says the
 * same either way (§39).
 */
export async function releaseFamilySitting<T extends Record<string, unknown>>(db: Database<T>, sittingId: string, now: Date): Promise<void> {
  if (!isUuid(sittingId)) return;
  const released = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(familySittings).where(eq(familySittings.id, sittingId)).limit(1).for("update");
    if (!row || row.releasedAt !== null || row.confirmedAt !== null) return false;
    if (row.heldOutboxIds.length > 0) {
      // «Gata» does not end a pause Mailgun asked for (§622): a row carrying the stop's mark keeps its turn.
      await tx
        .update(emailOutbox)
        // Let go now: the release instant the public notice counts a wait from (§623).
        .set({ nextAttemptAt: now, payloadJson: withHeldUntil(now) })
        .where(and(inArray(emailOutbox.id, [...row.heldOutboxIds]), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0), notHeldByMailgun()));
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
 * «Da, încă o persoană» (§519; §536: the press that opens the sitting). A press, never a link.
 *
 * - The browser's half names a sitting still taking forms (a «Da» after the second form, or pressed
 *   twice): its window starts again from this press, as it does from every form sent — the row's
 *   `held_until` and every message it still holds, together (the review of 2026-09-27: the window
 *   lapsed under the parent's hands while the next form was open).
 * - Otherwise, the first form's seed (`SittingSeed`): the sitting is opened now, with the first
 *   form's registration or kept form in it, and that form's message held until the window's end
 *   when it has not left yet. When it has left, nothing is taken back: the family message the next
 *   form queues names that person too, and its one button confirms everybody (§519).
 *
 * A sitting already sent, confirmed or past its window, and a seed that no longer names a waiting
 * registration or a live kept form of this event, are left as they are: the next form is the
 * ordinary one, and opens a sitting of its own. Returns the sitting that takes the next form, and
 * whether this press opened it (§543: only the opening press reserves a place), or null. The ids come
 * from the browser's sealed half; nothing is said back (§39).
 */
export async function continueFamilySitting<T extends Record<string, unknown>>(
  db: Database<T>,
  press: { sittingId: string | null; seed: SittingSeed | null; eventId: string; locale: Locale },
  heldUntil: Date,
  now: Date,
  /** The deadline a sitting this press opens is given (§543): the first form's window and the club's hold. Written once. */
  reservedUntil: Date,
): Promise<{ sittingId: string; opened: boolean } | null> {
  return db.transaction(async (tx) => {
    if (press.sittingId && isUuid(press.sittingId)) {
      const [row] = await tx.select().from(familySittings).where(eq(familySittings.id, press.sittingId)).limit(1).for("update");
      if (
        row &&
        row.eventId === press.eventId &&
        row.releasedAt === null &&
        row.confirmedAt === null &&
        row.heldUntil.getTime() > now.getTime() &&
        // Past its fixed deadline a sitting takes no more forms (§543): the press does not hold its email back either.
        reservationStillAhead(row, now)
      ) {
        if (row.heldOutboxIds.length > 0) {
          await tx
            .update(emailOutbox)
            .set({ nextAttemptAt: heldUntil, payloadJson: withHeldUntil(heldUntil) })
            .where(and(inArray(emailOutbox.id, [...row.heldOutboxIds]), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0), notHeldByMailgun()));
        }
        await tx
          .update(familySittings)
          .set({ heldUntil, expiresAt: row.expiresAt.getTime() < heldUntil.getTime() ? heldUntil : row.expiresAt })
          .where(eq(familySittings.id, row.id));
        return { sittingId: row.id, opened: false };
      }
    }
    return press.seed ? openSittingFromSeed(tx, press.seed, { eventId: press.eventId, locale: press.locale, heldUntil, reservedUntil, now }) : null;
  });
}

/** A live sitting of this event, not sent and not confirmed, still taking forms — before its fixed deadline (§543). */
function liveSittingWhere(eventId: string, now: Date) {
  return and(
    eq(familySittings.eventId, eventId),
    isNull(familySittings.releasedAt),
    isNull(familySittings.confirmedAt),
    gt(familySittings.heldUntil, now),
    or(isNull(familySittings.reservedUntil), gt(familySittings.reservedUntil, now)),
  );
}

/**
 * The first form's message, held until the window's end (§536) — only while it is still waiting and
 * never tried, and only the one the seed named for this registration. Null when it has left. A row
 * Mailgun paused is still returned, so the sitting tracks it, but keeps its turn and goes unmarked (§622).
 *
 * The message taken in is marked held here, and only here — the first form queued it unmarked, so a
 * first form nobody pressed «Da» after reads as what it was:
 *
 * - a verification email with `SITTING_HELD` (the review of 2026-09-28, nit F1): its link's life is
 *   then counted from the send, as for any held one;
 * - a kept form's `REGISTER_ANOTHER_PERSON` with `FAMILY_HELD` (the review of 2026-09-28, round two):
 *   the queue panel (§529, `notifications/queue.ts`) then counts it as the family's hold, with its
 *   «Ținut până …» line, not as a retry. The renderer ignores the flag on that message; `SITTING_HELD`
 *   is never reused for it, since it changes a verification link's life.
 */
async function holdSeedMessage<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  outboxId: string | null,
  registrationId: string,
  heldUntil: Date,
  mark: typeof SITTING_HELD | typeof FAMILY_HELD,
): Promise<string | null> {
  if (!outboxId || !isUuid(outboxId)) return null;
  const waiting = and(eq(emailOutbox.id, outboxId), eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.status, "PENDING"), eq(emailOutbox.attemptCount, 0));
  // Tracked whether or not Mailgun paused it (§622, the review of round three): a paused seed still
  // lands in `heldOutboxIds`, so the family message replaces it and the address gets one message.
  const [row] = await tx.select({ id: emailOutbox.id }).from(emailOutbox).where(waiting).limit(1).for("update");
  if (!row) return null;
  // Held and marked only when no provider's stop is on it: its turn is then Mailgun's pause, left alone.
  await tx
    .update(emailOutbox)
    .set({
      nextAttemptAt: heldUntil,
      payloadJson: sql`${emailOutbox.payloadJson} || ${JSON.stringify({ [mark]: true, ...familyHeldUntil(heldUntil) })}::jsonb`,
    })
    .where(and(waiting, notHeldByMailgun()));
  return row.id;
}

/** The sitting «Da» opens from the first form (§536): its registration or kept form, and its message while still waiting. */
async function openSittingFromSeed<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  seed: SittingSeed,
  at: { eventId: string; locale: Locale; heldUntil: Date; reservedUntil: Date; now: Date },
): Promise<{ sittingId: string; opened: boolean } | null> {
  const { eventId, locale, heldUntil, reservedUntil, now } = at;
  if (!isUuid(seed.id)) return null;
  if (seed.kind === "registration") {
    const [registration] = await tx
      .select({ id: registrations.id, eventId: registrations.eventId, participantId: registrations.participantId, status: registrations.status, emailLinkExpiresAt: registrations.emailLinkExpiresAt })
      .from(registrations)
      .where(eq(registrations.id, seed.id))
      .limit(1)
      .for("update");
    if (!registration || registration.eventId !== eventId || registration.status !== "PENDING_EMAIL_CONFIRMATION") return null;
    // Pressed twice on one seed (two tabs): the sitting the first press opened.
    const [already] = await tx
      .select({ id: familySittings.id })
      .from(familySittings)
      .where(and(liveSittingWhere(eventId, now), sql`${familySittings.registrationIds} @> ${JSON.stringify([registration.id])}::jsonb`))
      .limit(1);
    if (already) return { sittingId: already.id, opened: false };
    const sitting = await openSitting(tx, { eventId, participantId: registration.participantId, registrationId: registration.id, locale, heldUntil, reservedUntil, now });
    const outboxId = await holdSeedMessage(tx, seed.outboxId, registration.id, heldUntil, SITTING_HELD);
    await holdInSitting(tx, sitting, { registrationId: registration.id, outboxId });
    const expiresAt = sittingLinkExpiresAt([registration.emailLinkExpiresAt, heldUntil], now) ?? heldUntil;
    await tx.update(familySittings).set({ expiresAt }).where(eq(familySittings.id, sitting.id));
    return { sittingId: sitting.id, opened: true };
  }
  const [entry] = await tx.select().from(pendingFamilyEntries).where(eq(pendingFamilyEntries.id, seed.id)).limit(1).for("update");
  if (!entry || entry.eventId !== eventId || entry.expiresAt.getTime() <= now.getTime()) return null;
  if (entry.sittingId !== null) {
    const [already] = await tx.select({ id: familySittings.id }).from(familySittings).where(and(eq(familySittings.id, entry.sittingId), liveSittingWhere(eventId, now))).limit(1);
    return already ? { sittingId: already.id, opened: false } : null;
  }
  // Scoped, as a kept form's own sitting always was, to the registration the address already holds here.
  const sitting = await openSitting(tx, { eventId, participantId: entry.participantId, registrationId: entry.registrationId, locale, heldUntil, reservedUntil, now });
  await tx.update(pendingFamilyEntries).set({ sittingId: sitting.id }).where(eq(pendingFamilyEntries.id, entry.id));
  const outboxId = await holdSeedMessage(tx, seed.outboxId, entry.registrationId, heldUntil, FAMILY_HELD);
  await holdInSitting(tx, sitting, { outboxId });
  const expiresAt = sittingLinkExpiresAt([entry.expiresAt, heldUntil], now) ?? heldUntil;
  await tx.update(familySittings).set({ expiresAt }).where(eq(familySittings.id, sitting.id));
  return { sittingId: sitting.id, opened: true };
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
        .set({ nextAttemptAt: releaseAt, payloadJson: withHeldUntil(releaseAt) })
        .where(
          and(
            or(eq(emailOutbox.idempotencyKey, key), like(emailOutbox.idempotencyKey, `${key}:club-copy:%`)),
            eq(emailOutbox.status, "PENDING"),
            eq(emailOutbox.attemptCount, 0),
            notHeldByMailgun(),
          ),
        );
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
    payload: { familySittingId: sitting.id, ...familyHeldUntil(releaseAt) },
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
 *
 * The links only (§543, the review of 2026-09-28, round three): the family's reserved places keep the
 * sitting's fixed deadline, which this send does not move, late or on time.
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
 * Whether somebody the family message names already got an email of their own that left before
 * «Da» took them in (§536): «Da» came after the first form's email had gone — its verification
 * email, or the kept form's link of §446. That email's button still works for that one person; the
 * family message then says in one line that its own button covers them too, so the parent does not
 * wonder which to press. Only people the family message still names (`sittingPeople`), and only an
 * email that has left (`SENT`).
 */
export async function sittingEarlierEmailSent<T extends Record<string, unknown>>(
  db: Database<T>,
  people: { registrationIds: readonly string[]; entryIds: readonly string[] },
): Promise<boolean> {
  const byRegistration =
    people.registrationIds.length > 0
      ? and(eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL"), inArray(emailOutbox.registrationId, [...people.registrationIds]))
      : undefined;
  const byEntry =
    people.entryIds.length > 0
      ? and(eq(emailOutbox.messageType, "REGISTER_ANOTHER_PERSON"), inArray(sql<string>`${emailOutbox.payloadJson}->>'familyEntryId'`, [...people.entryIds]))
      : undefined;
  const which = byRegistration && byEntry ? or(byRegistration, byEntry) : (byRegistration ?? byEntry);
  if (!which) return false;
  const [row] = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "SENT"), which))
    .limit(1);
  return row !== undefined;
}

/**
 * The sittings nobody can act on any more, deleted by the registration maintenance job (§519), as the
 * kept forms are. The rows hold ids and instants, never a name; a kept form they pointed at stays
 * until its own lapse (`sitting_id` is set to null).
 */
export async function purgeLapsedFamilySittings<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const gone = await db.delete(familySittings).where(lte(familySittings.expiresAt, now)).returning({ id: familySittings.id });
  /*
    …and the sittings' place holds (§543) a day past their deadline: counted by nobody since it, and
    left that long so the per-event sweep (`expireStaleHolds`) still finds a fresh lapse and offers the
    place to whoever waits, as it does for a lapsed reservation.
  */
  await db.delete(familyPlaceHolds).where(lte(familyPlaceHolds.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));
  return gone.length;
}
