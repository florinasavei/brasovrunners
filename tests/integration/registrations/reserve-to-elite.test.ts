import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { ELITE_NAME_MAX, eventEliteEntries } from "@/db/schema/event-elite-entries";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Mută pe lista de elită» (§NNN; BR-REQ-037-05, BR-REQ-060-01) — the owner, 2026-11-03, of an elite runner written
 * on the internal list without an address: «având în vedere că e elită, nu trebuie să-i pun email». A line of «Lista
 * internă (doar notițe)» (§854) moves onto the race's elite list (§895) in one press: its first and last name become
 * a name printed on a bib, with no number, and the line is deleted — in one transaction, audited by ids. Nobody is
 * registered, emailed or given a place, and no declaration is asked, so no address is either: the declaration rule
 * stays whole. The internal note is not carried. The Administrator's alone, asserted at the action's door and again
 * in the service; the Organizer and Tehnic are refused and nothing changes.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, flashed: [] as unknown[] }));

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
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
// The door asks the role as the real one does, so the Organizer's and Tehnic's refusals are the action's own.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/shared/feedback/flash", () => ({
  flash: async (notice: unknown) => {
    state.flashed.push(notice);
  },
  flashOutcome: async () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { moveReserveEntryToEliteAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");
const { addReserveEntry, moveReserveEntryToElite } = await import("@/modules/registrations/reserve-list");

const NOW = new Date("2026-11-03T10:00:00.000Z");
const NOTE = "Campioană națională; a scris pe contact pe 2 nov.";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.flashed = [];
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 1 })
    .returning();
  eventId = event.id;
  admin = await as("ADMIN");
  state.actor = admin;
});

async function as(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** A line of the internal list, as «Adaugă pe lista internă» writes it. */
async function line(firstName: string, lastName: string, email: string | null = "elita@example.ro") {
  const { id } = await addReserveEntry(db, admin, eventId, { firstName, lastName, email: email ?? "", note: NOTE }, NOW);
  return id;
}

/** The line's «Mută pe lista de elită» as the panel posts it: the line, and the list's own query. */
function press(entryId: string, listQuery = `eventId=${eventId}`): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("entryId", entryId);
  form.set("listQuery", listQuery);
  return form;
}

