import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerNotes } from "@/db/schema/event-volunteer-notes";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { volunteerNotesCells } from "@/modules/volunteers/export";
import { addVolunteerNote, deleteVolunteerNote } from "@/modules/volunteers/volunteer-notes";
import { EXPORT_NOTES_CELL_MAX } from "@/shared/notes/note-text";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * «Note interne» for volunteers in the volunteers' files (after §785): the CSV and both spreadsheets keep the column «Notă» where
 * it was and under the same heading; its cell is the volunteer's live notes in a registration's cell format — one note a line,
 * newest first, «dd.mm.yyyy hh:mm · <the author's ROLE>: <text>», never a colleague's name, a deleted note left out, cut at a
 * note's end below what Excel keeps with the volunteers' own closing line. One grouped read per file. Made-up people only.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
    createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET: eventFile } = await import("@/app/api/admin/events/[id]/volunteers/route");
const { GET: everyEventFile } = await import("@/app/api/admin/volunteers/export/route");

// 10:00 and 10:05 UTC on 11 November: 12:00 and 12:05 on the club's clock (Bucharest, winter time).
const AT = new Date("2026-11-11T10:00:00.000Z");
const LATER = new Date("2026-11-11T10:05:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let crossId: string;
let trailId: string;
const people: Record<"ana" | "dan" | "mara", string> = { ana: "", dan: "", mara: "" };
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function seedEvent(title: string, startsAt: string) {
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date(startsAt), acceptsVolunteers: true }).returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `ro-${event.id.slice(0, 8)}`, title },
    { eventId: event.id, locale: "en", slug: `en-${event.id.slice(0, 8)}`, title: `${title} (EN)` },
  ]);
  return event.id;
}

async function seedPerson(eventId: string, name: string, roleId: string, createdAt: string) {
  const email = `${name.toLowerCase().replace(/\s/g, ".")}@example.test`;
  const [person] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "0712345678", source: "PUBLIC", state: "CONFIRMED", roleId, createdAt: new Date(createdAt) })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleChoices).values({ volunteerId: person.id, roleId });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: person.id, roleId });
  return person.id;
}

beforeEach(async () => {
  await resetTables(db);
  for (const [role, name] of [
    ["ADMIN", "Andrei Secretadmin"],
    ["MODERATOR", "Ioana Secretorg"],
  ] as const) {
    const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
    staff[role] = user;
  }
  state.actor = staff.ADMIN;
  crossId = await seedEvent("Crosul", "2026-11-21T08:00:00.000Z");
  trailId = await seedEvent("Tâmpa Trail", "2027-05-10T07:00:00.000Z");
  const [water] = await db.insert(eventVolunteerRoles).values({ eventId: crossId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 }).returning({ id: eventVolunteerRoles.id });
  const [marshal] = await db.insert(eventVolunteerRoles).values({ eventId: trailId, nameRo: "Marcaj", nameEn: "Marking", needed: 2, position: 0 }).returning({ id: eventVolunteerRoles.id });
  people.ana = await seedPerson(crossId, "Ana Pop", water.id, "2026-10-01T10:00:00.000Z");
  people.dan = await seedPerson(crossId, "Dan Ene", water.id, "2026-10-02T10:00:00.000Z");
  people.mara = await seedPerson(trailId, "Mara Dinu", marshal.id, "2026-10-05T10:00:00.000Z");
  await addVolunteerNote(db, staff.MODERATOR!, people.ana, "vine doar dimineața", AT);
  await addVolunteerNote(db, staff.ADMIN!, people.ana, "are mașină\ncu 4 locuri", LATER);
  const { id: gone } = await addVolunteerNote(db, staff.ADMIN!, people.dan, "ștearsă", AT);
  await deleteVolunteerNote(db, staff.ADMIN!, gone, LATER);
  // A carried line nobody can be named for.
  await db.insert(eventVolunteerNotes).values({ volunteerId: people.mara, body: "Sună după 18", createdAt: AT });
});

const oneEvent = (query: string) => eventFile(new Request(`http://localhost/api/admin/events/${crossId}/volunteers?${query}`), { params: Promise.resolve({ id: crossId }) });
const allEvents = (query: string) => everyEventFile(new Request(`http://localhost/api/admin/volunteers/export?${query}`));
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

const ANA_RO = "11.11.2026 12:05 · Administrator: are mașină\ncu 4 locuri\n11.11.2026 12:00 · Organizator: vine doar dimineața";
const ANA_EN = "11.11.2026 12:05 · Administrator: are mașină\ncu 4 locuri\n11.11.2026 12:00 · Organizer: vine doar dimineața";

