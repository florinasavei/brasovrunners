import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { readSheet } from "../../helpers/xlsx";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §785 (BR-REQ-060-01) — the route's «may export but may not keep notes» path. Today `canKeepRegistrationNotes` and
 * `canReadRegistrations` are the same set, so no real role reaches it; here the first predicate alone is turned off,
 * as moving either boundary would, and the file must come without «Note interne», the notes' reader must never be
 * called, and the trail must say `withNotes: false`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, mayKeep: true }));

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
vi.mock("@/modules/staff-identity/domain/roles", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/staff-identity/domain/roles")>();
  return { ...original, canKeepRegistrationNotes: (subject: Parameters<typeof original.canKeepRegistrationNotes>[0]) => state.mayKeep && original.canKeepRegistrationNotes(subject) };
});
vi.mock("@/modules/registrations/notes", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/registrations/notes")>();
  return { ...original, listRegistrationNotesForExport: vi.fn(original.listRegistrationNotesForExport) };
});

const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");
const { addRegistrationNote, listRegistrationNotesForExport } = await import("@/modules/registrations/notes");

let db: TestDatabase;
let close: () => Promise<void>;

const T0 = new Date("2026-10-15T09:00:00.000Z");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  state.db = db;
  state.mayKeep = true;
  vi.mocked(listRegistrationNotesForExport).mockClear();
  await resetTables(db);
});

async function seed(): Promise<{ eventId: string; admin: StaffUser }> {
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
    { eventId: event.id, locale: "ro", slug: "fara-note-ro", title: "Crosul Fără Note" },
    { eventId: event.id, locale: "en", slug: "fara-note-en", title: "Crosul Fără Note" },
  ]);
  const email = "runner@example.org";
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId: event.id,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: resolveDisplayName({ legalName: "Ana Pop" }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: T0,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
    })
    .returning({ id: registrations.id });
  const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  await addRegistrationNote(db, admin, registration.id, "nota care nu pleacă", T0);
  return { eventId: event.id, admin };
}

describe("§785 a role that may export but not keep notes", () => {
  it("gets the spreadsheet and the CSV without the column, the reader never called, the trail saying so", async () => {
    const { eventId, admin } = await seed();
    state.actor = admin;
    state.mayKeep = false;

    const xlsx = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${eventId}&format=xlsx`));
    expect(xlsx.status).toBe(200);
    const header = readSheet(Buffer.from(await xlsx.arrayBuffer())).rows[0] as string[];
    expect(header).not.toContain("Note interne");

    const csv = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${eventId}`));
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).not.toContain("Note interne");
    expect(text).not.toContain("nota care nu pleacă");

    expect(listRegistrationNotesForExport).not.toHaveBeenCalled();
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.exported"));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.metadataJson).toMatchObject({ withNotes: false });
  });

  it("control: with the predicate on, the same call carries the column and reads the notes once", async () => {
    const { eventId, admin } = await seed();
    state.actor = admin;
    const xlsx = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${eventId}&format=xlsx`));
    const header = readSheet(Buffer.from(await xlsx.arrayBuffer())).rows[0] as string[];
    expect(header.at(-1)).toBe("Note interne");
    expect(listRegistrationNotesForExport).toHaveBeenCalledTimes(1);
  });
});
