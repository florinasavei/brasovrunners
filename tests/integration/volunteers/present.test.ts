import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { changeVolunteer, listVolunteers } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Prezent» on a volunteer (the owner, 2026-11-18, three days before the race: «La voluntari
 * trebuie să trec prezent/absent ca să pot face tombola doar pentru cei prezenți»): `changeVolunteer`'s kind `setPresent`, on a real
 * PostgreSQL in memory.
 *
 * The organizers' own mark that the person came on the day; unticked is absent. Whoever works the volunteers ticks and clears it, for
 * a person in any state, as «Are kit»; every other role is refused with nothing written. Another event's person, or nobody's id, is
 * not there. The same value again writes nothing. The trail names the box and the new value, never a name. And it moves nothing
 * else: no state, role, point, number, kit, raffle tick or decision, no email, and no expiry of a public page — no public page reads it.
 *
 * `next/cache` is stubbed and the cache helper told it runs in a Next server (`NEXT_RUNTIME`), as
 * `tests/integration/public-cache/revalidation.test.ts` does: outside one, an expiry is skipped and could not be seen.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: vi.fn() }));
const { revalidateTag, revalidatePath, updateTag } = await import("next/cache");

const NOW = new Date("2026-11-18T10:00:00.000Z");
const LATER = new Date("2026-11-21T07:30:00.000Z");

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

async function volunteer(over: { eventId: string; name: string; state?: "REGISTERED" | "CONFIRMED" | "CANCELLED"; given?: string[]; address?: boolean; bibNumber?: number; checkpointId?: string }): Promise<string> {
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
      raceDayDecision: "vine la 7:30 la start",
      message: "Pot veni de la 7.",
      hasKit: true,
      inRaffle: false,
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

  // Confirmed, with a role, a number, a point, a kit, a decision and out of the raffle: everything a careless write could move.
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
const presentOf = async (id: string) => (await rowOf(id)).present;
/** The volunteers' rows of the trail, oldest first. */
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action.startsWith("volunteer."));
const minutesLater = (minutes: number) => new Date(LATER.getTime() + minutes * 60_000);
const mark = (actor: StaffUser, id: string, present: unknown, eventId = raceId, now = LATER) => changeVolunteer(db, actor, { kind: "setPresent", eventId, id, present: present as boolean }, now);

