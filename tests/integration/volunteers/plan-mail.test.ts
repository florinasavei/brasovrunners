import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoleAssignments, eventVolunteers } from "@/db/schema/event-volunteers";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import { processOutboxBatch, OutboxMessageWithdrawn, type OutboxRow } from "@/modules/notifications/outbox";
import { createOutboxRenderer, renderOutboxMessage } from "@/modules/notifications/render";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { readVolunteerPlan, setVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { previewVolunteerPoints, sendVolunteerPoints, volunteerPointKey } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { PLAN_CONTACT_WORDS, PLAN_JUNCTION_NOTE, type PlanRace, planAddressOf, planVolunteer, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §956, BR-REQ-080-02, BR-REQ-060-01, BR-REQ-050-02 — «Trimite fiecăruia punctul lui» (the owner, 2026-11-16, with a picture
 * of Saturday's route and its volunteers' points on it: «…si sa ii pot distribui din aplicatie, sa stie exact unde si cum» —
 * and, asked how, «Email din site, la apăsarea ta»), from a real database:
 *
 * - **who:** one message for each volunteer of the event who stands at one of its points, is not cancelled and has an
 *   address, in the language of their own row, queued in the press's transaction — and for nobody else: not a person at no
 *   point, not a cancelled one, not a row with no address, never another event's people; the Tehnic role, the Redactor, a
 *   desk Volunteer and a member are refused with nothing queued;
 * - **not twice:** a second press writes to nobody already told; to a person placed or moved since, once; «Trimite din nou
 *   tuturor» to everybody. The memory is the outbox's own rows: a message that failed, was refused or was withdrawn told
 *   nobody;
 * - **the four numbers** of the question are the press's own count;
 * - **the trail:** one row a press — the event, the counts, whether «din nou tuturor» — never a person;
 * - **the message**, in both languages: the event and its day, the point's number, name, kilometre and note, the roles given
 *   and what they ask in the role message's own sentences (nothing about roles when none was given), the category's contact
 *   person, the plan's picture shown and linked when there is one, the event's page from `APP_BASE_URL` — and no other
 *   volunteer's name or telephone number;
 * - **the state at the send:** withdrawn for a person cancelled or deleted, with no address or another one, at no point or
 *   at another point, for a point gone from the route, and for an older telling that still waited when a newer one was queued;
 * - and nothing is queued by placing, moving or taking a person off.
 *
 * The page's question and the Server Action are `plan-mail-screens.test.ts`; the pure rule is `tests/unit/volunteers/point-mail.test.ts`.
 */
const state = vi.hoisted(() => ({ storage: true }));
// A store there or not, as a deployment without its bucket has none (`STORAGE_MODE`).
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/media/storage")>()),
  isStorageConfigured: () => state.storage,
}));

const NOW = new Date("2026-11-16T10:00:00.000Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  state.storage = true;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  race = await seedPlanRace(db, NOW);
});

const press = (actor: StaffUser, options: { again?: boolean; eventId?: string; now?: Date } = {}) =>
  sendVolunteerPoints(db, actor, { eventId: options.eventId ?? race.raceId, again: options.again }, options.now ?? NOW);
const preview = (actor: StaffUser = staff.MODERATOR!, eventId = race.raceId) => previewVolunteerPoints(db, actor, eventId);
const place = (id: string, checkpointId: string, now = NOW) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, now);

type Payload = { eventId: string; volunteerId: string; checkpointId: string; round: number };
const payloadOf = (row: OutboxRow) => row.payloadJson as Payload;
/** Every outbox row, whatever its type, oldest first. */
const outbox = () => db.select().from(emailOutbox).orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.idempotencyKey));
/** The point's messages — of one person when asked — in the order of their tellings. */
async function pointMails(volunteerId?: string): Promise<OutboxRow[]> {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_POINT"))) as OutboxRow[];
  return rows.filter((row) => volunteerId === undefined || payloadOf(row).volunteerId === volunteerId).sort((a, b) => payloadOf(a).round - payloadOf(b).round || a.recipientEmail.localeCompare(b.recipientEmail));
}
const mailOf = async (volunteerId: string, round = 1) => (await pointMails(volunteerId)).find((row) => payloadOf(row).round === round)!;
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "event.volunteer_points_sent");
/** A message as it left: marked sent, as the batch marks it. */
const markSent = (id: string, status: "SENT" | "FAILED" | "BOUNCED" | "COMPLAINED" = "SENT") =>
  db.update(emailOutbox).set({ status, sentAt: status === "FAILED" ? null : at(1), attemptCount: 1 }).where(eq(emailOutbox.id, id));
/** One message rendered as the outbox's batch renders it. */
const render = (row: OutboxRow, now = at(2)) => renderOutboxMessage({ ...row, status: "PROCESSING", lockedAt: now }, db, now);

/** A provider that takes everything and remembers what it was handed. */
function provider(): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return { outcome: "sent", providerMessageId: `id-${calls.length}` };
    },
  };
}
/** The outbox's own batch, with the real renderer: what leaves, and what is withdrawn and deleted. */
async function runOutbox(now = at(5)) {
  const mail = provider();
  await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now });
  return mail.calls;
}

