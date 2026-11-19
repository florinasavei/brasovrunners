import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { STAFF_ROLES, canManageVolunteers, canReadRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { buildRaffleCsv, canTakeRaffleList, exportRaffleList, raffleCsvFileName } from "@/modules/volunteers/raffle-list";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §948 — «Lista pentru tombolă» (the owner, 2026-11-15: «vreau să fac o tombolă și trebuie să pot exporta toți voluntarii
 * și toți participanții»). BR-REQ-071-01, and BR-REQ-060-01 for who.
 *
 * What is protected, on real PostgreSQL (PGlite), through the service and the real route:
 * - the file is everybody who wears a number at the event — the confirmed runners and the confirmed volunteers — by the
 *   number, each once: never a registration that waits, is held, cancelled or a test one, never a cancelled volunteer,
 *   anybody without a number or another event's person; and since §984 a line of the race's elite list takes part like a
 *   person, «Elită» by its number (the three groups and the two modes are `raffle-sign-up.test.ts`'s);
 * - three columns and nothing else of a person: the number, the name, which of the two they are — in the reader's language;
 * - whoever reads the registrations and works the volunteers takes it; every other role is refused, by the service and
 *   by the route;
 * - the download is recorded with two counts, never a name or a number.
 *
 * §983 (the owner, 2026-11-18, three days before the race: «La voluntari trebuie să trec prezent/absent ca să pot face tombola
 * doar pentru cei prezenți»): a volunteer's «Prezent» is «Da» or «Nu» by the organizers' tick (`event_volunteers.present`), as a
 * runner's is by the desk's check-in; and `?present=1` is a second file beside the whole one — the same rules, of whom only the
 * runners the desk checked in and the volunteers ticked «Prezent» — under a name of its own, its download said in the trail.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) {
      const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
      throw new Refusal("UNAUTHENTICATED", "nobody is signed in");
    }
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));

const { GET } = await import("@/app/api/admin/events/[id]/raffle/route");

const NOW = new Date("2026-11-15T09:00:00.000Z");

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
  admin = await staff("ADMIN");
  state.actor = admin;
  ({ eventId, roleId } = await race("Crosul"));
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function race(title: string) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 150, bibStartNumber: 1, volunteerBibStart: 500, locationName: "Start" })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${serial}`, title },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `${title} (en)` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

async function runner(name: string, bibNumber: number | null, status: "CONFIRMED" | "CANCELLED" | "WAITLISTED" | "PENDING_DECLARATION" = "CONFIRMED", more: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  await db.insert(registrations).values({
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
    bibNumber,
    ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
    ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
    ...(status === "WAITLISTED" ? { waitlistedAt: NOW } : {}),
    ...more,
  });
}

async function volunteer(
  name: string,
  bibNumber: number | null,
  volunteerState: "REGISTERED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED",
  at: { eventId: string; roleId: string } = { eventId, roleId },
  more: Partial<typeof eventVolunteers.$inferInsert> = {},
) {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: at.eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: volunteerState, source: "STAFF", roleId: at.roleId, bibNumber, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: at.roleId });
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

const trail = () => db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.raffle_list_exported"), eq(auditLogs.entityId, eventId)));
const file = (id: string, query = "") => GET(new Request(`http://localhost/api/admin/events/${id}/raffle${query}`), { params: Promise.resolve({ id }) });

/** The owner's race: runners, volunteers, and everybody who must not be in the draw. */
async function everybody() {
  await runner("Radu Munteanu", 2);
  await runner("Ana Pop", 1);
  await runner("Elena Waiting", null, "WAITLISTED");
  await runner("Dan Held", null, "PENDING_DECLARATION");
  await runner("Mara Cancelled", 3, "CANCELLED");
  await runner("Confirmed Nonumber", null);
  await runner("Test Runner", 9, "CONFIRMED", { kind: "TEST" });
  await volunteer("Oana Voluntar", 501);
  await volunteer("Ion Voluntar", 500);
  await volunteer("Vlad Offered", null, "REGISTERED");
  await volunteer("Zoe Cancelled", 502, "CANCELLED");
  await volunteer("Confirmed Nonumber Volunteer", null);
  // A line of the race's elite list: in the draw since §984, «Elită» by its number — «Elitele» is ticked by default.
  await db.insert(eventEliteEntries).values({ eventId, name: "Eliud K.", bibNumber: 777 });
  // Another event's people, wearing numbers of their own.
  const other = await race("Alt cros");
  await volunteer("Other Event Volunteer", 600, "CONFIRMED", other);
}

