import { and, eq, ne, sql } from "drizzle-orm";
import { emailOutbox, type EmailOutboxStatus } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import type { Coordinates } from "@/modules/event-checkpoints/domain/coordinates";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueEmail, OutboxMessageWithdrawn, type OutboxRow } from "@/modules/notifications/outbox";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { canonicalOrNull } from "./agreement";
import { readVolunteerPlanMaps } from "./plan";
import { coordinatesOf, listPlanPoints } from "./plan-points";

/*
  «Trimite fiecăruia punctul lui» (§956; the owner, 2026-11-16, with a picture of Saturday's route and its volunteers' points on
  it: «…si sa ii pot distribui din aplicatie, sa stie exact unde si cum» — and, asked how, «Email din site, la apăsarea ta»):
  one press on «Planul voluntarilor» emails each placed volunteer the point they stand at — its number in the route's order,
  its name, its kilometre and its note — what they do there, and the plan's pictures and links (`VOLUNTEER_POINT`, §978).

  **A point is any point of the plan (§961):** one of the event's «Puncte pe traseu», a point the organizers typed by hand on
  the plan's page, or a point at the start–finish — `plan-points.ts#listPlanPoints` is the one list of them, read here for
  who stands at a point and for what the message says of it. A person at the start–finish is counted, told and «already
  told» exactly as a person on the route is; their message says the place with no number and no kilometre. A point that has
  coordinates is said with them and a link to a map. Who «already knows their point» does not change when a point's name,
  kilometre or coordinates do: a person told before the coordinates were typed stays told, and «Trimite din nou tuturor» is
  how the organizers send the place.

  **Who is written to.** Every volunteer of the event who stands at one of its points, is not cancelled and has an address:
  one message each, in the language of their own row, queued through the outbox in the press's own transaction
  (BR-REQ-080-02). Nobody else: a person at no point, a cancelled one and a row with no address (§865) are counted for the
  question and written nothing; another event's people are never read. The press is the organizers' — whoever works the
  volunteers (`canManageVolunteers`), asked here whatever the action asked (BR-REQ-060-01) and before anything is read.

  **Not twice — the memory is the outbox's own rows, no column and no table.** Each message is one outbox row whose payload
  names the event, the volunteer, the point and the telling (`round`: 1 for the first message ever queued for the person, one
  more for each later one), and whose key is exactly that — `volunteer-point:<volunteer>:<point>:<round>` — so the database's
  unique key keeps one row a person, a point and a telling, whatever two presses do at once. Whether a person was «already
  told the point they stand at now» is read from their rows (`alreadyTold`):

  - their newest row still waits to leave (PENDING, PROCESSING), names the point they stand at and goes to the address the
    row holds now → told: it is on its way, and it says what is true when it leaves;
  - else the newest of their rows that left (SENT — or COMPLAINED, which reached the inbox) names that point at that
    address → told;
  - anything else → not told: no row at all; a row **withdrawn** at the send, which the outbox deletes; a row that **failed**
    for good or was **refused** by the receiving server (FAILED, BOUNCED), which never reached anybody; a message that named
    another point (the person was moved since) or went to an address corrected since.

  A press writes only to those not told. «Trimite din nou tuturor» writes to everybody again (the map was replaced, a point
  renamed), each with their next telling. An older row still waiting when the newer one is queued is withdrawn at the send
  (`volunteerPointAtSend`), so pressing again while a message waits makes one message, not two.

  **The one edge, known and left as it is.** That check reads the person's rows without a lock, so it holds for a row that
  has not started to render. A row the outbox was already sending when «din nou tuturor» committed the newer one — claimed,
  and past the check — is not called back: it leaves, and the newer one after it. Both were asked for by a press, and the
  second says what is true when it leaves. An ordinary press does not meet this: a row being sent that names the point the
  person stands at counts as told, so nothing is queued beside it.

  What this memory does not hold: the outbox keeps a message that left for ninety days and one about nobody's registration
  for ninety from its queueing (`jobs/retention.ts`) — a point told earlier than that is told again by the next press.

  **The state at the send, not at the press.** Everything the message says is read as it leaves (`notifications/render.ts`
  and `volunteerPointAtSend` below), and it is withdrawn when the person was cancelled or deleted, has no address or another
  one, stands at no point or at another point than the one queued, when the point is gone from the route, or when a newer
  message was queued for them while it still waited. Nobody is told by being placed, moved or taken off: no email leaves
  without the press.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** The four numbers the question before the press states, as the press itself would count them now. */
