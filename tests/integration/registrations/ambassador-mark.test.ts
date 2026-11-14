import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { countKits, readPlaceOutlook, summariseRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { listAmbassadorMarkedRegistrations, setRegistrationAmbassador } from "@/modules/registrations/ambassador-mark";
import { countBibs, listBibs } from "@/modules/registrations/bibs";
import { setRegistrationElite, setRegistrationEliteTick } from "@/modules/registrations/elite-mark";
import { resolveDisplayName } from "@/modules/registrations/names";
import { exportPersonData } from "@/modules/registrations/person-data";
import { countAnonymousStartListEntries, countOccupied, countPublicStartList, listPublicStartList, listPublicStartListOthers } from "@/modules/registrations/repository";
import { STAFF_ROLES, canManageRegistrations, canReadRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Marchează ca ambasador» / «Nu mai e ambasador» (§NNN; the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de
 * „Ambasadori" ca să putem decide pe cine premiem și pe cine nu», choosing «Ca Elită, fără BIB special»; BR-REQ-037-07,
 * BR-REQ-060-01, BR-REQ-039-01) — on real PostgreSQL (PGlite).
 *
 * What is protected:
 * - an Administrator marks a registration an ambassador at any time and in any state, and nobody else does;
 * - the mark moves nothing: no state, place (BR-REQ-034-01: the allocator never reads it), race number, count, kit or
 *   email — and not the bib, which prints as any other;
 * - the trail holds the registration's id and the new value alone;
 * - the one pair of ticks counts under either mark: «Apare pe site» unticked hides a ticked ambassador's name on the
 *   public list and never shows anybody who did not tick; with both marks off it is inert;
 * - the ticks are refused on a registration that wears neither mark.
 *
 * The ranking's half — «Apare în clasament» — is `tests/integration/results/ambassador-hors-concours.test.ts`.
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
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string | { pathname: string; params?: Record<string, string> } }) => (typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace("[id]", href.params?.id ?? "")}`) }));
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

const { setRegistrationAmbassadorAction } = await import("@/app/[locale]/admin/registrations/actions");

const NOW = new Date("2026-11-14T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);

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
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      capacity: 3,
      kitShirt: true,
      locationName: "Start",
      participantListVisibility: "NAMES",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
  eventId = event.id;
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function as(role: StaffRole): Promise<StaffUser> {
  const user = await staff(role);
  state.actor = user;
  return user;
}

/** A runner in the given state, with a number when confirmed; ticked «Vreau să apar» unless told otherwise. */
async function runner(name: string, status: RegistrationStatus, bibNumber: number | null = null, over: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      emailConfirmedAt: NOW,
      status,
      confirmedAt: status === "CONFIRMED" ? later(serial) : null,
      bibNumber,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
      ...over,
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

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

const markOf = async (id: string) => (await db.select({ ambassador: registrations.ambassador }).from(registrations).where(eq(registrations.id, id)))[0].ambassador;
const namesOnTheList = async () => (await listPublicStartList(db, eventId)).map((row) => row.displayName);

describe("§NNN the ambassador mark on a registration", () => {
  it("is off on every registration until an Administrator marks it, and comes off as freely", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await markOf(ana)).toBe(false);

    expect(await setRegistrationAmbassador(db, admin, ana, true, NOW)).toEqual({ changed: true });
    expect(await markOf(ana)).toBe(true);
    expect(await setRegistrationAmbassador(db, admin, ana, false, later(1))).toEqual({ changed: true });
    expect(await markOf(ana)).toBe(false);

    // The trail: one row a change, on the registration, holding the new value and nothing else.
    const trail = await db.select().from(auditLogs).orderBy(auditLogs.createdAt);
    expect(trail.map((row) => [row.action, row.entityType, row.entityId, row.actorStaffUserId, row.metadataJson])).toEqual([
      ["registration.ambassador_marked", "registration", ana, admin.id, { ambassador: true }],
      ["registration.ambassador_unmarked", "registration", ana, admin.id, { ambassador: false }],
    ]);
    expect(JSON.stringify(trail)).not.toContain("Ana");
  });

  it("asks no date and no state: every state is marked, a cancelled row and a race after its start too", async () => {
    const admin = await staff("ADMIN");
    await db.update(events).set({ startsAt: new Date("2026-11-01T08:00:00.000Z") }).where(eq(events.id, eventId));
    const states: RegistrationStatus[] = ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "CONFIRMED", "CANCELLED", "EXPIRED"];
    for (const [index, status] of states.entries()) {
      const id = await runner(`Runner ${status}`, status, status === "CONFIRMED" ? 5 : null);
      await setRegistrationAmbassador(db, admin, id, true, later(index));
      expect(await markOf(id), status).toBe(true);
      const [row] = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, id));
      expect(row.status, status).toBe(status);
    }
  });

  it("BR-REQ-060-01 is the Administrator's alone: the Organizer, Tehnic and every other role are refused and nothing is written", async () => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const served: StaffRole[] = [];
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canManageRegistrations(role)) {
        served.push(role);
        continue;
      }
      expect((await failureOf(setRegistrationAmbassador(db, actor, ana, true, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(await markOf(ana)).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    expect(served.sort()).toEqual(["ADMIN", "SUPERADMIN"]);
    expect(canManageRegistrations("MODERATOR")).toBe(false);
    expect(canManageRegistrations("DEV")).toBe(false);
  });

  it("is in the person's own data: the answer to an access request holds every column of their registration, this one with them", async () => {
    const admin = await staff("ADMIN");
    const id = await runner("Ana Pop", "CONFIRMED", 12);
    await setRegistrationAmbassador(db, admin, id, true, NOW);
    const [person] = await db
      .select({ canonicalEmail: participants.canonicalEmail })
      .from(participants)
      .innerJoin(registrations, eq(registrations.participantId, participants.id))
      .where(eq(registrations.id, id));
    const data = await exportPersonData(db, admin, person.canonicalEmail, later(1));
    expect(data.registrations.map((row) => [row.id, row.ambassador])).toEqual([[id, true]]);
  });

  it("writes nothing for a press that finds the mark already as asked, and refuses an unknown registration", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await setRegistrationAmbassador(db, admin, ana, false, NOW)).toEqual({ changed: false });
    await setRegistrationAmbassador(db, admin, ana, true, NOW);
    expect(await setRegistrationAmbassador(db, admin, ana, true, later(1))).toEqual({ changed: false });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
    expect((await failureOf(setRegistrationAmbassador(db, admin, "00000000-0000-4000-8000-000000000000", true, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(setRegistrationAmbassador(db, admin, "not-an-id", true, NOW))).code).toBe("NOT_FOUND");
  });

  it("BR-REQ-034-01 changes no state, place, race number, count, kit or bib, and sends no email", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const ion = await runner("Ion Ionescu", "CONFIRMED", 13);
    const mara = await runner("Mara Dima", "CONFIRMED", 14);
    const waiting = await runner("Radu Stan", "WAITLISTED");

    const snapshot = async () => ({
      occupied: await countOccupied(db, eventId, NOW),
      kits: await countKits(db, eventId, NOW),
      summary: await summariseRegistrationsForAdmin(db, { eventId }),
      places: await readPlaceOutlook(db, eventId, NOW),
      bibs: await countBibs(db, eventId),
      // The sheet's own rows: the number, whose it is, and whether it prints elite-style — an ambassador's never does.
      sheet: (await listBibs(db, eventId)).map((row) => [row.id, row.bibNumber, row.registeredName, row.elite]),
      rows: (await db.select({ id: registrations.id, status: registrations.status, bibNumber: registrations.bibNumber, outside: registrations.outsideCapacity, printed: registrations.bibPrintedAt, elite: registrations.elite }).from(registrations)).sort((a, b) => a.id.localeCompare(b.id)),
      named: await namesOnTheList(),
    });
    const before = await snapshot();
    expect(before.occupied.confirmed).toBe(3);
    expect(before.sheet.every(([, , , elite]) => elite === false)).toBe(true);

    for (const [index, id] of [ana, ion, mara, waiting].entries()) await setRegistrationAmbassador(db, admin, id, true, later(index));
    expect(await snapshot()).toEqual(before);
    await setRegistrationAmbassador(db, admin, ion, false, later(9));
    expect(await snapshot()).toEqual(before);

    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe("§NNN «Marchează ca ambasador» from the list's «⋮», the panel and the registration's page", () => {
  it("marks and unmarks for the Administrator and comes back to the list as it stood, or to the registration's page", async () => {
    await as("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);

    const marked = await redirectOf(setRegistrationAmbassadorAction(null, form({ registrationId: ana, ambassador: "1", listQuery: `eventId=${eventId}&page=2` })));
    expect(marked).toContain(`eventId=${eventId}`);
    expect(marked).toContain("page=2");
    expect(marked).toContain("saved=ambassadorMarked");
    expect(await markOf(ana)).toBe(true);

    const unmarked = await redirectOf(setRegistrationAmbassadorAction(null, form({ registrationId: ana, ambassador: "0", listQuery: `eventId=${eventId}` })));
    expect(unmarked).toContain("saved=ambassadorUnmarked");
    expect(await markOf(ana)).toBe(false);

    // Without the list's query: the registration's own page.
    const fromPage = await redirectOf(setRegistrationAmbassadorAction(null, form({ registrationId: ana, ambassador: "1" })));
    expect(fromPage).toContain(`/admin/registrations/${ana}`);
    expect(fromPage).toContain("saved=ambassadorMarked");
  });

  it("BR-REQ-060-01 refuses the Organizer at the action's door, in words, and writes nothing", async () => {
    await as("MODERATOR");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const refused = await redirectOf(setRegistrationAmbassadorAction(null, form({ registrationId: ana, ambassador: "1", listQuery: `eventId=${eventId}` })));
    expect(refused).toContain("error=FORBIDDEN");
    expect(await markOf(ana)).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});

describe("§NNN BR-REQ-039-01 «Apare pe site» under the ambassador mark: the club's tick only hides", () => {
  it("unticked, a ticked ambassador is a «Participant (nume ascuns)» row while confirmed, and counted as one", async () => {
    const admin = await staff("ADMIN");
    await runner("Ana Popescu", "CONFIRMED", 1);
    const dan = await runner("Dan Ionescu", "CONFIRMED", 2);
    await setRegistrationAmbassador(db, admin, dan, true, NOW);
    // Marked, the tick still stands ticked: the person's own tick decides, and the name is on the list.
    expect(await namesOnTheList()).toEqual(["Ana Popescu", "Dan Ionescu"]);

    await setRegistrationEliteTick(db, admin, dan, "onSite", false, later(1));
    expect(await namesOnTheList()).toEqual(["Ana Popescu"]);
    expect(await countPublicStartList(db, eventId)).toBe(1);
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(1);

    await setRegistrationEliteTick(db, admin, dan, "onSite", true, later(2));
    expect(await namesOnTheList()).toEqual(["Ana Popescu", "Dan Ionescu"]);
  });

  it("never shows a runner who did not tick, whatever the mark and the club's tick say; a pending hidden ambassador is no row at all", async () => {
    await runner("Ion Discret", "CONFIRMED", 3, { ambassador: true, eliteHiddenFromSite: false, listOptOut: true });
    await runner("Pending Ascuns", "PENDING_DECLARATION", null, { ambassador: true, eliteHiddenFromSite: true });
    await runner("Pending Vizibil", "PENDING_DECLARATION");
    expect(await namesOnTheList()).toEqual([]);
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(1);
    expect((await listPublicStartListOthers(db, eventId, 1, true)).map((row) => row.displayName)).toEqual(["Pending Vizibil"]);
  });

  it("counts under either mark and under neither: taking one of two marks off keeps the hide, taking both off leaves it inert", async () => {
    const admin = await staff("ADMIN");
    const dan = await runner("Dan Ionescu", "CONFIRMED", 2);
    await setRegistrationAmbassador(db, admin, dan, true, NOW);
    await setRegistrationElite(db, admin, dan, true, later(1));
    await setRegistrationEliteTick(db, admin, dan, "onSite", false, later(2));
    expect(await namesOnTheList()).toEqual([]);

    // The elite mark off, the ambassador's still on: still hidden.
    await setRegistrationElite(db, admin, dan, false, later(3));
    expect(await namesOnTheList()).toEqual([]);
    // Both off: the person's own tick decides again.
    await setRegistrationAmbassador(db, admin, dan, false, later(4));
    expect(await namesOnTheList()).toEqual(["Dan Ionescu"]);
    // The mark put back finds the tick as it was.
    await setRegistrationAmbassador(db, admin, dan, true, later(5));
    expect(await namesOnTheList()).toEqual([]);
  });

  it("refuses the ticks on a registration that wears neither mark, and takes them on an ambassador's alone", async () => {
    const admin = await staff("ADMIN");
    const dan = await runner("Dan Ionescu", "CONFIRMED", 2);
    expect((await failureOf(setRegistrationEliteTick(db, admin, dan, "inResults", false, NOW))).code).toBe("ELITE_NOT_MARKED");
    expect((await failureOf(setRegistrationEliteTick(db, admin, dan, "onSite", false, NOW))).code).toBe("ELITE_NOT_MARKED");

    await setRegistrationAmbassador(db, admin, dan, true, later(1));
    expect(await setRegistrationEliteTick(db, admin, dan, "inResults", false, later(2))).toMatchObject({ changed: true });
    const [row] = await db.select({ results: registrations.eliteHiddenFromResults, site: registrations.eliteHiddenFromSite }).from(registrations).where(eq(registrations.id, dan));
    expect(row).toEqual({ results: true, site: false });

    // With the mark gone again the ticks are refused again — a stale menu's press writes nothing.
    await setRegistrationAmbassador(db, admin, dan, false, later(3));
    expect((await failureOf(setRegistrationEliteTick(db, admin, dan, "inResults", true, later(4)))).code).toBe("ELITE_NOT_MARKED");
  });
});

describe("§NNN the event's ambassadors, as the «Ambasadori» panel reads them", () => {
  it("lists the marked registrations by name, in every state, with their ticks — never a test row, another event's or an unmarked one", async () => {
    const admin = await staff("ADMIN");
    const zoe = await runner("Zoe Zamfir", "CONFIRMED", 12, { ambassador: true });
    const ana = await runner("Ana Albu", "CANCELLED", null, { ambassador: true, elite: true, eliteHiddenFromResults: true, eliteHiddenFromSite: true });
    await runner("Tudor Test", "CONFIRMED", 13, { ambassador: true, kind: "TEST" });
    await runner("Radu Simplu", "CONFIRMED", 14);
    await runner("Elena Elita", "CONFIRMED", 15, { elite: true });

    expect(await listAmbassadorMarkedRegistrations(db, admin, eventId)).toEqual([
      { id: ana, name: "Ana Albu", status: "CANCELLED", bibNumber: null, elite: true, inResults: false, onSite: false },
      { id: zoe, name: "Zoe Zamfir", status: "CONFIRMED", bibNumber: 12, elite: false, inResults: true, onSite: true },
    ]);
    expect(await listAmbassadorMarkedRegistrations(db, admin, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(await listAmbassadorMarkedRegistrations(db, admin, "not-an-id")).toEqual([]);
  });

  it("BR-REQ-060-01 is read by whoever reads the registrations and refused to everybody else", async () => {
    await runner("Zoe Zamfir", "CONFIRMED", 12, { ambassador: true });
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canReadRegistrations(role)) expect(await listAmbassadorMarkedRegistrations(db, actor, eventId), role).toHaveLength(1);
      else expect((await failureOf(listAmbassadorMarkedRegistrations(db, actor, eventId))).code, role).toBe("FORBIDDEN");
    }
    expect(canReadRegistrations("MODERATOR")).toBe(true);
    expect(canReadRegistrations("DEV")).toBe(false);
  });
});