describe("§NNN who marks a volunteer «Prezent»", () => {
  it("lets the Organizer, the Administrator and the Superadministrator tick and clear it — whoever works the volunteers", async () => {
    expect(await presentOf(people.ana)).toBe(false);
    expect(await mark(staff.MODERATOR!, people.ana, true)).toEqual({ changed: true, volunteer: { id: people.ana, hasAddress: true } });
    expect(await presentOf(people.ana)).toBe(true);
    expect(await mark(staff.ADMIN!, people.ana, false)).toMatchObject({ changed: true });
    expect(await presentOf(people.ana)).toBe(false);
    expect(await mark(staff.SUPERADMIN!, people.ana, true)).toMatchObject({ changed: true });
    expect(await presentOf(people.ana)).toBe(true);
    // A person with no address is marked the same way, and the result says they have none.
    expect(await mark(staff.MODERATOR!, people.zoe, true)).toEqual({ changed: true, volunteer: { id: people.zoe, hasAddress: false } });
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member, with nothing written (BR-REQ-060-01)", async () => {
    await db.update(eventVolunteers).set({ present: true }).where(eq(eventVolunteers.id, people.dan));
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      expect(canManageVolunteers(role), role).toBe(false);
      // Ticking and clearing alike — and the refusal comes before anything about the person is told.
      await expect(mark(staff[role]!, people.ana, true), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mark(staff[role]!, people.dan, false), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mark(staff[role]!, "11111111-1111-4111-8111-111111111111", true), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await presentOf(people.ana)).toBe(false);
    expect(await presentOf(people.dan)).toBe(true);
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN whose «Prezent» it is", () => {
  it("is NOT_FOUND for another event's person, for nobody's id and for an id or an event that is no id — with nothing written", async () => {
    // Mara is the other event's: posted as the race's, she is not there.
    await expect(mark(staff.ADMIN!, people.mara, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Ana is the race's: posted as the other event's, neither.
    await expect(mark(staff.ADMIN!, people.ana, true, runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mark(staff.ADMIN!, "11111111-1111-4111-8111-111111111111", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mark(staff.ADMIN!, "ana", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mark(staff.ADMIN!, people.ana, true, "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mark(staff.ADMIN!, people.ana, true, "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const id of Object.values(people)) expect(await presentOf(id)).toBe(false);
    expect(await trail()).toEqual([]);
    // Under her own event Mara is marked.
    expect(await mark(staff.ADMIN!, people.mara, true, runId)).toMatchObject({ changed: true });
  });

  it("is marked for a person in every state, as «Are kit» — a cancelled one too, whom no figure and no file counts", async () => {
    for (const [id, state] of [[people.dan, "REGISTERED"], [people.ana, "CONFIRMED"], [people.eva, "CANCELLED"]] as const) {
      expect((await rowOf(id)).state).toBe(state);
      expect(await mark(staff.MODERATOR!, id, true), state).toMatchObject({ changed: true });
      expect(await presentOf(id)).toBe(true);
      expect(await mark(staff.MODERATOR!, id, false), state).toMatchObject({ changed: true });
      expect(await presentOf(id)).toBe(false);
      expect((await rowOf(id)).state).toBe(state);
    }
  });

  it("ticks only for a real `true`: anything else a forged request carries clears, the column's default", async () => {
    for (const forged of ["1", "true", 1, "yes", null, undefined, {}]) {
      await db.update(eventVolunteers).set({ present: true }).where(eq(eventVolunteers.id, people.ana));
      expect(await mark(staff.MODERATOR!, people.ana, forged), String(forged)).toMatchObject({ changed: true });
      expect(await presentOf(people.ana), String(forged)).toBe(false);
    }
  });
});

describe("§NNN what «Prezent» writes, and what it leaves alone", () => {
  it("writes nothing and audits nothing when the value is the same — ticked again, or cleared while absent", async () => {
    await mark(staff.MODERATOR!, people.ana, true, raceId, NOW);
    expect(await trail()).toHaveLength(1);
    const stamped = (await rowOf(people.ana)).updatedAt;
    expect(await mark(staff.ADMIN!, people.ana, true)).toEqual({ changed: false, volunteer: { id: people.ana, hasAddress: true } });
    expect(await mark(staff.ADMIN!, people.dan, false)).toEqual({ changed: false, volunteer: { id: people.dan, hasAddress: true } });
    expect(await trail()).toHaveLength(1);
    expect((await rowOf(people.ana)).updatedAt).toEqual(stamped);
    expect((await rowOf(people.dan)).updatedAt).toEqual(NOW);
  });

  it("audits each change as an edit of the person's box — who, when, which event, the new value and the roles held — and never a name", async () => {
    await mark(staff.MODERATOR!, people.ana, true, raceId, minutesLater(0));
    await mark(staff.ADMIN!, people.ana, false, raceId, minutesLater(1));
    await mark(staff.ADMIN!, people.dan, true, raceId, minutesLater(2));
    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["volunteer.edited", "volunteer.edited", "volunteer.edited"]);
    expect(rows.map((row) => row.actorStaffUserId)).toEqual([staff.MODERATOR!.id, staff.ADMIN!.id, staff.ADMIN!.id]);
    expect(rows.map((row) => row.createdAt)).toEqual([minutesLater(0), minutesLater(1), minutesLater(2)]);
    for (const row of rows) expect(row).toMatchObject({ entityType: "event", entityId: raceId, participantId: null });
    expect(rows.map((row) => row.metadataJson)).toEqual([
      { volunteerId: people.ana, fields: ["present"], present: true, assignedRoleIds: [guideId] },
      { volunteerId: people.ana, fields: ["present"], present: false, assignedRoleIds: [guideId] },
      { volunteerId: people.dan, fields: ["present"], present: true, assignedRoleIds: [] },
    ]);
    // Not a name, an address or a telephone number anywhere in the trail.
    const everything = JSON.stringify(await db.select().from(auditLogs));
    expect(everything).not.toMatch(/Ana Pop|Dan Ene|example\.test|\+407/);
  });

  it("moves nothing else of the person: the state, the roles given and offered, the point, the number, the kit, the raffle tick, the decision, the contact", async () => {
    const before = await rowOf(people.ana);
    const links = async () => ({
      given: (await db.select().from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, people.ana))).map((row) => row.roleId),
      offered: (await db.select().from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, people.ana))).map((row) => row.roleId),
    });
    const linksBefore = await links();
    expect(before).toMatchObject({ state: "CONFIRMED", roleId: guideId, checkpointId: pointId, bibNumber: 501, inRaffle: false, hasKit: true, raceDayDecision: "vine la 7:30 la start", present: false });

    await mark(staff.MODERATOR!, people.ana, true);

    const after = await rowOf(people.ana);
    // The one column, and the row's own stamp of when it was last written.
    expect(after.present).toBe(true);
    expect(after.updatedAt).toEqual(LATER);
    expect({ ...after, present: false, updatedAt: before.updatedAt }).toEqual(before);
    expect(await links()).toEqual(linksBefore);
    // Nobody else of the event was touched.
    for (const id of [people.dan, people.eva, people.zoe, people.mara]) expect(await rowOf(id)).toMatchObject({ present: false, updatedAt: NOW });
  });

  it("queues no email — not for a person with an address and a role, in any state, ticked or cleared", async () => {
    for (const id of [people.ana, people.dan, people.eva]) {
      expect((await rowOf(id)).email).not.toBeNull();
      await mark(staff.MODERATOR!, id, true);
      await mark(staff.MODERATOR!, id, false);
      await mark(staff.MODERATOR!, id, true);
    }
    expect(await db.select().from(emailOutbox)).toEqual([]);
    // The outbox is watched: the same person given a role again is told so.
    await changeVolunteer(db, staff.MODERATOR!, { kind: "unassign", eventId: raceId, id: people.ana, roleId: guideId }, LATER);
    await changeVolunteer(db, staff.MODERATOR!, { kind: "assign", eventId: raceId, id: people.ana, roleId: guideId }, LATER);
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType)).toEqual(["VOLUNTEER_ROLE_ASSIGNED"]);
  });

  it("expires no public cache tag — no public page reads the column — while a press a public page does read expires «places»", async () => {
    expect(await mark(staff.MODERATOR!, people.ana, true)).toMatchObject({ changed: true });
    expect(await mark(staff.MODERATOR!, people.ana, false)).toMatchObject({ changed: true });
    expect(await mark(staff.MODERATOR!, people.eva, true)).toMatchObject({ changed: true });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(updateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

    // The cache is listening: «Anulează» changes how a role stands on the event's page, and says so.
    await changeVolunteer(db, staff.MODERATOR!, { kind: "setState", eventId: raceId, id: people.dan, state: "CANCELLED" }, LATER);
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([["public:places", { expire: 0 }]]);
  });

  it("is on the row the organizers' screens read — and every volunteer starts absent", async () => {
    await mark(staff.MODERATOR!, people.ana, true);
    const rows = await listVolunteers(db, raceId);
    expect(rows.find((row) => row.id === people.ana)).toMatchObject({ present: true, hasKit: true });
    expect(rows.find((row) => row.id === people.dan)).toMatchObject({ present: false });
    // A person entered by hand starts absent: nobody is present before the organizers say so.
    const added = await changeVolunteer(db, staff.MODERATOR!, { kind: "add", eventId: raceId, fields: { name: "Ion Lupu", email: "ion.lupu@example.test", phone: "+40700000009", assignedRoleIds: [guideId] } }, LATER, { sendEmail: false });
    expect(await presentOf(added.volunteer.id)).toBe(false);
  });
});
