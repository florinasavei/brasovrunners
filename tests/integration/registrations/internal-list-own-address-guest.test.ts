import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { forgetCachedAddressCap } from "@/modules/registrations/address-cap-memo";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { sendHoldEmails } from "../../helpers/outbox";

/**
 * «Pe adresa mea, invitat special» on a line of «Lista internă (doar notițe)» (the decision «A line of the internal list on
 * the Administrator's own address, as a special guest»; BR-REQ-037-05, BR-REQ-034-01, BR-REQ-060-01) — the owner, of a
 * partners' guest written on the internal list with no address: «trebuie să pot să o pun și fără mail».
 *
 * One press: the line's person registered on the pressing Administrator's own address (`staff_users.email`, never one the
 * form posts), on «Lista de invitați speciali» before the allocator runs, so the row ends `PENDING_DECLARATION` outside the
 * announced places on a free race, a full one, one whose waiting list is at its limit and one with no waiting list — the
 * places taken unchanged in each, no waiting-list email, no verification email, one declaration email to the
 * Administrator's address. The note follows and the line goes, in one transaction under the event lock. The hold is an
 * outside row's: neither the maintenance run nor the deadline's release takes it before the start, and «Confirmă pe
 * hârtie» confirms it. Every refusal writes nothing. Made-up people and addresses only.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, flashed: [] as unknown[] }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The door asks the role as the real one does, so a forged post by the Organizer is refused there first.
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/shared/feedback/flash", () => ({
  flash: async (notice: unknown) => {
    state.flashed.push(notice);
  },
  flashOutcome: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { moveReserveEntryToOwnAddressAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");
const { addReserveEntry, moveReserveEntryToOwnAddress } = await import("@/modules/registrations/reserve-list");
const { confirmEmail, submitRegistration, OWN_ADDRESS_GUEST } = await import("@/modules/registrations/service");
const { confirmRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { countOccupied } = await import("@/modules/registrations/repository");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");

// The action reads the wall clock, so the fixture is set against it: a race a month from now.
const NOW = new Date();
const DAY = 24 * 3_600_000;
const STARTS = new Date(NOW.getTime() + 30 * DAY);
const NOTE = "Invitată de un partener; vine cu echipa lui.";
const ADMIN_EMAIL = "admin.club@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedAddressCap();
  state.flashed = [];
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  admin = await staff("ADMIN", ADMIN_EMAIL);
  state.actor = admin;
});

async function staff(role: StaffRole, email = `${role.toLowerCase()}@dev.test`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: role, role }).returning();
  return user;
}

type RaceOptions = { waitlistCapacity?: number | null; hiddenList?: boolean; startsAt?: Date; over?: Partial<typeof events.$inferInsert> };

async function createRace(capacity: number, options: RaceOptions = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistCapacity: options.waitlistCapacity ?? null,
      waitlistAutoOffer: false,
      hiddenListEnabled: options.hiddenList ?? true,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      ...options.over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

/** One person on their own address through the public door, as far as the address's confirmation. */
async function publicRunner(event: EventInput, name: string, at: Date = NOW) {
  await submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Vlad",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(at.getTime() - 30_000).toISOString(),
    },
    at,
    "REAL",
    { source: "PUBLIC", createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Vlad`));
  return confirmEmail(db, event, row.id, at);
}

/** A line of the internal list, as «Adaugă pe lista internă» writes it: no address, as the partners' guest had none. */
async function line(eventId: string, firstName = "Ilinca", lastName = "Dobre") {
  const { id } = await addReserveEntry(db, admin, eventId, { firstName, lastName, email: "", note: NOTE }, NOW);
  return id;
}

/** The line's press as the panel posts it: the line, the dialog's tick, the language, the list's query — and, forged, an address. */
function press(entryId: string, options: { relay?: boolean; email?: string; listQuery?: string } = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("entryId", entryId);
  form.set("relayedByParticipantRequest", options.relay === false ? "" : "on");
  form.set("listQuery", options.listQuery ?? "");
  if (options.email !== undefined) form.set("email", options.email);
  return form;
}

const rowOf = async (firstName = "Ilinca", lastName = "Dobre") => (await db.select().from(registrations).where(eq(registrations.registeredName, `${firstName} ${lastName}`)))[0];
const emailsOf = (registrationId: string, messageType: "VERIFY_REGISTRATION_EMAIL" | "WAITLIST_JOINED" | "COMPLETE_DECLARATION" | "WAITLIST_SPOT_OFFER") =>
  db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.messageType, messageType)));
const linesOf = (eventId: string) => db.select().from(eventReserveEntries).where(eq(eventReserveEntries.eventId, eventId));
const notesOf = async (registrationId: string) => (await db.select().from(registrationNotes).where(eq(registrationNotes.registrationId, registrationId))).map((note) => note.body);
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));
const occupied = async (eventId: string) => computeOccupied(await countOccupied(db, eventId, NOW));
const statusOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0].status;

/** Nothing written: no registration of the line's person, no participant on the Administrator's address, the line kept with its note. */
async function expectNothingWritten(eventId: string, entryId: string) {
  expect(await rowOf()).toBeUndefined();
  expect(await db.select().from(participants).where(eq(participants.canonicalEmail, ADMIN_EMAIL))).toEqual([]);
  expect((await linesOf(eventId)).map((row) => [row.id, row.note])).toEqual([[entryId, NOTE]]);
  expect(await trail("event_reserve.moved")).toEqual([]);
  expect(await trail("registration.outside_capacity_changed")).toEqual([]);
  expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, ADMIN_EMAIL))).toEqual([]);
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("«Pe adresa mea, invitat special»: the row on «Lista de invitați speciali» before the allocator runs", () => {
  const races: [string, () => Promise<EventInput>][] = [
    ["a race with free places", () => createRace(3)],
    [
      "a full race",
      async () => {
        const event = await createRace(1);
        expect((await publicRunner(event, "Ana")).status).toBe("PENDING_DECLARATION");
        return event;
      },
    ],
    [
      "a full race whose waiting list is at its limit",
      async () => {
        const event = await createRace(1, { waitlistCapacity: 1 });
        expect((await publicRunner(event, "Ana")).status).toBe("PENDING_DECLARATION");
        expect((await publicRunner(event, "Bia")).status).toBe("WAITLISTED");
        return event;
      },
    ],
    [
      "a full race with no waiting list («Fără listă de așteptare»)",
      async () => {
        const event = await createRace(1, { waitlistCapacity: 0 });
        expect((await publicRunner(event, "Ana")).status).toBe("PENDING_DECLARATION");
        return event;
      },
    ],
  ];

  it.each(races)("%s: PENDING_DECLARATION outside the places, the places taken unchanged, one declaration email to the Administrator's address", async (_name, setUp) => {
    const event = await setUp();
    const before = await occupied(event.id);
    const others = await db.select({ id: registrations.id, status: registrations.status, waitlistedAt: registrations.waitlistedAt }).from(registrations);
    const entryId = await line(event.id);

    await expect(moveReserveEntryToOwnAddressAction(null, press(entryId, { listQuery: `eventId=${event.id}&page=2` }))).rejects.toThrow(
      `REDIRECT /ro/admin/registrations?eventId=${event.id}&page=2&saved=reserveOwnAddressGuest#registrations-reserve`,
    );

    const guest = await rowOf();
    expect(guest).toMatchObject({ status: "PENDING_DECLARATION", outsideCapacity: true, source: "STAFF", createdByStaffUserId: admin.id, emailConfirmedByStaffUserId: admin.id, waitlistedAt: null });
    // The vouched hold's own deadline: capped by the start alone.
    expect(guest.holdExpiresAt).not.toBeNull();
    expect((guest.holdExpiresAt as Date).getTime()).toBeLessThanOrEqual(STARTS.getTime());
    // The Administrator's own address, through the canonicalizer; the person's own email is never verified for them.
    const [participant] = await db.select().from(participants).where(eq(participants.id, guest.participantId));
    expect(participant).toMatchObject({ canonicalEmail: ADMIN_EMAIL, deliveryEmail: ADMIN_EMAIL, emailVerifiedAt: null });
    // No counted place taken, nobody's place or position touched — nobody waiting is passed over.
    expect(await occupied(event.id)).toBe(before);
    for (const other of others) {
      const [now] = await db.select({ status: registrations.status, waitlistedAt: registrations.waitlistedAt }).from(registrations).where(eq(registrations.id, other.id));
      expect(now).toEqual({ status: other.status, waitlistedAt: other.waitlistedAt });
    }
    expect(await emailsOf(guest.id, "WAITLIST_JOINED")).toEqual([]);
    expect(await emailsOf(guest.id, "VERIFY_REGISTRATION_EMAIL")).toEqual([]);
    expect(await emailsOf(guest.id, "WAITLIST_SPOT_OFFER")).toEqual([]);
    const declaration = await emailsOf(guest.id, "COMPLETE_DECLARATION");
    expect(declaration.map((mail) => mail.recipientEmail)).toEqual([ADMIN_EMAIL]);
    // The press's cause on the row it queued: the toast and «Emailuri azi» name it.
    expect(declaration[0].cause).toBe("registrations.reserveOwnAddress");
    // The note follows, the line is gone; the toast is fixed words.
    expect(await notesOf(guest.id)).toEqual([NOTE]);
    expect(await linesOf(event.id)).toEqual([]);
    expect(state.flashed).toEqual([{ saved: "reserveOwnAddressGuest" }]);
  });

  it("leaves the trail as each verb writes it, tagged with this press, ids only — never a name, an address or the note", async () => {
    const event = await createRace(1);
    await publicRunner(event, "Ana");
    const entryId = await line(event.id);
    await expect(moveReserveEntryToOwnAddressAction(null, press(entryId))).rejects.toThrow(/REDIRECT/);
    const guest = await rowOf();

    const [created] = await trail("registration.created_by_staff");
    expect(created).toMatchObject({ actorStaffUserId: admin.id, entityId: guest.id });
    expect(created.metadataJson).toEqual({ eventId: event.id, status: "PENDING_DECLARATION", fastTrack: false, addressVouched: true, outsideCapacity: true, via: OWN_ADDRESS_GUEST });
    const [vouched] = await trail("registration.address_vouched_on_entry");
    expect(vouched.metadataJson).toEqual({ from: "PENDING_EMAIL_CONFIRMATION", to: "PENDING_DECLARATION" });
    const [outside] = await trail("registration.outside_capacity_changed");
    expect(outside).toMatchObject({ actorStaffUserId: admin.id, entityId: guest.id });
    expect(outside.metadataJson).toEqual({ from: false, to: true, status: "PENDING_EMAIL_CONFIRMATION", statusAfter: "PENDING_DECLARATION", via: OWN_ADDRESS_GUEST });
    const [moved] = await trail("event_reserve.moved");
    expect(moved).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: event.id });
    expect(moved.metadataJson).toEqual({ entryId, registrationId: guest.id, via: OWN_ADDRESS_GUEST });
    const written = JSON.stringify(await db.select().from(auditLogs));
    for (const typed of ["Ilinca", "Dobre", ADMIN_EMAIL, "partener"]) expect(written).not.toContain(typed);
  });

  it("ignores an address posted by the form: the account's own is the only one used", async () => {
    const event = await createRace(3);
    const entryId = await line(event.id);
    await expect(moveReserveEntryToOwnAddressAction(null, press(entryId, { email: "altcineva@example.ro" }))).rejects.toThrow(/saved=reserveOwnAddressGuest/);
    const guest = await rowOf();
    const [participant] = await db.select().from(participants).where(eq(participants.id, guest.participantId));
    expect(participant.deliveryEmail).toBe(ADMIN_EMAIL);
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "altcineva@example.ro"))).toEqual([]);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "altcineva@example.ro"))).toEqual([]);
  });

  it("keeps the hold until the start: neither the maintenance run nor the deadline's release takes it, and «Confirmă pe hârtie» then confirms it", async () => {
    const deadline = new Date(STARTS.getTime() - 2 * DAY);
    const event = await createRace(1, { over: { confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2, releaseUnsignedAtDeadline: true, waitlistAutoOffer: true } });
    const ana = await publicRunner(event, "Ana");
    const bia = await publicRunner(event, "Bia");
    expect([ana.status, bia.status]).toEqual(["PENDING_DECLARATION", "WAITLISTED"]);
    const guest = await moveReserveEntryToOwnAddress(db, admin, await line(event.id), { relayedByParticipantRequest: true, locale: "ro" }, NOW);
    expect(guest.status).toBe("PENDING_DECLARATION");
    await sendHoldEmails(db, NOW);
    // Both holds lapsed before the run, with somebody waiting: a counted one goes for Bia, the special guest's stays.
    const lapsed = new Date(deadline.getTime() - 2 * 3_600_000);
    await db.update(registrations).set({ holdExpiresAt: lapsed }).where(eq(registrations.status, "PENDING_DECLARATION"));

    await runRegistrationMaintenance(db, new Date(deadline.getTime() - 3_600_000));
    expect(await statusOf(ana.id)).toBe("EXPIRED");
    expect(await statusOf(bia.id)).toBe("WAITLIST_OFFERED");
    expect(await statusOf(guest.registrationId)).toBe("PENDING_DECLARATION");

    // The deadline's own release (§914): every counted unsigned hold — and never the special guest's.
    await runRegistrationMaintenance(db, new Date(deadline.getTime() + 3_600_000));
    const [{ unsignedReleasedFor }] = await db.select({ unsignedReleasedFor: events.unsignedReleasedFor }).from(events).where(eq(events.id, event.id));
    expect(unsignedReleasedFor).toEqual(deadline);
    expect(await statusOf(guest.registrationId)).toBe("PENDING_DECLARATION");

    // On paper at the start: the person's own declaration, recorded by the staff member.
    const confirmed = await confirmRegistrationByStaff(db, admin, guest.registrationId, new Date(deadline.getTime() + 2 * 3_600_000));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.outsideCapacity).toBe(true);
  });
});

