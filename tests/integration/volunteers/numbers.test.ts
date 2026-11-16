import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { bibNumberInUse, pickBibNumber, pickVolunteerNumber, runnersLastNumber } from "@/modules/registrations/bibs";
import { STAFF_ROLES, canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { buildVolunteersCsv } from "@/modules/volunteers/csv";
import { volunteerExport, volunteerExportHeader } from "@/modules/volunteers/export";
import { changeVolunteer, exportVolunteers, listVolunteers, setVolunteerNumbersStart } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the volunteers' numbers (the owner, 2026-11-15: «și voluntarii trebuie să aibă un „Nr de concurs"» — and, asked
 * which numbers, «Serie proprie»). BR-REQ-038-01, and BR-REQ-060-01 for who.
 *
 * What is protected, on real PostgreSQL (PGlite):
 * - an event gives its volunteers no number until «Numerele voluntarilor încep de la» is set, and the start is refused at
 *   or below any number a runner wears or may come to wear — a capped race's last number, the desk's spares, a number
 *   worn, retired or on the elite list;
 * - saving the start gives every confirmed volunteer without a number theirs, in the order they were added, and nobody
 *   else; a person confirmed later draws the next free one; nobody draws twice; a cancelled person keeps theirs;
 * - one number is one person at the event: a runner's draw and the desk's hand-typed number treat a volunteer's as worn,
 *   and a volunteer's draw steps over every number a runner, an elite line or the desk's spares hold;
 * - a deleted volunteer's number is never drawn again;
 * - the series switched off stops the draws and takes no number back;
 * - whoever may manage volunteers sets it, nobody else; the trail names the start and a count, never a person;
 * - the volunteers' file carries the number.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: Record<string, string> } }) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}${href.pathname.replace("[id]", href.params?.id ?? "")}`,
  Link: () => null,
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { setVolunteerNumbersStartAction } = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");

const NOW = new Date("2026-11-15T09:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;
let roleId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.redirected.length = 0;
  admin = await staff("ADMIN");
  state.actor = admin;
  // A race of 150 places whose runners' numbers start at 1: the runners' series is 1–150.
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 150, bibStartNumber: 1, locationName: "Start", acceptsVolunteers: true })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "cros", title: "Crosul" },
    { eventId, locale: "en", slug: "cross", title: "The cross" },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  roleId = role.id;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A volunteer as the card writes one, in the state given, added at `minute`. */
async function volunteer(name: string, volunteerState: "REGISTERED" | "CONFIRMED" | "CANCELLED", minute: number, bibNumber: number | null = null): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: volunteerState, source: "STAFF", roleId, bibNumber, createdAt: at(minute), updatedAt: at(minute) })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId, createdAt: at(minute) });
  return row.id;
}

/** A runner of the race wearing `bibNumber`, in the status given. */
async function runner(name: string, bibNumber: number | null, status: "CONFIRMED" | "CANCELLED" = "CONFIRMED"): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      confirmedAt: NOW,
      bibNumber,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
    })
    .returning({ id: registrations.id });
  return row.id;
}

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

const numberOf = async (id: string) => (await db.select({ bibNumber: eventVolunteers.bibNumber }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0]?.bibNumber ?? null;
const startOf = async () => (await db.select({ start: events.volunteerBibStart }).from(events).where(eq(events.id, eventId)))[0].start;
const trailOf = (action: string) => db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, eventId))).orderBy(asc(auditLogs.createdAt));
const confirm = (id: string, minute = 60) => changeVolunteer(db, admin, { kind: "setState", eventId, id, state: "CONFIRMED" }, at(minute), { sendEmail: false });
const setState = (id: string, next: "REGISTERED" | "CANCELLED", minute = 70) => changeVolunteer(db, admin, { kind: "setState", eventId, id, state: next }, at(minute), { sendEmail: false });

