import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries, RESERVE_NAME_MAX } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canKeepRegistrationNotes, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Corectează numele» on a line of «Lista internă (doar notițe)» («Corectează numele pe lista internă»; BR-REQ-037-05,
 * BR-REQ-060-01): the Organizer and above fix a name written down wrong. The name goes through the add's own parse;
 * the line keeps its place, note, address, author and creation moment; the trail names no name. Made-up people only.
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

const { renameReserveEntryAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");
const { addReserveEntry, deleteReserveEntry, parseReserveEntry, parseReserveName, renameReserveEntry } = await import("@/modules/registrations/reserve-list");

const NOW = new Date("2026-11-10T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let author: StaffUser;

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
  author = await as("ADMIN");
  state.actor = author;
});

async function as(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function line(firstName = "Mara", lastName = "Munteanu", note: string | null = "a scris pe contact") {
  const { id } = await addReserveEntry(db, author, eventId, { firstName, lastName, email: "mara@example.org", note: note ?? "" }, NOW);
  return id;
}

const row = async (id: string) => (await db.select().from(eventReserveEntries).where(eq(eventReserveEntries.id, id)))[0];
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

function press(entryId: string, firstName: string, lastName: string, listQuery = `eventId=${eventId}`): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("entryId", entryId);
  form.set("firstName", firstName);
  form.set("lastName", lastName);
  form.set("listQuery", listQuery);
  return form;
}

