import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { addRegistrationNote, deleteRegistrationNote, listRegistrationNotesForExport } from "@/modules/registrations/notes";
import { canKeepRegistrationNotes, canReadRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { readSheet, startListRows } from "../../helpers/xlsx";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §785 (amends §777, §172; BR-REQ-060-01, BR-REQ-037-03) — «cum stăm cu coloana de comentarii pentru participanți?
 * asta trebuie de asemenea să fie și în Excel!» (the owner, 2026-10-15), from a real database and through the export
 * route itself: the last column «Note interne» in the spreadsheet and in the CSV for a role that may keep notes,
 * newest first, the author as a role, the soft-deleted ones left out, read in one grouped query — and for no other
 * role, whatever the link says.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

let db: TestDatabase;
let close: () => Promise<void>;

// 15 October 2026: Brașov is on summer time (UTC+3).
const T0 = new Date("2026-10-15T09:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function createRace(title = "Crosul Notelor", slug = "crosul-notelor") {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T06:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${slug}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${slug}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: T0,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: StaffRole, name = `Colleague ${role}`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${name.toLowerCase().replaceAll(" ", ".")}@dev.test`, displayName: name, role }).returning();
  return user;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  state.db = db;
  await resetTables(db);
});

/** Three registrations: two live notes and one deleted on Ana, one whose author is gone on Bob, none on Cora. */
async function seed() {
  const race = await createRace();
  const ana = await register(race.id, "Ana Pop");
  const bob = await register(race.id, "Bob Ionescu");
  const cora = await register(race.id, "Cora Nimic");
  const organizer = await staff("MODERATOR", "Secretname Organizer");
  const admin = await staff("ADMIN", "Andrei Admin");
  const leaver = await staff("MODERATOR", "Leaving Colleague");
  await addRegistrationNote(db, organizer, ana, "prima: cere tricou S", T0);
  const { id: removed } = await addRegistrationNote(db, organizer, ana, "ștearsă: nu trebuie să apară", minutes(30));
  await addRegistrationNote(db, admin, ana, "a doua\nîn două rânduri", minutes(60));
  await deleteRegistrationNote(db, organizer, removed, minutes(61));
  await addRegistrationNote(db, leaver, bob, "venit cu copilul", minutes(5));
  await db.delete(staffUsers).where(eq(staffUsers.id, leaver.id));
  return { race, ana, bob, cora, organizer, admin };
}

const url = (eventId: string, extra = "") => `http://localhost/api/admin/registrations/export?eventId=${eventId}${extra}`;

async function sheetOf(response: Response) {
  expect(response.status).toBe(200);
  // The start list alone: the statistics footer under it (§NNN) is `statistics-footer.test.ts`'s to read.
  return startListRows(readSheet(Buffer.from(await response.arrayBuffer())).rows);
}

describe("§785 the spreadsheet's «Note interne» column, through the route", () => {
  it.each<StaffRole>(["MODERATOR", "ADMIN", "SUPERADMIN"])("%s gets it last, newest first, the author's role and never their name", async (role) => {
    const { race } = await seed();
    state.actor = await staff(role, `Reader ${role}`);

    const rows = await sheetOf(await exportRegistrations(new Request(url(race.id, "&format=xlsx"))));
    const header = rows[0];
    expect(header.at(-1)).toBe("Note interne");
    const column = header.length - 1;
    const cellOf = (name: string) => rows.find((row) => row[header.indexOf("Name")] === name)?.[column];
    // 09:00 UTC is 12:00 in Brașov; the newest note first; the deleted one's words are gone.
    expect(cellOf("Ana Pop")).toBe("15.10.2026 13:00 · Administrator: a doua\nîn două rânduri\n15.10.2026 12:00 · Organizator: prima: cere tricou S");
    expect(cellOf("Bob Ionescu")).toBe("15.10.2026 12:05 · cont șters: venit cu copilul");
    expect(cellOf("Cora Nimic") ?? "").toBe("");
    const everything = JSON.stringify(rows);
    for (const never of ["Secretname", "Andrei Admin", "Leaving Colleague", "ștearsă", "nu trebuie să apară"]) expect(everything).not.toContain(never);
  });

  it("is headed and worded in English when the list's language is English", async () => {
    const { race } = await seed();
    state.actor = await staff("ADMIN", "Reader");
    const rows = await sheetOf(await exportRegistrations(new Request(url(race.id, "&format=xlsx&lang=en"))));
    expect(rows[0].at(-1)).toBe("Internal notes");
    const cell = rows.find((row) => row[rows[0].indexOf("Name")] === "Ana Pop")?.at(-1);
    expect(cell).toBe("15.10.2026 13:00 · Administrator: a doua\nîn două rânduri\n15.10.2026 12:00 · Organizer: prima: cere tricou S");
    // A language that is not one of ours is Română.
    const fallback = await sheetOf(await exportRegistrations(new Request(url(race.id, "&format=xlsx&lang=xx"))));
    expect(fallback[0].at(-1)).toBe("Note interne");
  });

  it("keeps a note's words out of every other column and every other row", async () => {
    const { race } = await seed();
    state.actor = await staff("ADMIN", "Reader");
    const rows = await sheetOf(await exportRegistrations(new Request(url(race.id, "&format=xlsx"))));
    const column = rows[0].length - 1;
    for (const row of rows.slice(1)) {
      const others = row.filter((_, index) => index !== column).join("|");
      expect(others).not.toMatch(/tricou|copilul|două rânduri/);
    }
  });
});