describe("«Pe adresa mea, invitat special»: every refusal writes nothing and is said on the line", () => {
  it("refuses while the event's «Folosește lista de invitați speciali» is off — HIDDEN_LIST_OFF, its own sentence", async () => {
    const event = await createRace(3, { hiddenList: false });
    const entryId = await line(event.id);
    expect(await moveReserveEntryToOwnAddressAction(null, press(entryId))).toMatchObject({ error: "HIDDEN_LIST_OFF", fields: [] });
    await expectNothingWritten(event.id, entryId);
    for (const catalogue of [ro, en]) expect(catalogue.Admin.errors.HIDDEN_LIST_OFF.length).toBeGreaterThan(0);
  });

  it("refuses after the start — VOUCHED_ENTRY_AFTER_START", async () => {
    const event = await createRace(3);
    const entryId = await line(event.id);
    const error = await refusal(moveReserveEntryToOwnAddress(db, admin, entryId, { relayedByParticipantRequest: true, locale: "ro" }, new Date(STARTS.getTime() + 60_000)));
    expect(isDomainError(error) && error.code).toBe("VOUCHED_ENTRY_AFTER_START");
    await expectNothingWritten(event.id, entryId);
  });

  it("refuses without the relay tick, naming it", async () => {
    const event = await createRace(3);
    const entryId = await line(event.id);
    expect(await moveReserveEntryToOwnAddressAction(null, press(entryId, { relay: false }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["relayedByParticipantRequest"] });
    await expectNothingWritten(event.id, entryId);
  });

  it("refuses the same name already on the Administrator's address with the staff entry's sentence, and the second line stays", async () => {
    const event = await createRace(3);
    await expect(moveReserveEntryToOwnAddressAction(null, press(await line(event.id)))).rejects.toThrow(/REDIRECT/);
    const second = await line(event.id);
    expect(await moveReserveEntryToOwnAddressAction(null, press(second))).toMatchObject({ error: "STAFF_ALREADY_ON_ADDRESS", fields: [] });
    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(1);
    expect((await linesOf(event.id)).map((row) => row.id)).toEqual([second]);
    expect(await trail("event_reserve.moved")).toHaveLength(1);
  });

  it("refuses at the club's limit per address with the staff entry's sentence, and writes nothing", async () => {
    await updateAddressCap(db, (await staff("SUPERADMIN")) as StaffUser, { registrationsPerAddress: 2 }, NOW);
    forgetCachedAddressCap();
    const event = await createRace(5);
    for (const first of ["Ilinca", "Sorina"]) {
      await expect(moveReserveEntryToOwnAddressAction(null, press(await line(event.id, first)))).rejects.toThrow(/REDIRECT/);
    }
    const third = await line(event.id, "Teodora");
    expect(await moveReserveEntryToOwnAddressAction(null, press(third))).toMatchObject({ error: "STAFF_ADDRESS_AT_CAP", fields: [] });
    expect(await rowOf("Teodora")).toBeUndefined();
    expect((await linesOf(event.id)).map((row) => row.id)).toEqual([third]);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.errors.STAFF_ALREADY_ON_ADDRESS.length).toBeGreaterThan(0);
      expect(catalogue.Admin.errors.STAFF_ADDRESS_AT_CAP.length).toBeGreaterThan(0);
    }
  });

  it("is the Administrator's alone: an Organizer's or Tehnic's forged post is refused at the door and by the service, and nothing is written", async () => {
    const event = await createRace(3);
    const entryId = await line(event.id);
    for (const role of ["MODERATOR", "DEV"] as const) {
      const actor = await staff(role);
      state.actor = actor;
      expect(await moveReserveEntryToOwnAddressAction(null, press(entryId)), role).toMatchObject({ error: "FORBIDDEN" });
      const direct = await refusal(moveReserveEntryToOwnAddress(db, actor, entryId, { relayedByParticipantRequest: true, locale: "ro" }, NOW));
      expect(isDomainError(direct) && direct.code, role).toBe("FORBIDDEN");
      expect(await db.select().from(participants).where(eq(participants.canonicalEmail, actor.email))).toEqual([]);
    }
    await expectNothingWritten(event.id, entryId);
    // The Superadministrator is an Administrator too.
    state.actor = await staff("SUPERADMIN");
    await expect(moveReserveEntryToOwnAddressAction(null, press(entryId))).rejects.toThrow(/saved=reserveOwnAddressGuest/);
  });

  it("finds a line already moved gone on a second press, and registers nobody twice", async () => {
    const event = await createRace(3);
    const entryId = await line(event.id);
    await expect(moveReserveEntryToOwnAddressAction(null, press(entryId))).rejects.toThrow(/REDIRECT/);
    expect(await moveReserveEntryToOwnAddressAction(null, press(entryId))).toMatchObject({ error: "NOT_FOUND" });
    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(1);
  });
});