export type VolunteerPointCounts = {
  /** At a point, not cancelled, with an address, and not yet told the point they stand at: who an ordinary press writes to. */
  toWrite: number;
  /** At a point, with an address, and already told that point — sent, or queued and waiting to leave. */
  told: number;
  /** At a point and not cancelled, with no address (§865): on the plan only; the organizers tell them themselves. */
  noAddress: number;
  /** Not cancelled and at no point of the route. */
  unplaced: number;
};

/** What a press did: how many messages it queued, whether it wrote to everybody again, and the numbers it counted first. */
export type VolunteerPointsSent = VolunteerPointCounts & { queued: number; again: boolean };

/** One `VOLUNTEER_POINT` row of a volunteer, as the «already told» question reads it: never a word of the message. */
export type PointMailRow = { checkpointId: string | null; round: number; status: EmailOutboxStatus; recipientEmail: string };

/** A message that has not left yet: it may still leave, or be withdrawn at the send. */
const WAITING: ReadonlySet<EmailOutboxStatus> = new Set(["PENDING", "PROCESSING"]);
/** A message that reached the person: sent, or sent and then marked as spam by them. FAILED and BOUNCED reached nobody. */
const REACHED: ReadonlySet<EmailOutboxStatus> = new Set(["SENT", "COMPLAINED"]);

/** The telling a payload names: a whole number from 1, or 0 for anything else (a row no press of this file wrote). */
function roundOf(value: unknown): number {
  const round = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : 0;
  return Number.isInteger(round) && round > 0 ? round : 0;
}

/**
 * Whether a person was already told the point they stand at now (the rule at the top of this file): pure, from their own
 * `VOLUNTEER_POINT` rows. The address is compared through the canonicalizer (AGENTS.md §10.4), never as typed.
 */
export function alreadyTold(person: { checkpointId: string; canonicalEmail: string }, rows: readonly PointMailRow[]): boolean {
  const newestFirst = [...rows].sort((a, b) => b.round - a.round);
  const saysIt = (row: PointMailRow) => row.checkpointId === person.checkpointId && canonicalOrNull(row.recipientEmail) === person.canonicalEmail;
  const newest = newestFirst[0];
  // On its way: the newest row is the one that says where they stand — an older one still waiting is withdrawn at the send.
  if (newest && WAITING.has(newest.status) && saysIt(newest)) return true;
  const reached = newestFirst.find((row) => REACHED.has(row.status));
  return reached !== undefined && saysIt(reached);
}

/** The outbox key of one telling: one row a person, a point and a telling — the unique key is what keeps it one. */
export function volunteerPointKey(volunteerId: string, pointId: string, round: number): string {
  return `volunteer-point:${volunteerId}:${pointId}:${round}`;
}

type Standing = "unplaced" | "noAddress" | "told" | "toWrite";

type PlacedPerson = {
  id: string;
  email: string | null;
  canonicalEmail: string | null;
  locale: Locale;
  checkpointId: string | null;
  standing: Standing;
  /** The telling a message queued now would be: one more than the newest row the person has. */
  nextRound: number;
};

