import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { lastCallDeadline, lastCallKey, windowLastCallAt } from "@/modules/notifications/domain/automatic-sends";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { confirmationWindow } from "./domain/hold-deadlines";
import { RECENT_DECLARATION_EMAIL_MS } from "./domain/resend";
import { type WindowedEvent, windowHoldInstant, windowHoldMoves, windowHoldTarget } from "./domain/window-holds";
import { lockEventForCapacity } from "./repository";

/**
 * A changed participation window moves the holds it gave (§NNN, amending §104, §407) — the half that
 * writes. The rules are `domain/window-holds.ts`; this reads the event's `PENDING_DECLARATION` rows
 * under the event lock and moves the ones those rules name, in the caller's transaction (the editor's
 * save), so the window and the holds it gave commit together or not at all.
 *
 * **No overbooking (AGENTS.md §10.6).** Only `hold_expires_at` changes, compare-and-set on the value
 * read, under `lockEventForCapacity` — the lock every allocation takes. Nobody is seated, released or
 * offered a place, and no place is added: a hold whose deadline moved still counts its place
 * (`countOccupied` takes a declaration hold by its status), and a moved hold that lapses is released
 * only when somebody waits for it (§160), by the job's `expireStaleHolds`, untouched here. `kind`
 * appears in no condition (§30). A waiting-list offer is not a declaration hold and is not read.
 */

/** The key of the declaration email a move sends inside an open window: one per registration and new deadline. */
export function deadlineMovedKey(registrationId: string, to: Date): string {
  return `registration:${registrationId}:deadline-moved:${to.toISOString()}`;
}

/**
 * The key the move's email goes under (§NNN). When the new deadline's last call (`windowLastCallAt`) is
 * already due, or due within the hour §606 keeps between two declaration emails, the move's email IS
 * that last call: it goes under the job's own key for the new deadline (`lastCallKey`), so the job finds
 * it queued and the person gets one email, not two identical ones minutes apart. Otherwise its own key.
 */
export function movedEmailKey(registrationId: string, after: WindowedEvent, to: Date, now: Date, lastCallHours: number): string {
  const candidate = { ...after, holdExpiresAt: to, reminderHoursBefore: null };
  const lastCallAt = lastCallDeadline(candidate) ? windowLastCallAt(after, { lastCallHours }) : null;
  if (lastCallAt && lastCallAt.getTime() <= now.getTime() + RECENT_DECLARATION_EMAIL_MS) return lastCallKey(registrationId, candidate);
  return deadlineMovedKey(registrationId, to);
}

/** What a save did to the holds of one event: the real rows moved, the test ones apart (§12.6), the instant, the emails queued. */
export type WindowHoldsMoved = {
  moved: number;
  test: number;
  /** Where they went; null when nothing moved. Every row of one event goes to the same instant. */
  to: Date | null;
  /** Declaration emails queued because the window was already open (real and test alike: each is a message). */
  queued: number;
};

const NOTHING: WindowHoldsMoved = { moved: 0, test: 0, to: null, queued: 0 };

type EventRow = Pick<typeof events.$inferSelect, "id" | "startsAt" | "confirmationOpensDaysBefore" | "confirmationDeadlineDaysBefore" | "registrationClosesAt" | "eventStatus" | "registrationMode">;

/** The event's waiting signatures, with what the move and its email need. */
async function heldRowsOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string) {
  return db
    .select({
      id: registrations.id,
      holdExpiresAt: registrations.holdExpiresAt,
      kind: registrations.kind,
      participantId: registrations.participantId,
      locale: registrations.locale,
      deliveryEmail: participants.deliveryEmail,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "PENDING_DECLARATION")));
}

