import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { VOLUNTEER_DECISION_MAX } from "@/modules/volunteers/domain/volunteer";
import { changeVolunteer, listVolunteers } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Decizie pentru ziua cursei» (the owner, 2026-11-16, of the «Voluntari» list: «si la
 * voluntar trebuie sa am si decizie pt ziua cursei»): `changeVolunteer`'s kind `setDecision`, on a real PostgreSQL in memory.
 *
 * One short line the organizers keep about what THEY decided for a person on race day. Whoever works the volunteers writes,
 * changes and clears it, for a person in any state; every other role is refused with nothing written. The words are kept as one
 * paragraph; too long, or no text, is the refusal of the box itself; another event's person, or nobody's id, is not there. The
 * same words again write nothing. The trail names the box and never the words. And it moves nothing else: no state, role, point,
 * number or tick, no email, and no expiry of a public page — no public page reads it.
 *
 * `next/cache` is stubbed and the cache helper told it runs in a Next server (`NEXT_RUNTIME`), as
 * `tests/integration/public-cache/revalidation.test.ts` does: outside one, an expiry is skipped and could not be seen.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: vi.fn() }));
const { revalidateTag, revalidatePath, updateTag } = await import("next/cache");

const NOW = new Date("2026-11-16T10:00:00.000Z");
const LATER = new Date("2026-11-16T11:30:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let guideId: string;
let pointId: string;
const people = { ana: "", dan: "", eva: "", zoe: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function volunteer(over: {
  eventId: string;
  name: string;
  state?: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  given?: string[];
  address?: boolean;
  bibNumber?: number;
  checkpointId?: string;
  raceDayDecision?: string;
}): Promise<string> {
  const email = over.address === false ? null : `${over.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: over.eventId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: email === null ? null : 1,
      phone: email === null ? null : "+40700000001",
      // Only a row the club typed may lack an address (§865).
      source: email === null ? "STAFF" : "PUBLIC",
      state: over.state ?? "CONFIRMED",
      roleId: over.given?.[0] ?? null,
      bibNumber: over.bibNumber ?? null,
      checkpointId: over.checkpointId ?? null,
      raceDayDecision: over.raceDayDecision ?? null,
      message: "Pot veni de la 7.",
      hasKit: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  if (over.given?.length) {
    await db.insert(eventVolunteerRoleChoices).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
    await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  }
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  for (const spy of [revalidateTag, revalidatePath, updateTag]) vi.mocked(spy).mockClear();
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  const [race, run] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, hasRaffle: true },
      { type: "RACE", startsAt: new Date("2026-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  runId = run.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  const [guide] = await db.insert(eventVolunteerRoles).values({ eventId: raceId, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0 }).returning({ id: eventVolunteerRoles.id });
  guideId = guide.id;
  const [point] = await db.insert(eventCheckpoints).values({ eventId: raceId, km: "1.20", nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", kinds: ["DIRECTION"], position: 0 }).returning({ id: eventCheckpoints.id });
  pointId = point.id;

  // Confirmed, with a role, a number and a point: everything a careless write could move.
  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", given: [guideId], bibNumber: 501, checkpointId: pointId });
  people.dan = await volunteer({ eventId: raceId, name: "Dan Ene", state: "REGISTERED" });
  people.eva = await volunteer({ eventId: raceId, name: "Eva Stan", state: "CANCELLED", given: [guideId] });
  // A name on the list only (§865): no address, no telephone.
  people.zoe = await volunteer({ eventId: raceId, name: "Zoe Manea", address: false });
  people.mara = await volunteer({ eventId: runId, name: "Mara Dinu" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const rowOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
const decisionOf = async (id: string) => (await rowOf(id)).raceDayDecision;
/** The volunteers' rows of the trail, oldest first. */
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action.startsWith("volunteer."));
const minutesLater = (minutes: number) => new Date(LATER.getTime() + minutes * 60_000);
const decide = (actor: StaffUser, id: string, decision: unknown, eventId = raceId, now = LATER) => changeVolunteer(db, actor, { kind: "setDecision", eventId, id, decision }, now);

describe("§NNN who writes a volunteer's race-day decision", () => {
  it("lets the Organizer, the Administrator and the Superadministrator write it — whoever works the volunteers", async () => {
    expect(await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start")).toEqual({ changed: true, volunteer: { id: people.ana, hasAddress: true } });
    expect(await decisionOf(people.ana)).toBe("vine la 8:00 la start");
    expect(await decide(staff.ADMIN!, people.ana, "rezervă")).toMatchObject({ changed: true });
    expect(await decisionOf(people.ana)).toBe("rezervă");
    expect(await decide(staff.SUPERADMIN!, people.ana, "vine la 9:00")).toMatchObject({ changed: true });
    expect(await decisionOf(people.ana)).toBe("vine la 9:00");
    // A person with no address is written the same way, and the result says they have none.
    expect(await decide(staff.MODERATOR!, people.zoe, "rezervă")).toEqual({ changed: true, volunteer: { id: people.zoe, hasAddress: false } });
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member, with nothing written (BR-REQ-060-01)", async () => {
    await db.update(eventVolunteers).set({ raceDayDecision: "rezervă" }).where(eq(eventVolunteers.id, people.dan));
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      expect(canManageVolunteers(role), role).toBe(false);
      // Writing, changing and clearing alike — and the refusal comes before anything about the person is told.
      await expect(decide(staff[role]!, people.ana, "vine la 8:00"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decide(staff[role]!, people.dan, ""), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decide(staff[role]!, "11111111-1111-4111-8111-111111111111", "x"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decide(staff[role]!, people.ana, "x".repeat(VOLUNTEER_DECISION_MAX + 1)), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await decisionOf(people.ana)).toBeNull();
    expect(await decisionOf(people.dan)).toBe("rezervă");
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN the words of a race-day decision", () => {
  it("keeps them as one paragraph: trimmed, a line break a space, a run of spaces one", async () => {
    await decide(staff.MODERATOR!, people.ana, "  vine la 8:00\r\nla start,\n\n  cu mașina \t");
    expect(await decisionOf(people.ana)).toBe("vine la 8:00 la start, cu mașina");
  });

  it("clears the decision for an empty box, and for one that holds only spaces and line breaks", async () => {
    await decide(staff.MODERATOR!, people.ana, "rezervă");
    expect(await decide(staff.MODERATOR!, people.ana, "")).toMatchObject({ changed: true });
    expect(await decisionOf(people.ana)).toBeNull();
    await decide(staff.MODERATOR!, people.ana, "rezervă");
    expect(await decide(staff.MODERATOR!, people.ana, " \n\t ")).toMatchObject({ changed: true });
    expect(await decisionOf(people.ana)).toBeNull();
  });

  it("refuses more than the limit as the refusal of the box itself, keeps exactly the limit, and writes nothing for the refusal", async () => {
    await decide(staff.MODERATOR!, people.ana, "rezervă");
    const before = (await trail()).length;
    await expect(decide(staff.MODERATOR!, people.ana, "a".repeat(VOLUNTEER_DECISION_MAX + 1))).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["decision"] });
    expect(await decisionOf(people.ana)).toBe("rezervă");
    expect(await trail()).toHaveLength(before);
    // Three hundred letters with diacritics: three hundred characters, kept whole — the database's CHECK counts the same way.
    const whole = "ș".repeat(VOLUNTEER_DECISION_MAX);
    expect(await decide(staff.MODERATOR!, people.ana, whole)).toMatchObject({ changed: true });
    expect(await decisionOf(people.ana)).toBe(whole);
  });

  it("refuses what is no text at all — a box never posted, a file — on the box, rather than clearing what stands", async () => {
    await decide(staff.MODERATOR!, people.ana, "rezervă");
    for (const junk of [undefined, null, 7, ["rezervă"], new File(["x"], "decizie.txt")]) {
      await expect(decide(staff.MODERATOR!, people.ana, junk)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["decision"] });
    }
    expect(await decisionOf(people.ana)).toBe("rezervă");
  });
});

describe("§NNN whose race-day decision it is", () => {
  it("is NOT_FOUND for another event's person, for nobody's id and for an id or an event that is no id — with nothing written", async () => {
    // Mara is the other event's: posted as the race's, she is not there.
    await expect(decide(staff.ADMIN!, people.mara, "rezervă")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Ana is the race's: posted as the other event's, neither.
    await expect(decide(staff.ADMIN!, people.ana, "rezervă", runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decide(staff.ADMIN!, "11111111-1111-4111-8111-111111111111", "rezervă")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decide(staff.ADMIN!, "ana", "rezervă")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decide(staff.ADMIN!, people.ana, "rezervă", "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decide(staff.ADMIN!, people.ana, "rezervă", "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const id of Object.values(people)) expect(await decisionOf(id)).toBeNull();
    expect(await trail()).toEqual([]);
    // Under her own event Mara is written.
    expect(await decide(staff.ADMIN!, people.mara, "rezervă", runId)).toMatchObject({ changed: true });
  });

  it("is written for a person in every state — a cancelled one too: «nu mai vine» is a decision", async () => {
    for (const [id, state] of [[people.dan, "REGISTERED"], [people.ana, "CONFIRMED"], [people.eva, "CANCELLED"]] as const) {
      expect((await rowOf(id)).state).toBe(state);
      expect(await decide(staff.MODERATOR!, id, "nu mai vine"), state).toMatchObject({ changed: true });
      expect(await decisionOf(id)).toBe("nu mai vine");
      // Changed and cleared in that state as well.
      expect(await decide(staff.MODERATOR!, id, "vine totuși"), state).toMatchObject({ changed: true });
      expect(await decide(staff.MODERATOR!, id, ""), state).toMatchObject({ changed: true });
      expect((await rowOf(id)).state).toBe(state);
    }
  });
});

describe("§NNN what a race-day decision writes, and what it leaves alone", () => {
  it("writes nothing and audits nothing when the words are the same — as typed, or once read as one paragraph", async () => {
    await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start", raceId, NOW);
    expect(await trail()).toHaveLength(1);
    const stamped = (await rowOf(people.ana)).updatedAt;
    expect(await decide(staff.ADMIN!, people.ana, "vine la 8:00 la start")).toEqual({ changed: false, volunteer: { id: people.ana, hasAddress: true } });
    expect(await decide(staff.ADMIN!, people.ana, "  vine la 8:00\nla   start ")).toMatchObject({ changed: false });
    // No decision, cleared again: nothing either.
    expect(await decide(staff.ADMIN!, people.dan, "")).toMatchObject({ changed: false });
    expect(await decide(staff.ADMIN!, people.dan, "   ")).toMatchObject({ changed: false });
    expect(await trail()).toHaveLength(1);
    expect((await rowOf(people.ana)).updatedAt).toEqual(stamped);
  });

  it("audits each change as an edit of the person's box — who, when, which event — and never holds the words", async () => {
    await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start, la masa de kituri", raceId, minutesLater(0));
    await decide(staff.ADMIN!, people.ana, "rezervă pentru Intersecția Stejeriș", raceId, minutesLater(1));
    await decide(staff.ADMIN!, people.ana, "", raceId, minutesLater(2));
    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["volunteer.edited", "volunteer.edited", "volunteer.edited"]);
    expect(rows.map((row) => row.actorStaffUserId)).toEqual([staff.MODERATOR!.id, staff.ADMIN!.id, staff.ADMIN!.id]);
    expect(rows.map((row) => row.createdAt)).toEqual([minutesLater(0), minutesLater(1), minutesLater(2)]);
    for (const row of rows) expect(row).toMatchObject({ entityType: "event", entityId: raceId, participantId: null });
    // The box by its name, whether a decision stands after the change, and the roles the person holds — the trail's own context.
    expect(rows.map((row) => row.metadataJson)).toEqual([
      { volunteerId: people.ana, fields: ["raceDayDecision"], hasDecision: true, assignedRoleIds: [guideId] },
      { volunteerId: people.ana, fields: ["raceDayDecision"], hasDecision: true, assignedRoleIds: [guideId] },
      { volunteerId: people.ana, fields: ["raceDayDecision"], hasDecision: false, assignedRoleIds: [guideId] },
    ]);
    // Not a word of either decision, nor the person's name, anywhere in the trail.
    const everything = JSON.stringify(await db.select().from(auditLogs));
    expect(everything).not.toMatch(/8:00|start|kituri|rezerv|Stejeri|Ana Pop/);
  });

  it("moves nothing else of the person: the state, the roles given and offered, the point, the number, the ticks, the contact", async () => {
    const before = await rowOf(people.ana);
    const links = async () => ({
      given: (await db.select().from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, people.ana))).map((row) => row.roleId),
      offered: (await db.select().from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, people.ana))).map((row) => row.roleId),
    });
    const linksBefore = await links();
    expect(before).toMatchObject({ state: "CONFIRMED", roleId: guideId, checkpointId: pointId, bibNumber: 501, inRaffle: true, hasKit: true, raceDayDecision: null });

    await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start");

    const after = await rowOf(people.ana);
    // The one column, and the row's own stamp of when it was last written.
    expect(after.raceDayDecision).toBe("vine la 8:00 la start");
    expect(after.updatedAt).toEqual(LATER);
    expect({ ...after, raceDayDecision: null, updatedAt: before.updatedAt }).toEqual(before);
    expect(await links()).toEqual(linksBefore);
    // Nobody else of the event was touched.
    for (const id of [people.dan, people.eva, people.zoe, people.mara]) expect((await rowOf(id)).updatedAt).toEqual(NOW);
  });

  it("queues no email — not for a person with an address and roles, in any state, written, changed or cleared", async () => {
    for (const id of [people.ana, people.dan, people.eva]) {
      expect((await rowOf(id)).email).not.toBeNull();
      await decide(staff.MODERATOR!, id, "vine la 8:00 la start");
      await decide(staff.MODERATOR!, id, "rezervă");
      await decide(staff.MODERATOR!, id, "");
    }
    expect(await db.select().from(emailOutbox)).toEqual([]);
    // The outbox is watched: the same person given a role is told so.
    await changeVolunteer(db, staff.MODERATOR!, { kind: "unassign", eventId: raceId, id: people.ana, roleId: guideId }, LATER);
    await changeVolunteer(db, staff.MODERATOR!, { kind: "assign", eventId: raceId, id: people.ana, roleId: guideId }, LATER);
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType)).toEqual(["VOLUNTEER_ROLE_ASSIGNED"]);
  });

  it("expires no public cache tag — no public page reads the column — while a press a public page does read expires «places»", async () => {
    expect(await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start")).toMatchObject({ changed: true });
    expect(await decide(staff.MODERATOR!, people.ana, "rezervă")).toMatchObject({ changed: true });
    expect(await decide(staff.MODERATOR!, people.ana, "")).toMatchObject({ changed: true });
    expect(await decide(staff.MODERATOR!, people.eva, "nu mai vine")).toMatchObject({ changed: true });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(updateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

    // The cache is listening: «Anulează» changes how a role stands on the event's page, and says so.
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId: raceId, id: people.dan, state: "CANCELLED" }, LATER);
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([["public:places", { expire: 0 }]]);
  });

  it("is on the row the organizers' screens read, beside the person's own message — and null for whoever has none", async () => {
    await decide(staff.MODERATOR!, people.ana, "vine la 8:00 la start");
    const rows = await listVolunteers(db, raceId);
    expect(rows.find((row) => row.id === people.ana)).toMatchObject({ raceDayDecision: "vine la 8:00 la start", message: "Pot veni de la 7." });
    expect(rows.find((row) => row.id === people.dan)).toMatchObject({ raceDayDecision: null });
  });
});