/** One CSV file's rows — quoted cells may hold line breaks and doubled quotes. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows;
}

describe("the «Notă» column of the volunteers' files", () => {
  it("is the CSV's ninth column, under the same heading, holding the notes newest first with the author's role — never a name", async () => {
    const text = new TextDecoder().decode(await bytes(await oneEvent("lang=ro"))).replace(/^﻿/, "");
    const [header, ...rows] = csvRows(text);
    expect(header.indexOf(ro.Admin.volunteers.csvColumns.note)).toBe(8);
    expect(header[9]).toBe(ro.Admin.volunteers.csvColumns.signedUpAt);
    const cellOf = (name: string) => rows.find((row) => row[2] === name)![8];
    expect(cellOf("Ana Pop")).toBe(ANA_RO);
    // A deleted note is left out; nothing left is an empty cell.
    expect(cellOf("Dan Ene")).toBe("");
    expect(text).not.toMatch(/Secretadmin|Secretorg|ștearsă/);
  });

  it("is the event's spreadsheet's last column, the same cell — and in English with ?lang=en", async () => {
    const { rows } = readSheet(await bytes(await oneEvent("format=xlsx&lang=ro")));
    const header = rows[0];
    expect(header.at(-1)).toBe(ro.Admin.volunteers.csvColumns.note);
    expect(header.at(-2)).toBe(ro.Admin.volunteers.csvColumns.message);
    const cellOf = (sheet: (string | undefined)[][], name: string) => sheet.find((row) => row[0] === name)!.at(-1);
    expect(cellOf(rows, "Ana Pop")).toBe(ANA_RO);
    expect(cellOf(rows, "Dan Ene")).toBeUndefined();
    const english = readSheet(await bytes(await oneEvent("format=xlsx&lang=en"))).rows;
    expect(english[0].at(-1)).toBe(en.Admin.volunteers.csvColumns.note);
    expect(cellOf(english, "Ana Pop")).toBe(ANA_EN);
    expect(JSON.stringify([rows, english])).not.toMatch(/Secretadmin|Secretorg|ștearsă/);
  });

  it("is in every event's spreadsheet too, «autor necunoscut» for a carried note nobody can be named for — read in ONE grouped query", async () => {
    let reads = 0;
    const real = db.select.bind(db);
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      const query = (real as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
      const from = query.from.bind(query);
      query.from = ((table: unknown) => {
        if (table === eventVolunteerNotes) reads += 1;
        return from(table);
      }) as never;
      return query as never;
    }) as never);
    let buffer: Buffer;
    try {
      buffer = await bytes(await allEvents("lang=ro"));
    } finally {
      spy.mockRestore();
    }
    // Two events, three people: one read of the notes for the whole file.
    expect(reads).toBe(1);
    const { rows } = readSheet(buffer);
    const header = rows[0];
    const column = header.indexOf(ro.Admin.volunteers.csvColumns.note);
    expect(column).toBe(header.length - 1);
    const cellOf = (name: string) => rows.find((row) => row.includes(name))![column];
    expect(cellOf("Ana Pop")).toBe(ANA_RO);
    expect(cellOf("Mara Dinu")).toBe("11.11.2026 12:00 · autor necunoscut: Sună după 18");
    expect(JSON.stringify(rows)).not.toMatch(/Secretadmin|Secretorg|cont șters/);
  });

  it("reads the event's file in ONE grouped query too", async () => {
    let reads = 0;
    const real = db.select.bind(db);
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      const query = (real as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
      const from = query.from.bind(query);
      query.from = ((table: unknown) => {
        if (table === eventVolunteerNotes) reads += 1;
        return from(table);
      }) as never;
      return query as never;
    }) as never);
    try {
      await oneEvent("lang=ro");
    } finally {
      spy.mockRestore();
    }
    expect(reads).toBe(1);
  });

  it("is cut at a note's end below what Excel keeps, with the volunteers' own closing line", () => {
    const t = createTranslator({ locale: "ro", messages: ro, namespace: "Admin" }) as unknown as (key: string) => string;
    const many = Array.from({ length: 40 }, (_, index) => ({ createdAt: AT, authorRole: "MODERATOR" as const, body: `${index} ${"x".repeat(1990)}` }));
    const cell = volunteerNotesCells(new Map([["v", many]]), t).get("v")!;
    expect(cell.length).toBeLessThanOrEqual(EXPORT_NOTES_CELL_MAX);
    expect(cell.split("\n").at(-1)).toBe("… (mai multe note pe pagina voluntarului)");
    expect(cell.split("\n")[0]).toMatch(/^11\.11\.2026 12:00 · Organizator: 0 x+$/);
    const english = createTranslator({ locale: "en", messages: en, namespace: "Admin" }) as unknown as (key: string) => string;
    expect(volunteerNotesCells(new Map([["v", many]]), english).get("v")!.split("\n").at(-1)).toBe("… (more notes on the volunteer's page)");
  });
});