/**
 * Move the holds of one event to what its window now says, in the save's transaction, after the event
 * row was written. `before` is the row as it stood before the save (the start the holds were given
 * against, and the old window), `after` as the save wrote it.
 *
 * Writes, per moved row: the new `hold_expires_at` (compare-and-set), its live declaration link in
 * lockstep (below), and one audit row `registration.hold_moved_by_window` (from, to, who saved); per
 * event, when anything moved, one `event.holds_moved_by_window` (how many, real and test apart, to
 * when). When the window is already open, each moved row is sent the declaration email once more — its
 * words state the new deadline — through the outbox (`movedEmailKey`, so a retried save sends nothing
 * twice, and a move past the new deadline's last call is that last call), unless its own declaration
 * email is still waiting to leave (it renders the stored deadline when it does) or left within the hour. Before the window opens nothing is sent: the window's own ask (§104) says the new
 * deadline on its day. The caller drains the outbox once after the commit when `queued` is above zero.
 *
 * A scheduled event with internal registration only: a cancelled event's queue is left as it was
 * cancelled (§331), and a save that puts it back on aligns its holds then.
 */
export async function moveWindowHolds<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: {
    actorStaffUserId: string;
    /** The event as it stood before the save: the start and window the holds were given against, and its registration close. */
    before: WindowedEvent & { registrationClosesAt: Date | null };
    after: EventRow;
    now: Date;
    deadlines: Pick<Deadlines, "holdMinutes" | "lastCallHours">;
  },
): Promise<WindowHoldsMoved> {
  const { after, now } = input;
  const { holdMinutes, lastCallHours } = input.deadlines;
  if (after.eventStatus !== "SCHEDULED" || after.registrationMode !== "INTERNAL") return NOTHING;
  if (!windowHoldTarget(after, now, holdMinutes)) return NOTHING;
  await lockEventForCapacity(tx, after.id);
  const rows = await heldRowsOf(tx, after.id);
  if (rows.length === 0) return NOTHING;
  const moves = windowHoldMoves({
    holds: rows,
    before: input.before,
    after,
    now,
    holdMinutes,
    registrationClosesAt: after.registrationClosesAt,
  });
  if (moves.length === 0) return NOTHING;

  const byId = new Map(rows.map((row) => [row.id, row]));
  const window = confirmationWindow(after);
  const windowOpen = window !== null && now.getTime() >= window.opensAt.getTime();
  /*
    A declaration email of the row's own still waiting to leave — it will say the moved deadline when it
    does — or one that left within the hour (§606's RECENT_DECLARATION_EMAIL_MS): a last call that went a
    minute before the save is not followed by a second, identical one.
  */
  const since = new Date(now.getTime() - RECENT_DECLARATION_EMAIL_MS);
  const waitingToLeave = windowOpen
    ? new Set(
        (
          await tx
            .select({ registrationId: emailOutbox.registrationId })
            .from(emailOutbox)
            .where(
              and(
                inArray(
                  emailOutbox.registrationId,
                  moves.map((move) => move.id),
                ),
                sql`${emailOutbox.participantId} is not null`,
                eq(emailOutbox.messageType, "COMPLETE_DECLARATION"),
                or(inArray(emailOutbox.status, ["PENDING", "PROCESSING"]), gte(emailOutbox.sentAt, since)),
              ),
            )
        ).map((row) => row.registrationId),
      )
    : new Set<string | null>();

  let moved = 0;
  let test = 0;
  let queued = 0;
  let to: Date | null = null;
  for (const move of moves) {
    const row = byId.get(move.id);
    if (!row) continue;
    const written = await tx
      .update(registrations)
      .set({ holdExpiresAt: move.to, updatedAt: now })
      .where(and(eq(registrations.id, move.id), eq(registrations.status, "PENDING_DECLARATION"), eq(registrations.holdExpiresAt, move.from)))
      .returning({ id: registrations.id });
    if (written.length === 0) continue;
    await moveDeclarationLink(tx, move.id, { from: move.from, to: move.to, startBefore: input.before.startsAt, startAfter: after.startsAt });
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actorStaffUserId,
      participantId: row.participantId,
      action: "registration.hold_moved_by_window",
      entityType: "registration",
      entityId: move.id,
      metadata: { from: move.from.toISOString(), to: move.to.toISOString() },
      now,
    });
    if (row.kind === "TEST") test += 1;
    else moved += 1;
    to = move.to;
    if (windowOpen && !waitingToLeave.has(move.id)) {
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: move.id,
        messageType: "COMPLETE_DECLARATION",
        locale: row.locale,
        recipientEmail: row.deliveryEmail,
        payload: {},
        idempotencyKey: movedEmailKey(move.id, after, move.to, now, lastCallHours),
        requestedByStaffUserId: input.actorStaffUserId,
        // One drain for the whole save, after its commit, never one per row (§606's discipline).
        drainAfter: false,
        now,
      });
      if (inserted) queued += 1;
    }
  }
  if (moved + test === 0) return NOTHING;
  // The event's row: who saved, how many, to when — never a name.
  await recordAuditEvent(tx, {
    actorStaffUserId: input.actorStaffUserId,
    action: "event.holds_moved_by_window",
    entityType: "event",
    entityId: after.id,
    metadata: { moved, test, to: to?.toISOString() ?? null, queued },
    now,
  });
  return { moved, test, to, queued };
}