describe("§948 BR-REQ-071-01 «Lista pentru tombolă»: everybody who wears a number, by the number", () => {
  it("holds the confirmed runners and the confirmed volunteers who have a number — each once, in the order of the numbers — and nobody else", async () => {
    await everybody();
    const list = await exportRaffleList(db, admin, eventId, NOW);
    expect(list.rows).toEqual([
      // «Prezent» (§949, §983): nobody was checked in at the desk yet, and no volunteer was ticked «Prezent» on the «Voluntari» list.
      { number: 1, name: "Ana Pop", kind: "RUNNER", present: false },
      { number: 2, name: "Radu Munteanu", kind: "RUNNER", present: false },
      { number: 500, name: "Ion Voluntar", kind: "VOLUNTEER", present: false },
      { number: 501, name: "Oana Voluntar", kind: "VOLUNTEER", present: false },
      { number: 777, name: "Eliud K.", kind: "ELITE", present: false },
    ]);
    expect(list).toMatchObject({ runners: 2, elites: 1, volunteers: 2 });
    expect(new Set(list.rows.map((row) => row.number)).size).toBe(list.rows.length);
  });

  it("§949 leaves out whoever an organizer took out of the raffle, and says which runners the desk checked in", async () => {
    await everybody();
    // Radu is unticked on the registrations' list, Oana on the volunteers'; Ana was checked in at the desk.
    await db.update(registrations).set({ inRaffle: false }).where(eq(registrations.registeredName, "Radu Munteanu"));
    await db.update(eventVolunteers).set({ inRaffle: false }).where(eq(eventVolunteers.name, "Oana Voluntar"));
    await db.update(registrations).set({ checkedInAt: NOW }).where(eq(registrations.registeredName, "Ana Pop"));
    const list = await exportRaffleList(db, admin, eventId, NOW);
    expect(list.rows).toEqual([
      { number: 1, name: "Ana Pop", kind: "RUNNER", present: true },
      { number: 500, name: "Ion Voluntar", kind: "VOLUNTEER", present: false },
      { number: 777, name: "Eliud K.", kind: "ELITE", present: false },
    ]);
    expect(list).toMatchObject({ runners: 1, elites: 1, volunteers: 1 });
    // Ticked again, they are back: the mark is the only thing that took them out.
    await db.update(registrations).set({ inRaffle: true }).where(eq(registrations.registeredName, "Radu Munteanu"));
    expect((await exportRaffleList(db, admin, eventId, NOW)).rows.map((row) => row.name)).toEqual(["Ana Pop", "Radu Munteanu", "Ion Voluntar", "Eliud K."]);
  });

  it("is empty, not an error, on an event where nobody has a number yet", async () => {
    await runner("Elena Waiting", null, "WAITLISTED");
    expect(await exportRaffleList(db, admin, eventId, NOW)).toEqual({ rows: [], runners: 0, elites: 0, volunteers: 0 });
  });

  it("records the download with two counts — who, which event, never a name or a number", async () => {
    await everybody();
    await exportRaffleList(db, admin, eventId, NOW);
    const [row, ...more] = await trail();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityType: "event", entityId: eventId, createdAt: NOW });
    // Which of the two files (§983): the whole one.
    expect(row.metadataJson).toEqual({ runners: 2, elites: 1, volunteers: 2, onlyPresent: false, signUp: false });
  });

  it("BR-REQ-060-01: is taken by whoever reads the registrations and works the volunteers — the Organizer and the Administrators — and refused to every other role, nothing recorded", async () => {
    await everybody();
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      const may = canReadRegistrations(role) && canManageVolunteers(role);
      expect(canTakeRaffleList(role), role).toBe(may);
      if (may) {
        expect((await exportRaffleList(db, actor, eventId, NOW)).rows, role).toHaveLength(5);
        continue;
      }
      expect((await failureOf(exportRaffleList(db, actor, eventId, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(canTakeRaffleList("MODERATOR")).toBe(true);
    expect(canTakeRaffleList("DEV")).toBe(false);
    expect((await trail()).length).toBe(STAFF_ROLES.filter((role) => canTakeRaffleList(role)).length);
    expect((await failureOf(exportRaffleList(db, admin, "not-an-id", NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(exportRaffleList(db, admin, "00000000-0000-4000-8000-000000000000", NOW))).code).toBe("NOT_FOUND");
  });
});

describe("§948 BR-REQ-071-01 the file", () => {
  const words = (catalogue: typeof ro) => ({
    ...catalogue.Admin.registrations.raffle.columns,
    kinds: catalogue.Admin.registrations.raffle.kinds,
    presentYes: catalogue.Admin.registrations.raffle.present.yes,
    presentNo: catalogue.Admin.registrations.raffle.present.no,
  });

  it("is four columns — the number, the name, which of the two, whether the person is present (§949, §983) — with a BOM, CRLF lines and every cell made safe for a spreadsheet", () => {
    const csv = buildRaffleCsv(words(ro), [
      { number: 1, name: "Ana Pop", kind: "RUNNER", present: true },
      { number: 2, name: '=HYPERLINK("x")', kind: "RUNNER", present: false },
      { number: 500, name: "Pop, Ion", kind: "VOLUNTEER", present: true },
      { number: 501, name: "Oana Voluntar", kind: "VOLUNTEER", present: false },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // A volunteer's «Prezent» is said as a runner's (§983): «Da» or «Nu», by the tick on the «Voluntari» list — never an empty cell.
    expect(csv.slice(1)).toBe(['Număr,Nume,Categorie,Prezent', "1,Ana Pop,Alergător,Da", `2,"'=HYPERLINK(""x"")",Alergător,Nu`, '500,"Pop, Ion",Voluntar,Da', "501,Oana Voluntar,Voluntar,Nu", ""].join("\r\n"));
    expect(buildRaffleCsv(words(en), [{ number: 500, name: "Ion", kind: "VOLUNTEER", present: true }]).slice(1)).toBe("Number,Name,Category,Present\r\n500,Ion,Volunteer,Yes\r\n");
    expect(buildRaffleCsv(words(en), []).slice(1)).toBe("Number,Name,Category,Present\r\n");
    expect(raffleCsvFileName("2026-11-21")).toBe("tombola-2026-11-21.csv");
    // The present-only file has a name of its own, plain ASCII (§983); only a real `true` asks for it.
    expect(raffleCsvFileName("2026-11-21", { onlyPresent: true })).toBe("tombola-prezenti-2026-11-21.csv");
    expect(raffleCsvFileName("2026-11-21", { onlyPresent: false })).toBe("tombola-2026-11-21.csv");
    expect(raffleCsvFileName("2026-11-21", { onlyPresent: true })).toMatch(/^[\x20-\x7e]+$/);
  });

  it("is served by the route in the reader's language, as a private download named by the club's day", async () => {
    await everybody();
    const response = await file(eventId, "?lang=en");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="tombola-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    const body = await response.text();
    expect(body.replace(/^﻿/, "").split("\r\n")).toEqual(["Number,Name,Category,Present", "1,Ana Pop,Runner,No", "2,Radu Munteanu,Runner,No", "500,Ion Voluntar,Volunteer,No", "501,Oana Voluntar,Volunteer,No", "777,Eliud K.,Elite,No", ""]);
    // Romanian by default, and for a language the site does not speak.
    expect((await (await file(eventId, "?lang=xx")).text()).replace(/^﻿/, "").split("\r\n")[0]).toBe("Număr,Nume,Categorie,Prezent");
    // Nothing else of anybody: no address, no telephone.
    expect(body).not.toContain("@");
    expect(body).not.toContain("+407");
  });

  it("BR-REQ-060-01: the route refuses whoever is not signed in, a role that may not take it, and an event that is not there", async () => {
    await everybody();
    expect((await file("not-an-id")).status).toBe(404);
    expect((await file("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    for (const role of STAFF_ROLES.filter((candidate) => !canTakeRaffleList(candidate))) {
      state.actor = await staff(role);
      const refused = await file(eventId);
      expect(refused.status, role).toBe(403);
      expect(await refused.text(), role).not.toContain("Ana Pop");
    }
    state.actor = undefined;
    expect((await file(eventId)).status).toBe(401);
    expect(await trail()).toEqual([]);
  });
});

describe("§983 BR-REQ-071-01 «Prezent» for a volunteer, and «Lista pentru tombolă — doar prezenții»", () => {
  /**
   * The owner's race on Saturday: two runners checked in at the desk (Ana, and Dana who was taken out of the raffle), one not
   * (Radu); two volunteers ticked «Prezent» (Ion, and Zoe who was cancelled since), one not (Oana) — and the people the whole file
   * never holds, each of them «present» too, so the short file is seen to keep its rules: a test runner checked in, a confirmed
   * runner checked in without a number, a ticked volunteer still «Înscris», a ticked one with no number, a ticked one taken out.
   */
  async function saturday() {
    await runner("Ana Pop", 1, "CONFIRMED", { checkedInAt: NOW });
    await runner("Radu Munteanu", 2);
    await runner("Dana Outside", 4, "CONFIRMED", { checkedInAt: NOW, inRaffle: false });
    await runner("Test Runner", 9, "CONFIRMED", { kind: "TEST", checkedInAt: NOW });
    await runner("Confirmed Nonumber", null, "CONFIRMED", { checkedInAt: NOW });
    await volunteer("Ion Voluntar", 500, "CONFIRMED", { eventId, roleId }, { present: true });
    await volunteer("Oana Voluntar", 501);
    await volunteer("Zoe Cancelled", 502, "CANCELLED", { eventId, roleId }, { present: true });
    await volunteer("Vlad Offered", null, "REGISTERED", { eventId, roleId }, { present: true });
    await volunteer("Nonumber Volunteer", null, "CONFIRMED", { eventId, roleId }, { present: true });
    await volunteer("Out Volunteer", 503, "CONFIRMED", { eventId, roleId }, { present: true, inRaffle: false });
    // Another event's volunteer, ticked present at their own race.
    const other = await race("Alt cros");
    await volunteer("Other Event Volunteer", 600, "CONFIRMED", other, { present: true });
  }

  it("says «Da» or «Nu» for a volunteer by the organizers' tick, as for a runner by the desk's check-in — the whole file keeps everybody", async () => {
    await saturday();
    const list = await exportRaffleList(db, admin, eventId, NOW);
    expect(list.rows).toEqual([
      { number: 1, name: "Ana Pop", kind: "RUNNER", present: true },
      { number: 2, name: "Radu Munteanu", kind: "RUNNER", present: false },
      { number: 500, name: "Ion Voluntar", kind: "VOLUNTEER", present: true },
      { number: 501, name: "Oana Voluntar", kind: "VOLUNTEER", present: false },
    ]);
    expect(list).toMatchObject({ runners: 2, volunteers: 2 });
  });

  it("onlyPresent keeps exactly the runners the desk checked in and the volunteers ticked «Prezent», every other rule as for the whole file", async () => {
    await saturday();
    const list = await exportRaffleList(db, admin, eventId, NOW, { onlyPresent: true });
    // Radu was not checked in and Oana not ticked; Dana and «Out Volunteer» were taken out; the test runner, the cancelled, the
    // offered, those without a number and the other event's person are never on either file.
    expect(list.rows).toEqual([
      { number: 1, name: "Ana Pop", kind: "RUNNER", present: true },
      { number: 500, name: "Ion Voluntar", kind: "VOLUNTEER", present: true },
    ]);
    expect(list).toMatchObject({ runners: 1, volunteers: 1 });
    // A tick cleared, a check-in undone: off the short file, still on the whole one.
    await db.update(eventVolunteers).set({ present: false }).where(eq(eventVolunteers.name, "Ion Voluntar"));
    await db.update(registrations).set({ checkedInAt: null }).where(eq(registrations.registeredName, "Ana Pop"));
    expect((await exportRaffleList(db, admin, eventId, NOW, { onlyPresent: true })).rows).toEqual([]);
    expect((await exportRaffleList(db, admin, eventId, NOW)).rows.map((row) => row.name)).toEqual(["Ana Pop", "Radu Munteanu", "Ion Voluntar", "Oana Voluntar"]);
  });

  it("asks for the short file only by a real `true`: anything else a caller passes is the whole one", async () => {
    await saturday();
    for (const options of [{}, { onlyPresent: false }, { onlyPresent: "1" as unknown as boolean }, { onlyPresent: 1 as unknown as boolean }]) {
      expect((await exportRaffleList(db, admin, eventId, NOW, options)).rows, JSON.stringify(options)).toHaveLength(4);
    }
  });

  it("records the short file's download as the whole one's — the two counts, which file it was, never a name or a number", async () => {
    await saturday();
    await exportRaffleList(db, admin, eventId, NOW, { onlyPresent: true });
    await exportRaffleList(db, admin, eventId, NOW);
    const rows = await trail();
    expect(rows.map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { runners: 1, elites: 0, volunteers: 1, onlyPresent: true, signUp: false },
        { runners: 2, elites: 0, volunteers: 2, onlyPresent: false, signUp: false },
      ]),
    );
    expect(rows).toHaveLength(2);
    const everything = JSON.stringify(rows);
    expect(everything).not.toMatch(/Ana|Ion|Radu|Oana|\b500\b|\b501\b/);
  });

  it("is served at `?present=1` — the same four columns, the present alone, under its own ASCII name — and anything else in the address is the whole file", async () => {
    await saturday();
    const response = await file(eventId, "?present=1&lang=ro");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="tombola-prezenti-\d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''tombola-prezenti-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect((await response.text()).replace(/^﻿/, "").split("\r\n")).toEqual(["Număr,Nume,Categorie,Prezent", "1,Ana Pop,Alergător,Da", "500,Ion Voluntar,Voluntar,Da", ""]);
    // In English too.
    expect((await (await file(eventId, "?present=1&lang=en")).text()).replace(/^﻿/, "").split("\r\n")).toEqual(["Number,Name,Category,Present", "1,Ana Pop,Runner,Yes", "500,Ion Voluntar,Volunteer,Yes", ""]);
    // `present` with any other value, or none, is the whole file under the whole file's name.
    for (const query of ["", "?present=0", "?present=yes", "?present=true", "?present=", "?present=11"]) {
      const whole = await file(eventId, query);
      expect(whole.headers.get("Content-Disposition"), query).toMatch(/^attachment; filename="tombola-\d{4}-\d{2}-\d{2}\.csv"/);
      expect((await whole.text()).replace(/^﻿/, "").split("\r\n"), query).toHaveLength(6);
    }
    // Each download said once in the trail, which file it was included.
    expect((await trail()).map((row) => (row.metadataJson as { onlyPresent: boolean }).onlyPresent).sort()).toEqual([false, false, false, false, false, false, true, true]);
  });

  it("BR-REQ-060-01: refuses the short file to whoever may not take the whole one — by the route and by the service — and writes nothing", async () => {
    await saturday();
    for (const role of STAFF_ROLES.filter((candidate) => !canTakeRaffleList(candidate))) {
      const actor = await staff(role);
      expect((await failureOf(exportRaffleList(db, actor, eventId, NOW, { onlyPresent: true }))).code, role).toBe("FORBIDDEN");
      state.actor = actor;
      const refused = await file(eventId, "?present=1");
      expect(refused.status, role).toBe(403);
      expect(await refused.text(), role).not.toContain("Ana Pop");
    }
    state.actor = undefined;
    expect((await file(eventId, "?present=1")).status).toBe(401);
    expect(await trail()).toEqual([]);
    // The Organizer and the Administrators take it.
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      expect((await file(eventId, "?present=1")).status, role).toBe(200);
    }
  });
});