/** A stored picture as an upload leaves it: a ladder's version-8 prefix (§414). */
async function storedPicture(width = 2400, height = 1600) {
  const [row] = await db
    .insert(mediaAssets)
    .values({ keyPrefix: ladderKeyPrefixOf(randomUUID()), originalFilename: "harta-cu-puncte.png", width, height, byteSize: 1000, createdAt: NOW, lastReferencedAt: NOW })
    .returning();
  return row;
}

const ADDRESS = { ana: planAddressOf("Ana Pop"), dan: planAddressOf("Dan Ene"), ion: planAddressOf("Ion Lupu"), radu: planAddressOf("Radu Liber"), eva: planAddressOf("Eva Stan"), mara: planAddressOf("Mara Dinu") };

describe("§956 «Trimite fiecăruia punctul lui»: who is written to", () => {
  it("queues one message for each person at a point who has an address, in the language of their own row — and for nobody else", async () => {
    const sent = await press(staff.MODERATOR!);
    expect(sent).toEqual({ toWrite: 3, told: 0, noAddress: 1, unplaced: 1, queued: 3, again: false });

    const rows = await outbox();
    // Nothing but the point's message is queued: no club copy, no notice, no other volunteer message.
    expect(rows.map((row) => row.messageType)).toEqual(["VOLUNTEER_POINT", "VOLUNTEER_POINT", "VOLUNTEER_POINT"]);
    const byAddress = new Map(rows.map((row) => [row.recipientEmail, row as OutboxRow]));
    // Ana, Dan and Ion — never Zoe (no address), Radu (at no point), Eva (cancelled) or Mara (another event's).
    expect([...byAddress.keys()].sort()).toEqual([ADDRESS.ana, ADDRESS.dan, ADDRESS.ion].sort());

    const expected = [
      { address: ADDRESS.ana, id: race.people.ana, point: race.points.junction, locale: "ro" },
      { address: ADDRESS.dan, id: race.people.dan, point: race.points.water, locale: "en" },
      { address: ADDRESS.ion, id: race.people.ion, point: race.points.bridge, locale: "ro" },
    ];
    for (const person of expected) {
      const row = byAddress.get(person.address)!;
      expect(row, person.address).toMatchObject({
        locale: person.locale,
        participantId: null,
        registrationId: null,
        status: "PENDING",
        attemptCount: 0,
        isManualResend: false,
        requestedByStaffUserId: staff.MODERATOR!.id,
        idempotencyKey: volunteerPointKey(person.id, person.point, 1),
      });
      // Ids and the telling, never a word of the message: everything said is read when it leaves.
      expect(row.payloadJson).toEqual({ eventId: race.raceId, volunteerId: person.id, checkpointId: person.point, round: 1 });
      expect(row.createdAt.getTime()).toBe(NOW.getTime());
    }
  });

  it("writes to an event's own people only: another event's press never reads this one's addresses", async () => {
    const sent = await press(staff.ADMIN!, { eventId: race.otherId });
    expect(sent).toEqual({ toWrite: 1, told: 0, noAddress: 0, unplaced: 0, queued: 1, again: false });
    const rows = await pointMails();
    expect(rows.map((row) => row.recipientEmail)).toEqual([ADDRESS.mara]);
    expect(payloadOf(rows[0])).toEqual({ eventId: race.otherId, volunteerId: race.people.mara, checkpointId: race.points.elsewhere, round: 1 });
    // …and this event's press tells nobody of the other: Mara is not written to again, nor counted.
    expect(await press(staff.ADMIN!)).toMatchObject({ queued: 3, toWrite: 3 });
    expect((await pointMails(race.people.mara)).length).toBe(1);
  });

  it("holds a point to the event's own: a row naming another event's point stands at none of this route's", async () => {
    // The column's foreign key is to any point; the service is what holds it to the event (as «Pune aici» does).
    await db.update(eventVolunteers).set({ checkpointId: race.points.elsewhere }).where(eq(eventVolunteers.id, race.people.ana));
    expect(await preview()).toEqual({ toWrite: 2, told: 0, noAddress: 1, unplaced: 2 });
    await press(staff.ADMIN!);
    expect(await pointMails(race.people.ana)).toEqual([]);
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member — nothing queued, nothing written (BR-REQ-060-01)", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      await expect(press(staff[role]!), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(press(staff[role]!, { again: true }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(preview(staff[role]!), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Refused before the event is so much as looked for: an address that names none answers the same.
      await expect(press(staff[role]!, { eventId: "not-an-id" }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(preview(staff[role]!, "11111111-1111-4111-8111-111111111111"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await outbox()).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("is the Organizer's and both Administrators' to press", async () => {
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      expect(await preview(staff[role]!), role).toEqual({ toWrite: 3, told: 0, noAddress: 1, unplaced: 1 });
    }
    expect(await press(staff.SUPERADMIN!)).toMatchObject({ queued: 3 });
  });

  it("is not there for an event that is not", async () => {
    for (const eventId of ["11111111-1111-4111-8111-111111111111", "not-an-id", ""]) {
      await expect(press(staff.ADMIN!, { eventId }), eventId).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(preview(staff.ADMIN!, eventId), eventId).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await outbox()).toEqual([]);
    expect(await trail()).toEqual([]);
  });

  it("refuses the press when nobody would be written to, with the reason: nobody with an address at a point", async () => {
    // Everybody with an address taken off their point: only Zoe, who has none, still stands at one.
    for (const id of [race.people.ana, race.people.dan, race.people.ion]) await place(id, "");
    expect(await preview()).toEqual({ toWrite: 0, told: 0, noAddress: 1, unplaced: 4 });
    await expect(press(staff.MODERATOR!)).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_NOBODY" });
    // «Din nou tuturor» has nobody to write to either.
    await expect(press(staff.MODERATOR!, { again: true })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_NOBODY" });
    expect(await outbox()).toEqual([]);
    expect(await trail()).toEqual([]);
  });
});

describe("§956 the four numbers of the question are the press's own count", () => {
  it("counts who is written to, who was already told, who has no address and who stands at no point — before and after a press", async () => {
    const before = await preview();
    expect(before).toEqual({ toWrite: 3, told: 0, noAddress: 1, unplaced: 1 });
    const sent = await press(staff.MODERATOR!);
    // The press answers the same four, and how many it queued.
    expect({ toWrite: sent.toWrite, told: sent.told, noAddress: sent.noAddress, unplaced: sent.unplaced }).toEqual(before);
    expect(await preview()).toEqual({ toWrite: 0, told: 3, noAddress: 1, unplaced: 1 });
    // A cancelled person is in none of the four, whatever point she keeps; cancel Dan and he leaves them too.
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, race.people.dan));
    expect(await preview()).toEqual({ toWrite: 0, told: 2, noAddress: 1, unplaced: 1 });
  });
});

describe("§956 not twice: the memory is the outbox's own rows", () => {
  it("queues nothing on a second press, and says why: everybody at a point was already told", async () => {
    await press(staff.MODERATOR!);
    await expect(press(staff.ADMIN!, { now: at(1) })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });
    expect(await pointMails()).toHaveLength(3);
    // The same once the messages left.
    for (const row of await pointMails()) await markSent(row.id);
    await expect(press(staff.ADMIN!, { now: at(2) })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });
    expect(await pointMails()).toHaveLength(3);
    // A refused press leaves no trail: only the first one did.
    expect(await trail()).toHaveLength(1);
  });

  it("writes once to a person placed since, and once to a person moved since — and to nobody else", async () => {
    await press(staff.MODERATOR!);
    for (const row of await pointMails()) await markSent(row.id);
    // Radu is placed at the bridge; Ana is moved from the junction to the water point.
    await place(race.people.radu, race.points.bridge, at(3));
    await place(race.people.ana, race.points.water, at(3));
    expect(await preview()).toEqual({ toWrite: 2, told: 2, noAddress: 1, unplaced: 0 });

    const second = await press(staff.ADMIN!, { now: at(4) });
    expect(second).toEqual({ toWrite: 2, told: 2, noAddress: 1, unplaced: 0, queued: 2, again: false });
    // Radu's first telling; Ana's second, for the point she stands at now.
    expect((await pointMails(race.people.radu)).map((row) => [payloadOf(row).checkpointId, payloadOf(row).round, row.status])).toEqual([[race.points.bridge, 1, "PENDING"]]);
    expect((await pointMails(race.people.ana)).map((row) => [payloadOf(row).checkpointId, payloadOf(row).round, row.status])).toEqual([
      [race.points.junction, 1, "SENT"],
      [race.points.water, 2, "PENDING"],
    ]);
    expect((await mailOf(race.people.ana, 2)).idempotencyKey).toBe(volunteerPointKey(race.people.ana, race.points.water, 2));
    // Dan and Ion, told and where they were: one message each, still.
    expect(await pointMails(race.people.dan)).toHaveLength(1);
    expect(await pointMails(race.people.ion)).toHaveLength(1);
    // …and a third press has nobody left.
    await expect(press(staff.ADMIN!, { now: at(5) })).rejects.toMatchObject({ code: "VOLUNTEER_POINTS_ALL_TOLD" });
  });

  it("writes to everybody again with «Trimite din nou tuturor», each with their next telling, marked as a resend", async () => {
    await press(staff.MODERATOR!);
    for (const row of await pointMails()) await markSent(row.id);
    // Radu placed since: not told yet, so he is written to either way — and his is no resend.
    await place(race.people.radu, race.points.bridge, at(3));

    const again = await press(staff.ADMIN!, { again: true, now: at(4) });
    expect(again).toEqual({ toWrite: 1, told: 3, noAddress: 1, unplaced: 0, queued: 4, again: true });
    for (const id of [race.people.ana, race.people.dan, race.people.ion]) {
      const rows = await pointMails(id);
      expect(rows.map((row) => [payloadOf(row).round, row.status, row.isManualResend]), id).toEqual([
        [1, "SENT", false],
        [2, "PENDING", true],
      ]);
      expect(rows[1].requestedByStaffUserId).toBe(staff.ADMIN!.id);
      // The same point, another telling: another key.
      expect(rows[1].idempotencyKey).toBe(volunteerPointKey(id, payloadOf(rows[0]).checkpointId, 2));
    }
    expect((await pointMails(race.people.radu)).map((row) => [payloadOf(row).round, row.isManualResend])).toEqual([[1, false]]);
    // Never the people an ordinary press leaves out.
    for (const address of [ADDRESS.eva, ADDRESS.mara]) expect((await outbox()).some((row) => row.recipientEmail === address)).toBe(false);
  });

  it("does not count a message that failed for good, or that the receiving server refused, as telling anybody: the next press writes again", async () => {
    await press(staff.MODERATOR!);
    await markSent((await mailOf(race.people.ana)).id, "FAILED");
    await markSent((await mailOf(race.people.dan)).id, "BOUNCED");
    await markSent((await mailOf(race.people.ion)).id, "SENT");
    expect(await preview()).toEqual({ toWrite: 2, told: 1, noAddress: 1, unplaced: 1 });

    const second = await press(staff.ADMIN!, { now: at(3) });
    expect(second).toMatchObject({ queued: 2, toWrite: 2, told: 1, again: false });
    expect((await pointMails(race.people.ana)).map((row) => [payloadOf(row).round, row.status])).toEqual([[1, "FAILED"], [2, "PENDING"]]);
    expect((await pointMails(race.people.dan)).map((row) => [payloadOf(row).round, row.status])).toEqual([[1, "BOUNCED"], [2, "PENDING"]]);
    expect(await pointMails(race.people.ion)).toHaveLength(1);
    // The new message is no resend: nothing reached them before.
    expect((await mailOf(race.people.ana, 2)).isManualResend).toBe(false);
  });

  it("does not count a message withdrawn at the send either: the outbox deletes it, and the next press queues the new one", async () => {
    await press(staff.MODERATOR!);
    // Before anything leaves, Ana is moved to the water point: her message names a point she no longer stands at.
    await place(race.people.ana, race.points.water, at(1));
    const left = await runOutbox(at(5));
    // Dan's and Ion's left; Ana's was withdrawn — sent to nobody, failed for nobody, gone.
    expect(left.map((message) => message.to).sort()).toEqual([ADDRESS.dan, ADDRESS.ion].sort());
    expect(await pointMails(race.people.ana)).toEqual([]);
    expect((await pointMails()).map((row) => row.status)).toEqual(["SENT", "SENT"]);

    expect(await preview()).toEqual({ toWrite: 1, told: 2, noAddress: 1, unplaced: 1 });
    expect(await press(staff.MODERATOR!, { now: at(6) })).toMatchObject({ queued: 1 });
    const [fresh] = await pointMails(race.people.ana);
    expect(payloadOf(fresh)).toEqual({ eventId: race.raceId, volunteerId: race.people.ana, checkpointId: race.points.water, round: 1 });
    // …and that one leaves, naming the point she stands at.
    const [message] = await runOutbox(at(10));
    expect(message.to).toBe(ADDRESS.ana);
    expect(message.text).toContain("Punctul tău la Crosul: 2. 5,5 km — Apă la cabană");
  });

  it("writes to the address the row holds now: a message that went to an address corrected since told nobody there", async () => {
    await press(staff.MODERATOR!);
    await markSent((await mailOf(race.people.ana)).id);
    expect((await preview()).told).toBe(3);
    await db.update(eventVolunteers).set({ email: "ana.noua@example.test", canonicalEmail: "ana.noua@example.test" }).where(eq(eventVolunteers.id, race.people.ana));
    expect(await preview()).toEqual({ toWrite: 1, told: 2, noAddress: 1, unplaced: 1 });
    await press(staff.ADMIN!, { now: at(3) });
    expect((await pointMails(race.people.ana)).map((row) => [row.recipientEmail, payloadOf(row).round])).toEqual([
      [ADDRESS.ana, 1],
      ["ana.noua@example.test", 2],
    ]);
  });

  // The promise is for a row that still waits: one the outbox was already sending when the newer one was queued is not
  // called back (`point-mail.ts`, «The one edge»).
  it("withdraws an older telling still waiting once a newer one is queued: pressing again while a message waits makes one message, not two", async () => {
    await press(staff.MODERATOR!);
    await press(staff.MODERATOR!, { again: true, now: at(1) });
    // Two rows wait for each person; the batch sends the newer and withdraws the older.
    expect((await pointMails()).map((row) => row.status)).toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING"]);
    const left = await runOutbox(at(5));
    expect(left.map((message) => message.to).sort()).toEqual([ADDRESS.ana, ADDRESS.dan, ADDRESS.ion].sort());
    expect((await pointMails()).map((row) => [payloadOf(row).round, row.status])).toEqual([[2, "SENT"], [2, "SENT"], [2, "SENT"]]);
  });

  it("withdraws a failed message put back in the queue once a newer one was queued for the person", async () => {
    await press(staff.MODERATOR!);
    const first = await mailOf(race.people.ana);
    await markSent(first.id, "FAILED");
    await press(staff.MODERATOR!, { now: at(1) });
    // «Reîncearcă emailurile eșuate» arms the failed row again: it must not leave beside the newer one.
    await db.update(emailOutbox).set({ status: "PENDING", attemptCount: 0, nextAttemptAt: null }).where(eq(emailOutbox.id, first.id));
    await expect(render({ ...first, status: "PENDING" })).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    const left = await runOutbox(at(5));
    expect(left.filter((message) => message.to === ADDRESS.ana)).toHaveLength(1);
    expect((await pointMails(race.people.ana)).map((row) => [payloadOf(row).round, row.status])).toEqual([[2, "SENT"]]);
  });
});

describe("§956 the trail of a press", () => {
  it("is one row a press: the event, the counts and whether «din nou tuturor» — never a person", async () => {
    await press(staff.MODERATOR!);
    await press(staff.ADMIN!, { again: true, now: at(1) });
    const rows = await trail();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "event.volunteer_points_sent", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(rows[0].metadataJson).toEqual({ queued: 3, told: 0, noAddress: 1, unplaced: 1, again: false });
    expect(rows[1]).toMatchObject({ actorStaffUserId: staff.ADMIN!.id, entityId: race.raceId });
    expect(rows[1].metadataJson).toEqual({ queued: 3, told: 3, noAddress: 1, unplaced: 1, again: true });
    // Numbers and a tick: no volunteer's id, name or address, no point's id or name.
    const written = JSON.stringify(rows.map((row) => row.metadataJson));
    for (const never of [...Object.values(race.people), ...Object.values(race.points), "Ana", "Dan", "Ion", "example.test", "Stejeriș", "cabană"]) expect(written, never).not.toContain(never);
  });
});

describe("§956 the message «Punctul tău de voluntar»", () => {
  const eventUrl = (locale: "ro" | "en") => `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: race.slug[locale] } } })}`;
  const halves = (text: string) => text.split("\n— — —\n");

  it("says a Romanian volunteer the event and its day, the point with its number, kilometre, name and note, the role given and what it asks, and whom to ask", async () => {
    await press(staff.MODERATOR!);
    const message = await render(await mailOf(race.people.ana));
    expect(message.to).toBe(ADDRESS.ana);
    expect(message.subject).toBe("Punctul tău de voluntar la Crosul / Your volunteer point at The cross");
    const [ro, en] = halves(message.text);

    // Romanian first: her row's language.
    expect(ro).toContain("Salut, Ana Pop,");
    // The point, on the band: the route's first by distance, though it was typed last.
    expect(ro).toContain("▶ Punctul tău la Crosul: 1. 1,2 km — Intersecția Stejeriș");
    // The event's day and place.
    expect(ro).toMatch(/Sâmbătă, 21 nov\. 2026, la 10:00 · Parcul central/);
    // The point's own note, as the club typed it.
    expect(ro).toContain(`De știut la acest punct\n${PLAN_JUNCTION_NOTE.ro}`);
    // The role given, named with its category, and what it asks — the role message's own sentence.
    expect(ro).toContain("Rolul tău: Direcționare (Traseu).");
    expect(ro).toContain("Ce presupune rolul: Arăți drumul pe traseu.");
    // Whom to ask: the contact person of the role's category.
    expect(ro).toContain(`Întrebări despre voluntariat? ${PLAN_CONTACT_WORDS}`);
    // The event's page, from APP_BASE_URL.
    expect(ro).toContain(eventUrl("ro"));
    expect(eventUrl("ro").startsWith(env.APP_BASE_URL)).toBe(true);

    // English after the rule: the same facts in the event's and the point's English words.
    expect(en).toContain("Hi Ana Pop,");
    expect(en).toContain("▶ Your point at The cross: 1. 1.2 km — Stejeriș junction");
    expect(en).toMatch(/Saturday, 21 Nov 2026, at 10:00 · Central park/);
    expect(en).toContain(`Good to know at this point\n${PLAN_JUNCTION_NOTE.en}`);
    expect(en).toContain("Your role: Guidance (Route).");
    expect(en).toContain("What the role involves: Show the way on the route.");
    expect(en).toContain(`Questions about volunteering? ${PLAN_CONTACT_WORDS}`);

    // The HTML says the same, the point on the highlighted band of each half.
    const bands = [...message.html.matchAll(/<div data-email-part="highlight"[^>]*>([^]*?)<\/div>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
    expect(bands).toEqual(["Punctul tău la Crosul: 1. 1,2 km — Intersecția Stejeriș", "Your point at The cross: 1. 1.2 km — Stejeriș junction"]);
    expect(message.html).toContain(`href="${eventUrl("ro")}"`);
    expect(message.html).toContain("Întrebări despre voluntariat? Călin Coordonator");
  });

  it("names no other volunteer, and no telephone number but the contact person's", async () => {
    await press(staff.MODERATOR!);
    const message = await render(await mailOf(race.people.ana));
    for (const whole of [message.text, message.html]) {
      // Zoe stands at the same point; Dan, Ion, Radu and Eva are the event's other people; Mara is another event's.
      for (const other of ["Zoe", "Manea", "Dan Ene", "Ion Lupu", "Radu", "Eva Stan", "Mara"]) expect(whole, other).not.toContain(other);
      for (const address of [ADDRESS.dan, ADDRESS.ion, ADDRESS.radu, ADDRESS.eva, ADDRESS.mara]) expect(whole, address).not.toContain(address);
      // Nobody's telephone number as the rows hold them — not even her own.
      expect(whole).not.toMatch(/\+407000000\d\d/);
    }
    // The one number in it is the contact person's, once a half.
    expect(message.text.match(/\+40(?: ?\d){9}/g)).toEqual(["+40 712 345 678", "+40 712 345 678"]);
  });

  it("says an English volunteer theirs English first, several roles by name with what each asks, and no note for a point that has none", async () => {
    await press(staff.MODERATOR!);
    const message = await render(await mailOf(race.people.dan));
    expect(message.to).toBe(ADDRESS.dan);
    expect(message.subject).toBe("Your volunteer point at The cross / Punctul tău de voluntar la Crosul");
    const [en, ro] = halves(message.text);
    expect(en).toContain("Hi Dan Ene,");
    expect(en).toContain("▶ Your point at The cross: 2. 5.5 km — Water at the hut");
    expect(en).toContain("Your roles: Guidance (Route), Water point.");
    expect(en).toContain("What each role involves: Guidance (Route) — Show the way on the route; Water point — Hand out water to the runners.");
    expect(en).toContain(eventUrl("en"));
    expect(ro).toContain("▶ Punctul tău la Crosul: 2. 5,5 km — Apă la cabană");
    expect(ro).toContain("Rolurile tale: Direcționare (Traseu), Punct de hidratare.");
    expect(ro).toContain("Ce presupune fiecare rol: Direcționare (Traseu) — Arăți drumul pe traseu; Punct de hidratare — Dai apă alergătorilor.");
    // The water point has no note: the label is not said over nothing.
    expect(message.text).not.toMatch(/De știut la acest punct|Good to know at this point/);
    // Of the two roles, one sits under a category with a contact person: said.
    expect(en).toContain(`Questions about volunteering? ${PLAN_CONTACT_WORDS}`);
  });

  it("says the roles exactly as the role's own message says them", async () => {
    // «Dă-i și rolul …» queues the role's message for Ana: its words about the role are the point's message's too.
    await changeVolunteer(db, staff.ADMIN!, { kind: "assign", eventId: race.raceId, id: race.people.ana, roleId: race.roles.water }, NOW);
    const [roleRow] = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_ROLE_ASSIGNED"))) as OutboxRow[];
    const roleMessage = await render(roleRow);
    await press(staff.MODERATOR!);
    const pointMessage = await render(await mailOf(race.people.ana));
    for (const sentence of [
      "Ce presupune fiecare rol: Direcționare (Traseu) — Arăți drumul pe traseu; Punct de hidratare — Dai apă alergătorilor.",
      "What each role involves: Guidance (Route) — Show the way on the route; Water point — Hand out water to the runners.",
    ]) {
      expect(roleMessage.text).toContain(sentence);
      expect(pointMessage.text).toContain(sentence);
    }
    // The roles' names, joined the same way in both.
    expect(roleMessage.text).toContain("Direcționare (Traseu), Punct de hidratare");
    expect(pointMessage.text).toContain("Rolurile tale: Direcționare (Traseu), Punct de hidratare.");
  });

  it("says nothing about roles to a person given none — and no contact person, having no role's category to ask", async () => {
    await press(staff.MODERATOR!);
    const message = await render(await mailOf(race.people.ion));
    expect(message.text).toContain("▶ Punctul tău la Crosul: 3. 7,25 km — Podul de lemn");
    expect(message.text).toContain("▶ Your point at The cross: 3. 7.25 km — The wooden bridge");
    expect(message.text).not.toMatch(/Rolul tău|Rolurile tale|Your roles?:|Ce presupune|What (the|each) role/);
    expect(message.text).not.toMatch(/Întrebări despre voluntariat|Questions about volunteering/);
    expect(message.html).not.toMatch(/Rolul tău|Your role/);
    // The words under the band read whole without them.
    expect(message.text).toContain("Mulțumim că ne ajuți la Crosul! Organizatorii te-au pus la un punct de pe traseu: e cel scris mai sus.");
  });

  it("shows the plan's picture and links to the whole of it when the event has one — and neither when it has none", async () => {
    await press(staff.MODERATOR!);
    const row = await mailOf(race.people.ana);
    const bare = await render(row);
    expect(bare.html).not.toContain('data-email-part="volunteer-plan-picture"');
    expect(bare.text).not.toMatch(/Planul voluntarilor pe traseu|The volunteers' plan on the route/);
    // The only picture of the message is the club's own banner.
    expect(bare.html.match(/<img /g)).toHaveLength(1);

    const stored = await storedPicture();
    await setVolunteerPlanPicture(db, staff.MODERATOR!, { eventId: race.raceId, assetId: stored.id }, at(1));
    const { picture } = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    expect(picture!.fullUrl).toMatch(/^https?:\/\//);

    // The same queued row, rendered when it leaves: the picture as the plan has it now.
    const message = await render(row);
    const parts = [...message.html.matchAll(/<div data-email-part="volunteer-plan-picture"[^>]*>([^]*?)<\/div>/g)].map((match) => match[1]);
    // One part a half: the picture itself once — in the first — and the link to the whole of it in both.
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain(`<a href="${picture!.fullUrl}"`);
    expect(parts[0]).toContain(`<img src="${picture!.displayUrl}" alt="Planul voluntarilor desenat pe traseu" width="550"`);
    expect(parts[0]).toContain("Deschide planul voluntarilor (poza întreagă)");
    expect(parts[1]).not.toContain("<img");
    expect(parts[1]).toContain(`<a href="${picture!.fullUrl}"`);
    expect(parts[1]).toContain("Open the volunteers' plan (the whole picture)");
    expect(message.html.match(/<img /g)).toHaveLength(2);
    // The text half names it with its address, in each language.
    expect(message.text).toContain(`Planul voluntarilor pe traseu, ca poză: ${picture!.fullUrl}`);
    expect(message.text).toContain(`The volunteers' plan on the route, as a picture: ${picture!.fullUrl}`);
    // The picture's address is the store's own, never a hostname written in the code.
    expect(picture!.displayUrl).toMatch(/\/1280w\.webp$/);

    // A picture narrower than the message's column is drawn at its own width.
    const small = await storedPicture(400, 300);
    await setVolunteerPlanPicture(db, staff.MODERATOR!, { eventId: race.raceId, assetId: small.id }, at(2));
    expect((await render(row)).html).toMatch(/<img src="[^"]+" alt="Planul voluntarilor desenat pe traseu" width="400"/);

    // Taken off again before the send: neither the picture nor the link.
    await setVolunteerPlanPicture(db, staff.MODERATOR!, { eventId: race.raceId, assetId: null }, at(3));
    expect((await render(row)).html).not.toContain('data-email-part="volunteer-plan-picture"');
    // …and where no store is configured there is no address to draw.
    await setVolunteerPlanPicture(db, staff.MODERATOR!, { eventId: race.raceId, assetId: stored.id }, at(4));
    state.storage = false;
    expect((await render(row)).html).not.toContain('data-email-part="volunteer-plan-picture"');
  });

  it("says the point as it stands when the message leaves: its name, its kilometre, its place in the route's order", async () => {
    await press(staff.MODERATOR!);
    const row = await mailOf(race.people.dan);
    // The water point renamed and moved up the route, and a new point typed before it, since the press.
    await db.update(eventCheckpoints).set({ nameRo: "Apă la izvor", nameEn: "Water at the spring", km: "6.00", noteRo: "Pahare în cutia albastră.", noteEn: "Cups in the blue box." }).where(eq(eventCheckpoints.id, race.points.water));
    await db.insert(eventCheckpoints).values({ eventId: race.raceId, km: "3.40", nameRo: "Poiana", nameEn: "The meadow", kinds: ["DIRECTION"], position: 9 });
    const message = await render(row);
    expect(message.text).toContain("▶ Your point at The cross: 3. 6 km — Water at the spring");
    expect(message.text).toContain("▶ Punctul tău la Crosul: 3. 6 km — Apă la izvor");
    expect(message.text).toContain("Good to know at this point\nCups in the blue box.");
    expect(message.text).not.toContain("Water at the hut");
  });

  it("is the one volunteer message that says the point: the role's own message never does", async () => {
    // Ana stands at the junction and is given a second role: the role's message names the roles, not where she stands.
    await changeVolunteer(db, staff.ADMIN!, { kind: "assign", eventId: race.raceId, id: race.people.ana, roleId: race.roles.water }, NOW);
    const [roleRow] = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_ROLE_ASSIGNED"))) as OutboxRow[];
    const roleMessage = await render(roleRow);
    for (const never of ["Intersecția Stejeriș", "Stejeriș junction", "Punctul tău", "Your point", PLAN_JUNCTION_NOTE.ro, "1,2 km"]) {
      expect(roleMessage.text, never).not.toContain(never);
      expect(roleMessage.html, never).not.toContain(never);
    }
  });
});

describe("§956 the state at the send, not at the press: the message is withdrawn", () => {
  const withdrawn = async (row: OutboxRow, reason: RegExp) => {
    const failure = await render(row).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(OutboxMessageWithdrawn);
    expect((failure as Error).message).toMatch(reason);
  };

  it("leaves untouched for a person still at the point, with the address the row holds", async () => {
    await press(staff.MODERATOR!);
    const message = await render(await mailOf(race.people.ana));
    expect(message.to).toBe(ADDRESS.ana);
  });

  it("when the person was cancelled", async () => {
    await press(staff.MODERATOR!);
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, race.people.ana));
    await withdrawn(await mailOf(race.people.ana), /gone or was cancelled/);
  });

  it("when the person was deleted", async () => {
    await press(staff.MODERATOR!);
    const row = await mailOf(race.people.ana);
    await db.delete(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, race.people.ana));
    await db.delete(eventVolunteers).where(eq(eventVolunteers.id, race.people.ana));
    await withdrawn(row, /gone or was cancelled/);
  });

  it("when the person was left with no address", async () => {
    await press(staff.MODERATOR!);
    await db.update(eventVolunteers).set({ email: null, canonicalEmail: null, canonicalizationVersion: null, source: "STAFF" }).where(eq(eventVolunteers.id, race.people.ana));
    await withdrawn(await mailOf(race.people.ana), /no address/);
  });

  it("when the person's address was corrected since: it goes to the address the row holds, or nowhere", async () => {
    await press(staff.MODERATOR!);
    await db.update(eventVolunteers).set({ email: "ana.noua@example.test", canonicalEmail: "ana.noua@example.test" }).where(eq(eventVolunteers.id, race.people.ana));
    await withdrawn(await mailOf(race.people.ana), /address changed/);
  });

  it("when the person was taken off the point", async () => {
    await press(staff.MODERATOR!);
    await place(race.people.ana, "", at(1));
    await withdrawn(await mailOf(race.people.ana), /stands at no point/);
  });

  it("when the person was moved to another point: the queued message names the old one", async () => {
    await press(staff.MODERATOR!);
    await place(race.people.ana, race.points.bridge, at(1));
    await withdrawn(await mailOf(race.people.ana), /another point/);
  });

  it("when the point was taken off the route, which frees its people", async () => {
    await press(staff.MODERATOR!);
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.id, race.points.junction));
    await withdrawn(await mailOf(race.people.ana), /stands at no point/);
  });

  it("when a newer message about their point was queued since", async () => {
    await press(staff.MODERATOR!);
    await press(staff.MODERATOR!, { again: true, now: at(1) });
    await withdrawn(await mailOf(race.people.ana, 1), /newer message/);
    // The newer one is the one that leaves.
    expect((await render(await mailOf(race.people.ana, 2))).to).toBe(ADDRESS.ana);
  });

  it("when its payload names nobody or no point: a row no press of the plan wrote", async () => {
    await press(staff.MODERATOR!);
    const row = await mailOf(race.people.ana);
    await withdrawn({ ...row, payloadJson: { eventId: race.raceId, volunteerId: race.people.ana } }, /no volunteer or no point/);
    await withdrawn({ ...row, payloadJson: { eventId: race.raceId, volunteerId: race.people.ana, checkpointId: "the junction", round: 1 } }, /no volunteer or no point/);
  });

  it("deletes each withdrawn message in the batch — nothing sent, nothing failed — and sends the rest", async () => {
    await press(staff.MODERATOR!);
    // Ana cancelled, Dan moved, Ion as he was.
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, race.people.ana));
    await place(race.people.dan, race.points.junction, at(1));
    const left = await runOutbox(at(5));
    expect(left.map((message) => message.to)).toEqual([ADDRESS.ion]);
    expect((await pointMails()).map((row) => [row.recipientEmail, row.status])).toEqual([[ADDRESS.ion, "SENT"]]);
    // The next press queues the new one for Dan, where he stands now; Ana, cancelled, is written nothing.
    expect(await press(staff.MODERATOR!, { now: at(6) })).toMatchObject({ queued: 1, told: 1 });
    expect(payloadOf((await pointMails(race.people.dan))[0])).toMatchObject({ checkpointId: race.points.junction, round: 1 });
    expect(await pointMails(race.people.ana)).toEqual([]);
  });
});

describe("§956 nobody is told by being placed, moved or taken off", () => {
  it("queues no email for «Pune aici», for a move or for «Scoate» — before a press and after one", async () => {
    const extra = await planVolunteer(db, { eventId: race.raceId, name: "Paul Nou", phone: "+40700000077" }, NOW);
    await place(extra, race.points.bridge);
    await place(extra, race.points.water);
    await place(extra, "");
    expect(await outbox()).toEqual([]);

    await press(staff.MODERATOR!);
    const queued = (await outbox()).length;
    await place(race.people.radu, race.points.bridge, at(1));
    await place(race.people.ana, race.points.water, at(1));
    await place(race.people.dan, "", at(1));
    // The same rows as the press left: placing wrote none, and withdrew none either — the send does that.
    expect(await outbox()).toHaveLength(queued);
    expect((await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "VOLUNTEER_POINT"), eq(emailOutbox.recipientEmail, ADDRESS.radu)))).length).toBe(0);
  });
});