/** Every `VOLUNTEER_POINT` row of one volunteer — or of one event's volunteers — by the volunteer its payload names. */
async function pointRows<T extends Record<string, unknown>>(db: Database<T>, scope: { eventId: string } | { volunteerId: string }): Promise<Map<string, PointMailRow[]>> {
  const named = "eventId" in scope ? sql`${emailOutbox.payloadJson} ->> 'eventId' = ${scope.eventId}` : sql`${emailOutbox.payloadJson} ->> 'volunteerId' = ${scope.volunteerId}`;
  const rows = await db
    .select({
      status: emailOutbox.status,
      recipientEmail: emailOutbox.recipientEmail,
      volunteerId: sql<string | null>`${emailOutbox.payloadJson} ->> 'volunteerId'`,
      checkpointId: sql<string | null>`${emailOutbox.payloadJson} ->> 'checkpointId'`,
      round: sql<string | null>`${emailOutbox.payloadJson} ->> 'round'`,
    })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.messageType, "VOLUNTEER_POINT"), named));
  const byVolunteer = new Map<string, PointMailRow[]>();
  for (const row of rows) {
    if (!row.volunteerId) continue;
    const list = byVolunteer.get(row.volunteerId) ?? [];
    list.push({ checkpointId: row.checkpointId, round: roundOf(row.round), status: row.status, recipientEmail: row.recipientEmail });
    byVolunteer.set(row.volunteerId, list);
  }
  return byVolunteer;
}

/**
 * Everybody of one event who is not cancelled, each with where they stand for this message — and the four numbers. This
 * event's rows only: a volunteer is read by `event_id`, a point is held to the event's own, and the outbox rows by the
 * event their payload names.
 */
async function standingsOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ people: PlacedPerson[]; counts: VolunteerPointCounts }> {
  // Every point of the event's plan, whichever kind (§961): the one list the page and the message read too.
  const onPlan = new Set((await listPlanPoints(db, eventId)).map((point) => point.id));
  const volunteers = await db
    .select({ id: eventVolunteers.id, email: eventVolunteers.email, canonicalEmail: eventVolunteers.canonicalEmail, locale: eventVolunteers.locale, checkpointId: eventVolunteers.checkpointId })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.eventId, eventId), ne(eventVolunteers.state, "CANCELLED")));
  const rows = await pointRows(db, { eventId });
  const counts: VolunteerPointCounts = { toWrite: 0, told: 0, noAddress: 0, unplaced: 0 };
  const people = volunteers.map((volunteer): PlacedPerson => {
    const own = rows.get(volunteer.id) ?? [];
    const standing: Standing =
      volunteer.checkpointId === null || !onPlan.has(volunteer.checkpointId)
        ? "unplaced"
        : volunteer.email === null || volunteer.canonicalEmail === null
          ? "noAddress"
          : alreadyTold({ checkpointId: volunteer.checkpointId, canonicalEmail: volunteer.canonicalEmail }, own)
            ? "told"
            : "toWrite";
    counts[standing] += 1;
    return { ...volunteer, standing, nextRound: Math.max(0, ...own.map((row) => row.round)) + 1 };
  });
  return { people, counts };
}