async function failureOf(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

describe("«Corectează numele» on a line of the internal list: the service", () => {
  it("fixes the name and keeps the line's place, note, address, author and creation moment", async () => {
    const first = await line("Mara", "Munteanu");
    const { id: second } = await addReserveEntry(db, author, eventId, { firstName: "Ion", lastName: "Ionescu", email: "", note: "" }, later(1));

    expect(await renameReserveEntry(db, author, first, { firstName: "  Maria ", lastName: "Munteanu-Pop" }, later(5))).toEqual({ eventId, changed: true });

    const fixed = await row(first);
    expect([fixed.firstName, fixed.lastName, fixed.email, fixed.note, fixed.createdByStaffUserId]).toEqual(["Maria", "Munteanu-Pop", "mara@example.org", "a scris pe contact", author.id]);
    expect(fixed.createdAt).toEqual(NOW);
    expect(fixed.updatedAt).toEqual(later(5));
    // The line stays first: the list orders by the moment it was written down.
    const ordered = await db.select().from(eventReserveEntries).orderBy(eventReserveEntries.createdAt, eventReserveEntries.id);
    expect(ordered.map((entry) => entry.id)).toEqual([first, second]);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("goes through the add's own parse: trimmed, not empty, the add's maximum, the boxes named", async () => {
    const id = await line();
    const tooLong = "x".repeat(RESERVE_NAME_MAX + 1);
    expect((await failureOf(renameReserveEntry(db, author, id, { firstName: "  ", lastName: "Pop" }, later(1)))).fields).toEqual(["firstName"]);
    expect((await failureOf(renameReserveEntry(db, author, id, { firstName: "Ana", lastName: tooLong }, later(1)))).fields).toEqual(["lastName"]);
    expect((await failureOf(renameReserveEntry(db, author, id, { firstName: "", lastName: "" }, later(1)))).fields).toEqual(["firstName", "lastName"]);
    expect((await failureOf(renameReserveEntry(db, author, id, { firstName: null, lastName: undefined }, later(1)))).code).toBe("VALIDATION_ERROR");
    // One function: the add's parse returns exactly what the rename's parse does for the name.
    const typed = { firstName: "  Ana ", lastName: " Pop  " };
    expect(parseReserveName(typed)).toEqual({ firstName: "Ana", lastName: "Pop" });
    expect(parseReserveEntry({ ...typed, email: "", note: "" })).toMatchObject(parseReserveName(typed));
    expect(await trail("event_reserve.renamed")).toEqual([]);
    const kept = await row(id);
    expect([kept.firstName, kept.lastName]).toEqual(["Mara", "Munteanu"]);
  });

  it("writes nothing for the same name, even typed with spaces round it", async () => {
    const id = await line();
    expect(await renameReserveEntry(db, author, id, { firstName: " Mara", lastName: "Munteanu  " }, later(3))).toEqual({ eventId, changed: false });
    expect((await row(id)).updatedAt).toEqual(NOW);
    expect(await trail("event_reserve.renamed")).toEqual([]);
  });

  it("records who, when and which line, never the old or the new name", async () => {
    const id = await line();
    await renameReserveEntry(db, author, id, { firstName: "Maria", lastName: "Munteanu" }, later(2));
    const [entry] = await trail("event_reserve.renamed");
    expect(entry).toMatchObject({ actorStaffUserId: author.id, entityType: "event", entityId: eventId, metadataJson: { entryId: id } });
    expect(entry.createdAt).toEqual(later(2));
    const words = JSON.stringify(entry);
    for (const name of ["Mara", "Maria", "Munteanu", "example.org", "contact"]) expect(words).not.toContain(name);
  });

  it("is the Organizer's and above, for all seven roles, and a refusal writes nothing", async () => {
    expect(STAFF_ROLES).toHaveLength(7);
    const id = await line();
    const permitted = STAFF_ROLES.filter((role) => canKeepRegistrationNotes(role)).length;
    expect(permitted).toBeGreaterThan(0);
    expect(permitted).toBeLessThan(7);
    for (const [index, role] of STAFF_ROLES.entries()) {
      const actor = role === author.role ? author : await as(role);
      const attempt = renameReserveEntry(db, actor, id, { firstName: `Nume${index}`, lastName: "Test" }, later(1));
      if (canKeepRegistrationNotes(role)) {
        expect((await attempt).changed, role).toBe(true);
        continue;
      }
      expect((await failureOf(attempt)).code, role).toBe("FORBIDDEN");
    }
    // Only the permitted roles wrote: one trail row each, none for a refused role.
    expect(await trail("event_reserve.renamed")).toHaveLength(permitted);
  });

  it("refuses a line moved or deleted meanwhile, plainly, and writes nothing", async () => {
    const id = await line();
    await deleteReserveEntry(db, author, id, later(1));
    expect((await failureOf(renameReserveEntry(db, author, id, { firstName: "Maria", lastName: "Munteanu" }, later(2)))).code).toBe("NOT_FOUND");
    expect((await failureOf(renameReserveEntry(db, author, "not-a-line", { firstName: "Maria", lastName: "Munteanu" }, later(2)))).code).toBe("NOT_FOUND");
    expect(await trail("event_reserve.renamed")).toEqual([]);
    expect(await db.select().from(eventReserveEntries)).toHaveLength(0);
  });
});

describe("«Corectează numele»: the press through the real action", () => {
  it("returns to the same list with the panel open, a toast, the new name on the line, and nothing typed in the address or the flash", async () => {
    const id = await line();
    const query = `eventId=${eventId}&page=2&sort=name&saved=reserveDeleted`;
    await expect(renameReserveEntryAction(null, press(id, "Maria", "Munteanu-Pop", query))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${eventId}&page=2&sort=name&saved=reserveRenamed#registrations-reserve`,
    );
    const fixed = await row(id);
    expect([fixed.firstName, fixed.lastName]).toEqual(["Maria", "Munteanu-Pop"]);
    expect(state.flashed).toEqual([{ kind: "success", key: "reserveRenamed" }]);
    expect(JSON.stringify(state.flashed)).not.toContain("Maria");
  });

  it("says quietly that nothing changed for the same name", async () => {
    const id = await line();
    await expect(renameReserveEntryAction(null, press(id, "Mara", "Munteanu"))).rejects.toThrow(/saved=reserveRenameUnchanged#registrations-reserve/);
    expect(state.flashed).toEqual([{ kind: "info", key: "reserveRenameUnchanged" }]);
    expect(await trail("event_reserve.renamed")).toEqual([]);
  });

  it("refuses back into the form with what was typed still in it", async () => {
    const id = await line();
    const outcome = await renameReserveEntryAction(null, press(id, "Maria", "   "));
    expect(outcome).toMatchObject({ error: "VALIDATION_ERROR", fields: ["lastName"] });
    expect(JSON.stringify(outcome)).toContain("Maria");
    expect((await row(id)).firstName).toBe("Mara");
    expect(state.flashed).toEqual([]);
  });

  it("refuses a line moved or deleted meanwhile, plainly", async () => {
    const id = await line();
    await deleteReserveEntry(db, author, id, later(1));
    expect(await renameReserveEntryAction(null, press(id, "Maria", "Munteanu"))).toMatchObject({ error: "NOT_FOUND" });
    expect(await renameReserveEntryAction(null, press("not-a-line", "Maria", "Munteanu"))).toMatchObject({ error: "NOT_FOUND" });
  });

  it("refuses a forged post from a role that may not keep the list, and writes nothing", async () => {
    const id = await line();
    for (const role of STAFF_ROLES.filter((candidate) => !canKeepRegistrationNotes(candidate))) {
      state.actor = await as(role);
      expect(await renameReserveEntryAction(null, press(id, "Maria", "Forged")), role).toMatchObject({ error: "FORBIDDEN" });
    }
    expect((await row(id)).firstName).toBe("Mara");
    expect(await trail("event_reserve.renamed")).toEqual([]);
    // The Organizer is let through.
    state.actor = await as("MODERATOR");
    await expect(renameReserveEntryAction(null, press(id, "Maria", "Munteanu"))).rejects.toThrow(/saved=reserveRenamed/);
  });

  it("has its words in both catalogues, plain", () => {
    for (const catalogue of [ro, en] as const) {
      expect(catalogue.Admin.reserve.rename.length).toBeGreaterThan(0);
      expect(catalogue.Admin.reserve.renameSave.length).toBeGreaterThan(0);
      expect(catalogue.Feedback.toast.reserveRenamed.length).toBeGreaterThan(0);
      expect(catalogue.Feedback.toast.reserveRenameUnchanged.length).toBeGreaterThan(0);
    }
    expect(ro.Admin.reserve.rename).toBe("Corectează numele");
    expect(ro.Admin.reserve.renameSave).toBe("Salvează numele");
  });
});