describe("§NNN BR-REQ-038-01 «Numerele voluntarilor încep de la»: the series' first number", () => {
  it("an event gives its volunteers no number until the start is set: a confirmation draws none", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBeNull();
    expect(await startOf()).toBeNull();
  });

  it("is refused at or below the runners' numbers — the capped race's last, the desk's spares, a number worn, retired or on the elite list — and writes nothing", async () => {
    expect(await runnersLastNumber(db, eventId)).toBe(150);
    for (const start of [1, 100, 150]) {
      const refusal = await failureOf(setVolunteerNumbersStart(db, admin, { eventId, start }, NOW));
      expect(refusal.code, String(start)).toBe("VOLUNTEER_NUMBERS_IN_RACE_SERIES");
      expect(refusal.fields).toEqual(["volunteerBibStart"]);
    }
    // A number typed by hand above the series, a line of the elite list, the desk's spares: each moves the runners' last number.
    await runner("Ion Ionescu", 420);
    expect(await runnersLastNumber(db, eventId)).toBe(420);
    await db.insert(eventEliteEntries).values({ eventId, name: "Eliud K.", bibNumber: 777 });
    expect(await runnersLastNumber(db, eventId)).toBe(777);
    await db.update(events).set({ walkInBibStart: 800, walkInBibCount: 20 }).where(eq(events.id, eventId));
    expect(await runnersLastNumber(db, eventId)).toBe(819);
    expect((await failureOf(setVolunteerNumbersStart(db, admin, { eventId, start: 819 }, NOW))).code).toBe("VOLUNTEER_NUMBERS_IN_RACE_SERIES");
    expect(await startOf()).toBeNull();
    expect(await trailOf("event.volunteer_numbers_start_set")).toEqual([]);

    expect(await setVolunteerNumbersStart(db, admin, { eventId, start: 820 }, NOW)).toEqual({ changed: true, assigned: 0 });
    expect(await startOf()).toBe(820);
  });

  it("refuses what is no number of a series, naming the box", async () => {
    for (const start of [0, -5, 1.5, Number.NaN, 99_001]) {
      const refusal = await failureOf(setVolunteerNumbersStart(db, admin, { eventId, start }, NOW));
      expect(refusal.code, String(start)).toBe("VALIDATION_ERROR");
      expect(refusal.fields).toEqual(["volunteerBibStart"]);
    }
    expect(await startOf()).toBeNull();
  });

  it("gives every confirmed volunteer without a number theirs, in the order they were added — never one waiting or cancelled — and says how many in the trail", async () => {
    const third = await volunteer("Carmen Dima", "CONFIRMED", 30);
    const first = await volunteer("Ana Pop", "CONFIRMED", 10);
    const waiting = await volunteer("Bogdan Stan", "REGISTERED", 15);
    const second = await volunteer("Dan Ene", "CONFIRMED", 20);
    const cancelled = await volunteer("Eva Radu", "CANCELLED", 5);

    expect(await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, NOW)).toEqual({ changed: true, assigned: 3 });
    expect([await numberOf(first), await numberOf(second), await numberOf(third)]).toEqual([500, 501, 502]);
    expect(await numberOf(waiting)).toBeNull();
    expect(await numberOf(cancelled)).toBeNull();

    const [row, ...more] = await trailOf("event.volunteer_numbers_start_set");
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: eventId });
    expect(row.metadataJson).toEqual({ from: null, to: 500, assigned: 3 });
    // Never a person: no name, no address, no row's id.
    for (const gone of ["Ana", "example.test", first]) expect(JSON.stringify(row)).not.toContain(gone);

    // The same start again changes nothing and writes nothing.
    expect(await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, at(5))).toEqual({ changed: false, assigned: 0 });
    expect(await trailOf("event.volunteer_numbers_start_set")).toHaveLength(1);
  });

  it("moved, the numbers given stay and the next person draws from the new start; emptied, nobody new draws and no number is taken back", async () => {
    const ana = await volunteer("Ana Pop", "CONFIRMED", 1);
    await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, NOW);
    expect(await numberOf(ana)).toBe(500);

    expect(await setVolunteerNumbersStart(db, admin, { eventId, start: 900 }, at(1))).toEqual({ changed: true, assigned: 0 });
    expect(await numberOf(ana)).toBe(500);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(dan);
    expect(await numberOf(dan)).toBe(900);

    expect(await setVolunteerNumbersStart(db, admin, { eventId, start: null }, at(2))).toEqual({ changed: true, assigned: 0 });
    expect(await startOf()).toBeNull();
    expect([await numberOf(ana), await numberOf(dan)]).toEqual([500, 900]);
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    await confirm(eva);
    expect(await numberOf(eva)).toBeNull();
    expect((await trailOf("event.volunteer_numbers_start_set")).map((row) => row.metadataJson)).toEqual([
      { from: null, to: 500, assigned: 1 },
      { from: 500, to: 900, assigned: 0 },
      { from: 900, to: null, assigned: 0 },
    ]);
  });

  it.each(STAFF_ROLES.filter((role) => !canManageVolunteers(role)).map((role) => [role] as const))("BR-REQ-060-01 refuses the %s role, and writes nothing", async (role) => {
    expect((await failureOf(setVolunteerNumbersStart(db, await staff(role), { eventId, start: 500 }, NOW))).code).toBe("FORBIDDEN");
    expect(await startOf()).toBeNull();
  });

  it.each(STAFF_ROLES.filter((role) => canManageVolunteers(role)).map((role) => [role] as const))("BR-REQ-060-01 serves the %s role", async (role) => {
    expect(await setVolunteerNumbersStart(db, await staff(role), { eventId, start: 500 }, NOW)).toEqual({ changed: true, assigned: 0 });
  });
});

