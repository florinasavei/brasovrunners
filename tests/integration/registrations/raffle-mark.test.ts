import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { countKits } from "@/modules/registrations/admin-repository";
import { setRegistrationInRaffle } from "@/modules/registrations/raffle-mark";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { resolveDisplayName } from "@/modules/registrations/names";
import { countOccupied } from "@/modules/registrations/repository";
import { STAFF_ROLES, canManageVolunteers, canReadRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Participă la tombolă» (§NNN; the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă la tombolă"»;
 * BR-REQ-060-01) — every registration and every volunteer is on the raffle's list of an event that holds one until an organizer
 * takes them out: whoever reads the registrations — the Organizer and the Administrators — a registration, whoever works the
 * volunteers a volunteer. Nothing else of the person moves —
 * no state, place, number, count or email — and the trail holds the new value alone. Read from a real database (PGlite); the
 * list itself is `tests/integration/volunteers/raffle-list.test.ts`, the columns `raffle-screens.test.ts`.
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
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations" }));
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

const { setRegistrationRaffleAction } = await import("@/app/[locale]/admin/registrations/actions");

const NOW = new Date("2026-11-03T10:00:00.000Z");

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
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 3, kitShirt: true, locationName: "Start" })
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

/** A runner in the given state, with a number when confirmed — the shapes the CHECKs ask of each state. */
async function runner(name: string, status: RegistrationStatus, bibNumber: number | null = null): Promise<string> {
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
      status,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      bibNumber,
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
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

const inRaffleOf = async (id: string) => (await db.select({ inRaffle: registrations.inRaffle }).from(registrations).where(eq(registrations.id, id)))[0].inRaffle;
const rowOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];
const trail = () => db.select().from(auditLogs);

async function volunteer(name: string, volunteerState: "REGISTERED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED"): Promise<string> {
  serial += 1;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, state: volunteerState, source: "STAFF" })
    .returning({ id: eventVolunteers.id });
  return row.id;
}
const volunteerOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];