/**
 * The declaration link in lockstep with its hold (§657's `moveTokenWith` discipline): only a token
 * unused and not replaced, and only one whose `expires_at` is exactly the instant it was minted to end
 * with. Since §160 the link the renderer mints lives until the event's start, not until the hold, so it
 * follows the start — moved only when the save moved the start. A link that ended with the hold itself
 * (one minted before §160) follows the hold, unless that hold was the start (then it is the start's).
 */
async function moveDeclarationLink<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  registrationId: string,
  move: { from: Date; to: Date; startBefore: Date; startAfter: Date },
): Promise<void> {
  const live = (at: Date) =>
    and(
      eq(emailActionTokens.registrationId, registrationId),
      eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"),
      isNull(emailActionTokens.usedAt),
      isNull(emailActionTokens.invalidatedAt),
      eq(emailActionTokens.expiresAt, at),
    );
  if (move.from.getTime() !== move.startBefore.getTime()) {
    await tx.update(emailActionTokens).set({ expiresAt: move.to }).where(live(move.from));
  }
  if (move.startBefore.getTime() !== move.startAfter.getTime()) {
    await tx.update(emailActionTokens).set({ expiresAt: move.startAfter }).where(live(move.startBefore));
  }
}

/**
 * What the editor's «Fereastra de confirmare» card says before a save (§NNN), from the move's own rules
 * on the window as stored: how many real reserved places a save would move now (held to another
 * window-given instant than the stored window's), how many hold the stored window's instant (and would
 * follow a changed window), and that instant. Null once that instant is behind and nothing would move:
 * a sentence saying places are held until a date gone by would be wrong. Test rows are counted nowhere
 * the club reads (§12.6). Reads only: GET mutates nothing.
 */
export async function previewWindowHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventRow,
  now: Date,
  holdMinutes: number,
): Promise<{ moveNow: number; atWindow: number; to: Date } | null> {
  if (event.eventStatus !== "SCHEDULED" || event.registrationMode !== "INTERNAL") return null;
  const target = windowHoldTarget(event, now, holdMinutes);
  if (!target) return null;
  const rows = (await heldRowsOf(db, event.id)).filter((row) => row.kind === "REAL");
  if (rows.length === 0) return null;
  const moveNow = windowHoldMoves({ holds: rows, before: event, after: event, now, holdMinutes, registrationClosesAt: event.registrationClosesAt }).length;
  const instant = windowHoldInstant(event).getTime();
  // A deadline already behind holds nothing the card could count down to: say nothing rather than a date gone by.
  if (moveNow === 0 && instant <= now.getTime()) return null;
  const atWindow = rows.filter((row) => row.holdExpiresAt?.getTime() === instant).length;
  return { moveNow, atWindow, to: moveNow > 0 ? target.to : new Date(instant) };
}