describe("§NNN BR-REQ-038-01 a volunteer's number: drawn at the confirmation, once, and never taken back", () => {
  beforeEach(async () => {
    await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, NOW);
  });

  it("draws the next free number of the series when the organizers confirm the person, and writes it in the trail", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    expect(await numberOf(ana)).toBeNull();
    // Confirmed in the other order: the number follows the confirmation, as a runner's does.
    await confirm(dan, 60);
    await confirm(ana, 61);
    expect([await numberOf(dan), await numberOf(ana)]).toEqual([500, 501]);
    const states = await trailOf("volunteer.state_changed");
    expect(states.map((row) => (row.metadataJson as { bibNumber?: number }).bibNumber)).toEqual([500, 501]);
    expect((await listVolunteers(db, eventId)).map((person) => [person.name, person.bibNumber]).sort()).toEqual([
      ["Ana Pop", 501],
      ["Dan Ene", 500],
    ]);
  });

  it("keeps the number through a cancellation and a reopening, and never draws a second one", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(500);
    await setState(ana, "CANCELLED");
    expect(await numberOf(ana)).toBe(500);
    // Somebody confirmed meanwhile never gets the cancelled person's number.
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(dan, 80);
    expect(await numberOf(dan)).toBe(501);
    await confirm(ana, 90);
    expect(await numberOf(ana)).toBe(500);
    await setState(ana, "REGISTERED", 100);
    await confirm(ana, 110);
    expect(await numberOf(ana)).toBe(500);
  });

  it("a person who already holds a number keeps it at the confirmation: nobody draws a second one", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1, 27);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(27);
  });

  it("a deleted volunteer's number is never drawn again: the trail keeps it retired", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(500);
    await changeVolunteer(db, admin, { kind: "delete", eventId, id: ana }, at(70));
    const [deleted] = await trailOf("volunteer.deleted");
    expect(deleted.metadataJson).toMatchObject({ bibNumber: 500 });
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(dan, 80);
    expect(await numberOf(dan)).toBe(501);
    // A person deleted before they had a number leaves none in the trail.
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    await changeVolunteer(db, admin, { kind: "delete", eventId, id: eva }, at(90));
    expect((await trailOf("volunteer.deleted")).at(-1)?.metadataJson).not.toHaveProperty("bibNumber");
  });
});