function assertMayManage(actor: Pick<StaffUser, "role">): void {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not send the volunteers their points`);
}

/**
 * The numbers of the question before the press (§956): how many people «Trimite fiecăruia punctul lui» would write to now,
 * how many were already told the point they stand at, how many stand at a point with no address and how many stand at no
 * point yet — counted exactly as the press counts them. For whoever works the volunteers; anybody else is refused.
 */
export async function previewVolunteerPoints<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<VolunteerPointCounts> {
  assertMayManage(actor);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  return (await standingsOf(db, event.id)).counts;
}

/**
 * The press (§956): one `VOLUNTEER_POINT` for each volunteer of the event who stands at one of its points, is not cancelled,
 * has an address and was not yet told that point — or, with `again` («Trimite din nou tuturor»), for every one of them
 * whether told or not.
 *
 * - **Who:** `canManageVolunteers` (the Organizer and the Administrators), asked before anything is read; the Tehnic role,
 *   the Redactor, a desk Volunteer and a member are refused with nothing queued.
 * - **How:** in one transaction, under the event row's lock — the lock «Pune aici» and «Scoate» take
 *   (`volunteers.ts#changeVolunteer`), so a person being moved and a press wait in a line, and two presses never count the
 *   same people at once. Each row is queued in the language of the volunteer's own row, keyed by the person, the point and
 *   the telling; a key already there (a press that got in first) queues nothing and is not counted.
 * - **Nobody to write to:** refused with nothing written — `VOLUNTEER_POINTS_ALL_TOLD` when everybody at a point with an
 *   address was already told (the sentence says how to write again), `VOLUNTEER_POINTS_NOBODY` when nobody with an address
 *   stands at a point.
 * - **The trail:** one row a press, `event.volunteer_points_sent` — the event, the counts and whether it was «din nou
 *   tuturor»; never a person.
 */
export async function sendVolunteerPoints<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; again?: boolean },
  now: Date,
): Promise<VolunteerPointsSent> {
  assertMayManage(actor);
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const again = request.again === true;

  const sent = await db.transaction(async (tx): Promise<VolunteerPointsSent> => {
    // NO KEY UPDATE, as `setCheckpoint` takes it: a sign-up's foreign-key check is not made to wait for a send.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const { people, counts } = await standingsOf(tx, event.id);
    const recipients = people.filter((person) => person.standing === "toWrite" || (again && person.standing === "told"));
    if (recipients.length === 0) {
      throw counts.told > 0
        ? new DomainError("VOLUNTEER_POINTS_ALL_TOLD", "everybody who stands at a point and has an address was already told it")
        : new DomainError("VOLUNTEER_POINTS_NOBODY", "no volunteer with an address stands at a point of the route");
    }

    let queued = 0;
    for (const person of recipients) {
      // Both are there for a recipient (`standingsOf`); asked again so the compiler and a later edit agree.
      if (person.email === null || person.checkpointId === null) continue;
      const row = await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "VOLUNTEER_POINT",
        locale: person.locale,
        recipientEmail: person.email,
        // Ids and the telling: every word the message says is read when it leaves.
        payload: { eventId: event.id, volunteerId: person.id, checkpointId: person.checkpointId, round: person.nextRound },
        idempotencyKey: volunteerPointKey(person.id, person.checkpointId, person.nextRound),
        requestedByStaffUserId: actor.id,
        // A person already told, written to again because the press asked: a resend by hand, said so on the row.
        isManualResend: person.standing === "told",
        now,
        // One drain for the whole press, below, rather than one a row.
        drainAfter: false,
      });
      if (row) queued += 1;
    }

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteer_points_sent",
      entityType: "event",
      entityId: event.id,
      metadata: { queued, told: counts.told, noAddress: counts.noAddress, unplaced: counts.unplaced, again },
      now,
    });
    return { ...counts, queued, again };
  });
  // After the commit, as every press that queues: the rows are work for the outbox (§68).
  if (sent.queued > 0) drainOutboxAfterResponse();
  return sent;
}

/** What the message says about the point, as the template takes it (`notifications/templates.ts`, `TemplateData.volunteerPoint`). */
export type VolunteerPointFacts = {
  /** The point's place in the route's order, 1 for the first: the number the plan's page gives it. Null at the start–finish (§961). */
  number: number | null;
  nameRo: string;
  nameEn: string;
  /** Kilometres from the start; not said for a point at the start–finish. */
  km: number;
  noteRo: string | null;
  noteEn: string | null;
  /**
   * «Notă pentru voluntari» (§1009): what everybody standing at the point has to know, in each language — both or neither, line
   * breaks as `\n` — said as its own paragraph under the point's name, each half in its own language. Null for none.
   */
  volunteerNoteRo: string | null;
  volunteerNoteEn: string | null;
  /** A point at the start–finish, not on the route (§961): the message says the place with no number and no kilometre. */
  startFinish: boolean;
  /** Where the point is, when the organizers typed it (§961): the message says the numbers and links to a map. Null for none. */
  coordinates: Coordinates | null;
  /**
   * The plan's pictures (§978, amending §952's one), in the plan's order, each at a size for a message and whole, at the store's
   * public addresses; empty when the plan has none.
   */
  pictures: { displayUrl: string; fullUrl: string; width: number; height: number }[];
  /** The plan's links (§978), in the plan's order: the address, its label or null, and its host for a link with no label. */
  links: { url: string; label: string | null; host: string }[];
};