describe("§785 the CSV's «Note interne» column, through the route", () => {
  it("is last, the same words, the line break kept inside the quoted field", async () => {
    const { race } = await seed();
    state.actor = await staff("MODERATOR", "Reader");
    const response = await exportRegistrations(new Request(url(race.id)));
    expect(response.status).toBe(200);
    const csv = await response.text();
    const [header] = csv.split("\r\n");
    expect(header.split(",").at(-1)).toBe("Note interne");
    expect(csv).toContain('"15.10.2026 13:00 · Administrator: a doua\nîn două rânduri\n15.10.2026 12:00 · Organizator: prima: cere tricou S"');
    expect(csv).toContain("15.10.2026 12:05 · cont șters: venit cu copilul");
    expect(csv).not.toMatch(/Secretname|Andrei Admin|ștearsă/);
    // A registration with no note ends with an empty cell, and the file is still one record a row.
    const cora = csv.split("\r\n").find((line) => line.includes("Cora Nimic"))!;
    expect(cora.endsWith(",")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(1 + 3);
  });

  it("is headed in English with ?lang=en", async () => {
    const { race } = await seed();
    state.actor = await staff("ADMIN", "Reader");
    const csv = await (await exportRegistrations(new Request(url(race.id, "&lang=en")))).text();
    expect(csv.split("\r\n")[0].split(",").at(-1)).toBe("Internal notes");
    expect(csv).toContain("· Organizer: prima: cere tricou S");
  });
});

describe("§785 who gets the column: by the role's own rule, on the server", () => {
  it("every role that may export gets it exactly when it may keep notes; every other role gets no file at all", async () => {
    const { race } = await seed();
    const seen: Record<string, string> = {};
    for (const role of STAFF_ROLES) {
      state.actor = await staff(role, `Role ${role}`);
      for (const format of ["xlsx", "csv"]) {
        const response = await exportRegistrations(new Request(url(race.id, format === "xlsx" ? "&format=xlsx" : "")));
        if (!canReadRegistrations(role)) {
          // The Tehnic role, the volunteer, the Redactor and a member: refused, whatever the link.
          expect(response.status, `${role} ${format}`).toBe(403);
          expect(await response.text(), `${role} ${format}`).not.toMatch(/tricou|copilul/);
          continue;
        }
        expect(response.status, `${role} ${format}`).toBe(200);
        const header = format === "xlsx" ? (readSheet(Buffer.from(await response.arrayBuffer())).rows[0] as string[]) : (await response.text()).split("\r\n")[0].split(",");
        expect(header.includes("Note interne"), `${role} ${format}`).toBe(canKeepRegistrationNotes(role));
        seen[role] = `${format}:${header.at(-1)}`;
      }
    }
    // Today the Organizer, the Administrator and the Superadministrator export, and all three keep notes.
    expect(Object.keys(seen).sort()).toEqual(["ADMIN", "MODERATOR", "SUPERADMIN"]);
  });

  it("the reader refuses every role that may not keep notes, never answering with an empty map", async () => {
    const { ana } = await seed();
    for (const role of STAFF_ROLES) {
      const actor = await staff(role, `Reader ${role}`);
      const read = listRegistrationNotesForExport(db, actor, [ana]);
      if (canKeepRegistrationNotes(role)) {
        expect((await read).get(ana)).toHaveLength(2);
      } else {
        await expect(read).rejects.toSatisfy((error) => isDomainError(error) && error.code === "FORBIDDEN");
      }
    }
  });

  it("records that the file carried the notes, and never a word of one", async () => {
    const { race } = await seed();
    state.actor = await staff("ADMIN", "Reader");
    await exportRegistrations(new Request(url(race.id, "&format=xlsx")));
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.exported"));
    expect(row.metadataJson).toMatchObject({ format: "xlsx", rowCount: 3, withNotes: true });
    expect(JSON.stringify(row)).not.toMatch(/tricou|copilul/);
  });
});

describe("§785 the notes of exactly the exported rows, read in one grouped query", () => {
  it("the reader groups by registration, newest first, live notes only, the role and no name", async () => {
    const { ana, bob, cora, organizer } = await seed();
    const notes = await listRegistrationNotesForExport(db, organizer, [ana, bob, cora, "not-a-uuid"]);
    expect([...notes.keys()].sort()).toEqual([ana, bob].sort());
    expect(notes.get(ana)?.map((note) => [note.body, note.authorRole])).toEqual([
      ["a doua\nîn două rânduri", "ADMIN"],
      ["prima: cere tricou S", "MODERATOR"],
    ]);
    expect(notes.get(bob)).toEqual([{ createdAt: minutes(5), authorRole: null, body: "venit cu copilul" }]);
    expect(Object.keys(notes.get(ana)![0]).sort()).toEqual(["authorRole", "body", "createdAt"]);
    expect(await listRegistrationNotesForExport(db, organizer, [])).toEqual(new Map());
  });

  it("is one select on the notes table for forty registrations, in the reader and in the route", async () => {
    const race = await createRace();
    const author = await staff("MODERATOR", "Author");
    const ids: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const id = await register(race.id, `Runner Numărul ${index}`);
      ids.push(id);
      if (index % 2 === 0) await addRegistrationNote(db, author, id, `nota ${index}`, minutes(index));
    }
    let onNotes = 0;
    const counting = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "select") return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof db.select>) => {
          const builder = (target.select as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
          return new Proxy(builder, {
            get(inner, key, innerReceiver) {
              if (key !== "from") return Reflect.get(inner, key, innerReceiver);
              return (table: unknown) => {
                if (table === registrationNotes) onNotes += 1;
                return inner.from(table);
              };
            },
          });
        };
      },
    }) as TestDatabase;

    await listRegistrationNotesForExport(counting, author, ids);
    expect(onNotes).toBe(1);

    onNotes = 0;
    state.db = counting;
    state.actor = await staff("ADMIN", "Reader");
    const rows = await sheetOf(await exportRegistrations(new Request(url(race.id, "&format=xlsx"))));
    expect(rows).toHaveLength(1 + 40);
    expect(onNotes).toBe(1);
    expect(rows.slice(1).filter((row) => row.at(-1)).length).toBe(20);
  });

  it("carries the notes of the exported event only, and none of a test registration (which the file omits)", async () => {
    const { race, ana } = await seed();
    const other = await createRace("Altă cursă", "alta");
    const stranger = await register(other.id, "Dan Altul");
    const test = await register(race.id, "Test Person", { kind: "TEST" });
    const author = await staff("MODERATOR", "Author");
    await addRegistrationNote(db, author, stranger, "nota altei curse", T0);
    await addRegistrationNote(db, author, test, "nota unui test", T0);
    state.actor = await staff("ADMIN", "Reader");
    const csv = await (await exportRegistrations(new Request(url(race.id)))).text();
    expect(csv).toContain("prima: cere tricou S");
    expect(csv).not.toMatch(/nota altei curse|nota unui test|Dan Altul|Test Person/);
    expect(ana).toBeDefined();
  });
});