describe("§NNN BR-REQ-038-01 one number is one person at the event", () => {
  it("a volunteer's draw steps over every number a runner wears — a cancelled one's too — an elite line's, a retired one and the desk's spares", async () => {
    // The series was set at 500 while nothing stood there; then numbers came to stand in its way.
    await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, NOW);
    await runner("Ion Ionescu", 500);
    await runner("Mara Dima", 501, "CANCELLED");
    await db.insert(eventEliteEntries).values({ eventId, name: "Eliud K.", bibNumber: 502 });
    // 503 was a volunteer's, deleted: retired through the trail.
    await db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "volunteer.deleted", entityType: "event", entityId: eventId, metadataJson: { volunteerId: "x", bibNumber: 503 }, createdAt: NOW });
    await db.update(events).set({ walkInBibStart: 504, walkInBibCount: 3 }).where(eq(events.id, eventId));

    expect(await pickVolunteerNumber(db, eventId, 500)).toBe(507);
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(507);
  });

  it("a runner's draw and the desk's hand-typed number treat a volunteer's number as worn, whatever the volunteer's state", async () => {
    // Volunteers wearing numbers inside the race's own series — rows from before the start was moved above it.
    await volunteer("Ana Pop", "CONFIRMED", 1, 1);
    await volunteer("Dan Ene", "CANCELLED", 2, 2);
    expect(await pickBibNumber(db, eventId)).toBe(3);
    expect(await bibNumberInUse(db, { eventId, number: 1 })).toBe(true);
    expect(await bibNumberInUse(db, { eventId, number: 2 })).toBe(true);
    expect(await bibNumberInUse(db, { eventId, number: 3 })).toBe(false);
  });

  it("the table itself refuses one number on two volunteers of an event, and takes it at another event", async () => {
    await volunteer("Ana Pop", "CONFIRMED", 1, 500);
    await expect(volunteer("Dan Ene", "CONFIRMED", 2, 500)).rejects.toThrow();
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2099-12-21T08:00:00.000Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning({ id: events.id });
    await db.insert(eventVolunteers).values({ eventId: other.id, name: "Dan Ene", state: "CONFIRMED", source: "STAFF", bibNumber: 500 });
  });
});

describe("§NNN the number in the volunteers' file and on the card's own form", () => {
  it("is the file's last column, empty for a person without one — in both languages", async () => {
    await setVolunteerNumbersStart(db, admin, { eventId, start: 500 }, NOW);
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(ana);
    const data = await exportVolunteers(db, admin, eventId, at(120));
    const words = (catalogue: typeof ro) => (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue.Admin) as string;
    const csv = buildVolunteersCsv(volunteerExportHeader(words(ro)), volunteerExport(data, "ro", words(ro), new Map()).rows);
    const lines = csv.split("\r\n");
    expect(lines[0].endsWith(",Număr")).toBe(true);
    expect(lines.find((line) => line.includes("Ana Pop"))?.endsWith(",500")).toBe(true);
    expect(lines.find((line) => line.includes("Dan Ene"))?.endsWith(",")).toBe(true);
    expect(volunteerExportHeader(words(en as unknown as typeof ro)).bibNumber).toBe("Number");
  });

  it("the card's box saves digits, refuses anything else and a start among the runners' numbers in words, and empties the series", async () => {
    const press = async (start: string) => {
      const form = new FormData();
      form.set("uiLocale", "ro");
      form.set("eventId", eventId);
      form.set("start", start);
      state.redirected.length = 0;
      await setVolunteerNumbersStartAction(form).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
      });
      return state.redirected[0] ?? "";
    };
    expect(await press("500")).toBe(`/ro/admin/events/${eventId}#box-volunteers`);
    expect(await startOf()).toBe(500);
    // Among the runners' numbers: refused with its own sentence, the series as it was.
    expect(await press("120")).toContain("volunteerError=VOLUNTEER_NUMBERS_IN_RACE_SERIES");
    expect(await startOf()).toBe(500);
    for (const typed of ["12.5", "1e3", "abc", "-4"]) expect(await press(typed), typed).toContain("volunteerError=VALIDATION_ERROR");
    expect(await startOf()).toBe(500);
    expect(await press("  ")).toBe(`/ro/admin/events/${eventId}#box-volunteers`);
    expect(await startOf()).toBeNull();
    // The words exist in both languages.
    expect(ro.Admin.errors.VOLUNTEER_NUMBERS_IN_RACE_SERIES.length).toBeGreaterThan(0);
    expect(en.Admin.errors.VOLUNTEER_NUMBERS_IN_RACE_SERIES.length).toBeGreaterThan(0);
    expect(ro.Feedback.toast.volunteerNumbersOn.length).toBeGreaterThan(0);
    expect(en.Feedback.toast.volunteerNumbersOff.length).toBeGreaterThan(0);
  });
});