/**
 * The point a queued `VOLUNTEER_POINT` names, as it stands when the message leaves (§956, §331's rule at the send) — or the
 * message withdrawn (`OutboxMessageWithdrawn`: the outbox deletes the row, so the next press finds the person not told):
 *
 * - the person is gone, stands at no point, or stands at another point than the one the message was queued for (moved or
 *   taken off since, or the point deleted — which frees its people);
 * - the point is no longer on the event's plan;
 * - a newer message about their point was queued for them while this one still waited: the newer one is the one that leaves.
 *
 * The person's rows are read here without a lock: a message already past this check when a newer one is committed is not
 * called back, and both leave (the edge the head of this file names).
 *
 * The renderer has already withdrawn a cancelled person, a row with no address and an address corrected since
 * (`render.ts`); this reads only what is the point's — its number in the route's order, or none at the start–finish, its
 * name, its kilometre, where it is and its «Notă pentru voluntari» (§1009), from the plan's one list
 * (`plan-points.ts#listPlanPoints`, §961), which is what
 * the plan's page reads, so the message and the page say one point one way; the pictures and the links are the plan's as
 * they are now (`plan.ts#readVolunteerPlanMaps`, §978).
 */
export async function volunteerPointAtSend<T extends Record<string, unknown>>(db: Database<T>, row: Pick<OutboxRow, "payloadJson">): Promise<VolunteerPointFacts> {
  const payload = (row.payloadJson ?? {}) as { volunteerId?: unknown; checkpointId?: unknown; round?: unknown };
  const volunteerId = typeof payload.volunteerId === "string" && isUuid(payload.volunteerId) ? payload.volunteerId : null;
  const queuedFor = typeof payload.checkpointId === "string" && isUuid(payload.checkpointId) ? payload.checkpointId : null;
  if (volunteerId === null || queuedFor === null) throw new OutboxMessageWithdrawn("the message names no volunteer or no point");

  const [volunteer] = await db.select({ eventId: eventVolunteers.eventId, checkpointId: eventVolunteers.checkpointId }).from(eventVolunteers).where(eq(eventVolunteers.id, volunteerId)).limit(1);
  if (!volunteer) throw new OutboxMessageWithdrawn("the volunteer is gone");
  if (volunteer.checkpointId === null) throw new OutboxMessageWithdrawn("the volunteer stands at no point any more");
  if (volunteer.checkpointId !== queuedFor) throw new OutboxMessageWithdrawn("the volunteer stands at another point than the one this message was queued for");

  const round = roundOf(payload.round);
  const own = (await pointRows(db, { volunteerId })).get(volunteerId) ?? [];
  if (own.some((other) => other.round > round)) throw new OutboxMessageWithdrawn("a newer message about the volunteer's point was queued since");

  const point = (await listPlanPoints(db, volunteer.eventId)).find((one) => one.id === queuedFor);
  if (!point) throw new OutboxMessageWithdrawn("the point is no longer on the event's plan");
  const maps = await readVolunteerPlanMaps(db, volunteer.eventId);
  return {
    number: point.number,
    nameRo: point.nameRo,
    nameEn: point.nameEn,
    km: point.km,
    noteRo: point.noteRo,
    noteEn: point.noteEn,
    volunteerNoteRo: point.volunteerNoteRo,
    volunteerNoteEn: point.volunteerNoteEn,
    startFinish: point.startFinish,
    coordinates: coordinatesOf(point),
    pictures: maps.pictures.map(({ displayUrl, fullUrl, width, height }) => ({ displayUrl, fullUrl, width, height })),
    links: maps.links.map(({ url, label, host }) => ({ url, label, host })),
  };
}