const elite = () => db.select().from(eventEliteEntries).where(eq(eventEliteEntries.eventId, eventId));
const lines = () => db.select().from(eventReserveEntries).where(eq(eventReserveEntries.eventId, eventId));
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("§NNN «Mută pe lista de elită» on a line of the internal list", () => {
  it("writes the line's name onto the elite list with no number and deletes the line, in one press: nobody registered, emailed or seated", async () => {
    // The name as it prints: trimmed, the inner spaces collapsed (`parseEliteEntry`).
    const entryId = await line("  Mara ", "Munteanu   Pop");

    await expect(moveReserveEntryToEliteAction(null, press(entryId))).rejects.toThrow(`REDIRECT /ro/admin/registrations?eventId=${eventId}&saved=reserveMovedToElite#registrations-reserve`);

    const [moved, ...more] = await elite();
    expect(more).toEqual([]);
    expect(moved).toMatchObject({ eventId, name: "Mara Munteanu Pop", bibNumber: null, createdByStaffUserId: admin.id });
    expect(await lines()).toEqual([]);
    // Not a registration: no person, no row, no email, and the note on nothing.
    expect(await db.select().from(registrations)).toEqual([]);
    expect(await db.select().from(participants)).toEqual([]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(await db.select().from(registrationNotes)).toEqual([]);
    // The toast, by its key only.
    expect(state.flashed).toEqual([{ kind: "success", key: "reserveMovedToElite" }]);
  });

  it("leaves the trail by ids alone: the elite line it became and the internal line it was — never a name, an address or the note", async () => {
    const entryId = await line("Mara", "Munteanu");
    await expect(moveReserveEntryToEliteAction(null, press(entryId))).rejects.toThrow(/REDIRECT/);
    const [{ id: eliteEntryId }] = await elite();

    const [added] = await trail("event_elite.added");
    expect(added).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: eventId });
    expect(added.metadataJson).toEqual({ entryId: eliteEntryId, reserveEntryId: entryId });
    const [moved] = await trail("event_reserve.moved");
    expect(moved).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: eventId });
    expect(moved.metadataJson).toEqual({ entryId, eliteEntryId });
    const words = JSON.stringify(await db.select().from(auditLogs));
    for (const typed of ["Mara", "Munteanu", "elita@example.ro", "Campioană"]) expect(words).not.toContain(typed);
  });

  it("moves a line written without an address the same: the elite list asks for none", async () => {
    const entryId = await line("Ion", "Ionescu", null);
    expect((await lines())[0].email).toBeNull();

    await expect(moveReserveEntryToEliteAction(null, press(entryId))).rejects.toThrow(/saved=reserveMovedToElite/);
    expect((await elite()).map((row) => [row.name, row.bibNumber])).toEqual([["Ion Ionescu", null]]);
    expect(await lines()).toEqual([]);
    expect(await db.select().from(participants)).toEqual([]);
  });

  it("comes back to the list as it was — its filters, sort and page — the outcome replacing any older one, the event the line's", async () => {
    const entryId = await line("Mara", "Munteanu");
    const query = `eventId=${eventId}&status=CONFIRMED&q=pop&sort=name&dir=asc&page=2&saved=reserveAdded&error=CONFLICT&from=reserve`;

    await expect(moveReserveEntryToEliteAction(null, press(entryId, query))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${eventId}&status=CONFIRMED&q=pop&sort=name&dir=asc&page=2&saved=reserveMovedToElite#registrations-reserve`,
    );
    // A query about another event (a stale or forged field) still lands on the line's own event.
    const second = await line("Ana", "Pop");
    await expect(moveReserveEntryToEliteAction(null, press(second, "eventId=00000000-0000-4000-8000-000000000000&page=3"))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${eventId}&page=3&saved=reserveMovedToElite#registrations-reserve`,
    );
  });

  it("refuses a name too long for a bib in its own sentence, the limit named, and changes nothing", async () => {
    // Two names the internal list takes (each up to 100), one character too many together: 50 + a space + 30.
    const entryId = await line("M".repeat(50), "P".repeat(ELITE_NAME_MAX - 50));

    expect(await moveReserveEntryToEliteAction(null, press(entryId))).toMatchObject({ error: "RESERVE_ELITE_NAME", errorValues: { max: String(ELITE_NAME_MAX) }, fields: [] });
    expect(await elite()).toEqual([]);
    expect((await lines()).map((row) => [row.id, row.note])).toEqual([[entryId, NOTE]]);
    expect(await trail("event_elite.added")).toEqual([]);
    expect(await trail("event_reserve.moved")).toEqual([]);
    expect(state.flashed).toEqual([]);
    // The sentence exists in both languages and names the limit.
    for (const catalogue of [ro, en]) expect(catalogue.Admin.errors.RESERVE_ELITE_NAME).toContain("{max}");

    // The service names the field it refused, so the action can say why.
    const direct = await refusal(moveReserveEntryToElite(db, admin, entryId, NOW));
    expect(isDomainError(direct) && direct.fields).toEqual(["name"]);
    expect(await lines()).toHaveLength(1);
  });

  it("finds a line already moved gone on a second press, and writes no second name", async () => {
    const entryId = await line("Mara", "Munteanu");
    await expect(moveReserveEntryToEliteAction(null, press(entryId))).rejects.toThrow(/REDIRECT/);
    expect(await moveReserveEntryToEliteAction(null, press(entryId))).toMatchObject({ error: "NOT_FOUND" });
    expect(await moveReserveEntryToEliteAction(null, press("not-a-line"))).toMatchObject({ error: "NOT_FOUND" });
    expect(await elite()).toHaveLength(1);
  });

  it("is the Administrator's alone: the Organizer and Tehnic are refused at the door and by the service, and the line stays", async () => {
    const entryId = await line("Mara", "Munteanu");
    for (const role of ["MODERATOR", "DEV"] as const) {
      const actor = await as(role);
      state.actor = actor;
      expect(await moveReserveEntryToEliteAction(null, press(entryId)), role).toMatchObject({ error: "FORBIDDEN" });
      const direct = await refusal(moveReserveEntryToElite(db, actor, entryId, NOW));
      expect(isDomainError(direct) && direct.code, role).toBe("FORBIDDEN");
    }
    expect(await elite()).toEqual([]);
    expect((await lines()).map((row) => row.id)).toEqual([entryId]);
    expect(await trail("event_reserve.moved")).toEqual([]);
    // The Superadministrator is an Administrator too.
    state.actor = await as("SUPERADMIN");
    await expect(moveReserveEntryToEliteAction(null, press(entryId))).rejects.toThrow(/saved=reserveMovedToElite/);
  });
});