describe("§NNN «Participă la tombolă» on a registration", () => {
  it("is on for every registration until an organizer takes it out, and goes back as freely", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await inRaffleOf(ana)).toBe(true);

    expect(await setRegistrationInRaffle(db, admin, ana, false, NOW)).toEqual({ changed: true });
    expect(await inRaffleOf(ana)).toBe(false);
    expect(await setRegistrationInRaffle(db, admin, ana, true, NOW)).toEqual({ changed: true });
    expect(await inRaffleOf(ana)).toBe(true);

    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["registration.raffle_excluded", "registration.raffle_included"]);
    expect(rows[0]).toMatchObject({ actorStaffUserId: admin.id, entityType: "registration", entityId: ana });
    // The new value alone: never a name or a number.
    expect(rows.map((row) => row.metadataJson)).toEqual([{ inRaffle: false }, { inRaffle: true }]);
  });

  it("asks no state: a waiting, a cancelled and an expired registration are taken out and put back too", async () => {
    const admin = await staff("ADMIN");
    for (const status of ["WAITLISTED", "CANCELLED", "EXPIRED"] as const) {
      const id = await runner(`Runner ${status}`, status);
      expect(await setRegistrationInRaffle(db, admin, id, false, NOW), status).toEqual({ changed: true });
      expect(await inRaffleOf(id), status).toBe(false);
    }
  });

  it("is the Organizer's and the Administrators': Tehnic and every other role are refused and nothing is written", async () => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canReadRegistrations(role)) continue;
      expect((await failureOf(setRegistrationInRaffle(db, actor, ana, false, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(await inRaffleOf(ana)).toBe(true);
    expect(await trail()).toHaveLength(0);

    // The Organizer — who reads the list and changes nothing else on it (§289) — takes a person out and puts them back.
    expect(canReadRegistrations("MODERATOR")).toBe(true);
    expect(canReadRegistrations("DEV")).toBe(false);
    const organizer = await staff("MODERATOR");
    expect(await setRegistrationInRaffle(db, organizer, ana, false, NOW)).toEqual({ changed: true });
    expect(await inRaffleOf(ana)).toBe(false);
    expect((await trail()).map((row) => [row.action, row.actorStaffUserId])).toEqual([["registration.raffle_excluded", organizer.id]]);
  });

  it("writes nothing for a press that finds the mark already as asked, and refuses an unknown registration", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    expect(await setRegistrationInRaffle(db, admin, ana, true, NOW)).toEqual({ changed: false });
    expect(await trail()).toHaveLength(0);
    expect((await failureOf(setRegistrationInRaffle(db, admin, "11111111-1111-4111-8111-111111111111", false, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(setRegistrationInRaffle(db, admin, "not-an-id", false, NOW))).code).toBe("NOT_FOUND");
  });

  it("changes no state, place, race number, count or kit, and sends no email", async () => {
    const admin = await staff("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await runner("Dan Ene", "PENDING_DECLARATION");
    const before = await rowOf(ana);
    const [occupied, kits] = [await countOccupied(db, eventId, NOW), await countKits(db, eventId, NOW)];

    await setRegistrationInRaffle(db, admin, ana, false, NOW);
    const after = await rowOf(ana);
    expect({ ...after, inRaffle: true, updatedAt: before.updatedAt }).toEqual(before);
    expect(await countOccupied(db, eventId, NOW)).toEqual(occupied);
    expect(await countKits(db, eventId, NOW)).toEqual(kits);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe("§NNN the tick on the list's row", () => {
  it("takes out and puts back for the Administrator and comes back to the row as the list stood", async () => {
    await as("ADMIN");
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    const out = await redirectOf(setRegistrationRaffleAction(form({ registrationId: ana, inRaffle: "0", listQuery: `eventId=${eventId}&page=2` })));
    expect(out).toBe(`/ro/admin/registrations?eventId=${eventId}&page=2&saved=raffleExcluded&from=row#reg-${ana}`);
    expect(await inRaffleOf(ana)).toBe(false);
    const back = await redirectOf(setRegistrationRaffleAction(form({ registrationId: ana, inRaffle: "1", listQuery: `eventId=${eventId}` })));
    expect(back).toBe(`/ro/admin/registrations?eventId=${eventId}&saved=raffleIncluded&from=row#reg-${ana}`);
    expect(await inRaffleOf(ana)).toBe(true);
    expect((await trail()).map((row) => row.action).sort()).toEqual(["registration.raffle_excluded", "registration.raffle_included"]);
  });

  it("takes the Organizer's press too", async () => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await as("MODERATOR");
    const out = await redirectOf(setRegistrationRaffleAction(form({ registrationId: ana, inRaffle: "0", listQuery: `eventId=${eventId}` })));
    expect(out).toBe(`/ro/admin/registrations?eventId=${eventId}&saved=raffleExcluded&from=row#reg-${ana}`);
    expect(await inRaffleOf(ana)).toBe(false);
  });

  it.each<StaffRole>(["DEV", "COPYWRITER"])("refuses %s at the door: no change, no row in the trail", async (role) => {
    const ana = await runner("Ana Pop", "CONFIRMED", 12);
    await as(role);
    const refused = await redirectOf(setRegistrationRaffleAction(form({ registrationId: ana, inRaffle: "0", listQuery: `eventId=${eventId}` })));
    expect(refused).toBe(`/ro/admin/registrations?eventId=${eventId}&error=FORBIDDEN#admin-alert`);
    expect(await inRaffleOf(ana)).toBe(true);
    expect(await trail()).toHaveLength(0);
  });
});

describe("§NNN «Participă la tombolă» on a volunteer", () => {
  it("is on until whoever works the volunteers takes the person out, audited as an edit of their boxes", async () => {
    const organizer = await staff("MODERATOR");
    const ion = await volunteer("Ion Voluntar");
    expect((await volunteerOf(ion)).inRaffle).toBe(true);
    const before = await volunteerOf(ion);

    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: ion, inRaffle: false }, NOW)).toMatchObject({ changed: true });
    const after = await volunteerOf(ion);
    expect(after.inRaffle).toBe(false);
    // Nothing else of the person: the state, the number, the kit, the point.
    expect({ ...after, inRaffle: true, updatedAt: before.updatedAt }).toEqual(before);
    const [row, ...more] = (await trail()).filter((entry) => entry.action === "volunteer.edited");
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorStaffUserId: organizer.id, entityType: "event", entityId: eventId });
    expect(row.metadataJson).toMatchObject({ volunteerId: ion, fields: ["inRaffle"], inRaffle: false });

    // A second press saves the same and writes nothing; the tick puts the person back.
    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: ion, inRaffle: false }, NOW)).toMatchObject({ changed: false });
    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: ion, inRaffle: true }, NOW)).toMatchObject({ changed: true });
    expect((await volunteerOf(ion)).inRaffle).toBe(true);
    expect((await trail()).filter((entry) => entry.action === "volunteer.edited")).toHaveLength(2);
  });

  it("is refused to a role that does not work the volunteers, with nothing written (BR-REQ-060-01)", async () => {
    const ion = await volunteer("Ion Voluntar");
    for (const role of STAFF_ROLES) {
      if (canManageVolunteers(role)) continue;
      const actor = await staff(role);
      expect((await failureOf(changeVolunteer(db, actor, { kind: "setRaffle", eventId, id: ion, inRaffle: false }, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect((await volunteerOf(ion)).inRaffle).toBe(true);
    expect(await trail()).toHaveLength(0);
  });
});
