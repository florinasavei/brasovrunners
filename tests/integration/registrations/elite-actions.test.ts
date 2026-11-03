import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Elită — doar numele pe BIB» (§NNN; BR-REQ-060-01): the bib card's two presses — «Adaugă pe lista de elită» and a
 * line's «Șterge» — are the Administrator's, asserted at the door of each Server Action (and again in the service);
 * the Organizer and Tehnic are refused and nothing is written. A refused add keeps what was typed and names the
 * card's own box; a success lands back on the card, open, and leaves its row in the trail.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/events/x" }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { addEliteEntryAction, deleteEliteEntryAction } = await import("@/app/[locale]/admin/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 5 }).returning();
  eventId = event.id;
});

async function as(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  state.actor = user;
  return user;
}

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  posted.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

/** What a Server Action that redirects throws here (the mock above), or what it returned. */
async function outcomeOf(run: Promise<unknown>): Promise<{ redirect: string } | { returned: unknown }> {
  try {
    return { returned: await run };
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return { redirect: message.slice("REDIRECT ".length) };
    throw error;
  }
}

describe("§NNN the elite list's Server Actions", () => {
  it("adds for the Administrator, lands on the card open, and leaves an audit row with the line's id only", async () => {
    await as("ADMIN");
    const done = await outcomeOf(addEliteEntryAction(null, form({ eliteName: " Eliud  Kipchoge ", eliteNumber: "7" })));
    expect(done).toEqual({ redirect: "/ro/admin/events/x?saved=eliteAdded#bib-elite" });
    const [line] = await db.select().from(eventEliteEntries);
    expect([line.name, line.bibNumber, line.eventId]).toEqual(["Eliud Kipchoge", 7, eventId]);
    const trail = await db.select().from(auditLogs);
    expect(trail.map((row) => [row.action, row.metadataJson])).toEqual([["event_elite.added", { entryId: line.id }]]);
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("keeps what was typed on a refusal, naming the card's own box", async () => {
    await as("ADMIN");
    const refused = await outcomeOf(addEliteEntryAction(null, form({ eliteName: "  ", eliteNumber: "abc" })));
    expect(refused).toMatchObject({ returned: { error: "VALIDATION_ERROR", fields: ["eliteName", "eliteNumber"], values: { eliteName: ["  "], eliteNumber: ["abc"] } } });
    expect(await db.select().from(eventEliteEntries)).toHaveLength(0);
  });

  it("says a number another line already carries in its own words, on «Număr (opțional)», and keeps both boxes", async () => {
    const admin = await as("ADMIN");
    await db.insert(eventEliteEntries).values({ eventId, name: "Faith Kipyegon", bibNumber: 7, createdByStaffUserId: admin.id });
    const refused = await outcomeOf(addEliteEntryAction(null, form({ eliteName: "Eliud Kipchoge", eliteNumber: "7" })));
    expect(refused).toMatchObject({ returned: { error: "ELITE_NUMBER_TAKEN", fields: ["eliteNumber"], values: { eliteName: ["Eliud Kipchoge"], eliteNumber: ["7"] } } });
    expect((await db.select().from(eventEliteEntries)).map((row) => row.name)).toEqual(["Faith Kipyegon"]);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it.each<StaffRole>(["MODERATOR", "DEV"])("refuses %s at the door: nothing added, nothing deleted, nothing in the trail", async (role) => {
    const admin = await as("ADMIN");
    const [line] = await db.insert(eventEliteEntries).values({ eventId, name: "Faith Kipyegon", createdByStaffUserId: admin.id }).returning();
    await as(role);
    expect(await outcomeOf(addEliteEntryAction(null, form({ eliteName: "Eliud Kipchoge", eliteNumber: "" })))).toMatchObject({ returned: { error: "FORBIDDEN" } });
    // The delete comes back to the editor with the refusal in its banner.
    const deleted = await outcomeOf(deleteEliteEntryAction(null, form({ entryId: line.id })));
    expect(deleted).toEqual({ redirect: "/ro/admin/events/x?error=FORBIDDEN#admin-alert" });
    expect((await db.select().from(eventEliteEntries)).map((row) => row.name)).toEqual(["Faith Kipyegon"]);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("deletes for the Administrator, lands on the card, and a second press finds the line gone", async () => {
    const admin = await as("ADMIN");
    const [line] = await db.insert(eventEliteEntries).values({ eventId, name: "Faith Kipyegon", bibNumber: 2, createdByStaffUserId: admin.id }).returning();
    expect(await outcomeOf(deleteEliteEntryAction(null, form({ entryId: line.id })))).toEqual({ redirect: "/ro/admin/events/x?saved=eliteDeleted#bib-elite" });
    expect(await db.select().from(eventEliteEntries)).toHaveLength(0);
    expect((await db.select().from(auditLogs)).map((row) => [row.action, row.metadataJson])).toEqual([["event_elite.deleted", { entryId: line.id }]]);
    expect(await outcomeOf(deleteEliteEntryAction(null, form({ entryId: line.id })))).toEqual({ redirect: "/ro/admin/events/x?error=NOT_FOUND#admin-alert" });
  });
});
