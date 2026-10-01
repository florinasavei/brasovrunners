import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied, NoFreePlaceError } from "@/modules/registrations/domain/capacity";
import { OFFER_AFTER_CLOSE, offerRefusalCode } from "@/modules/registrations/domain/waitlist";
import { isDomainError } from "@/shared/errors/domain-error";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §104, §587 and §589) — the owner, 2026-10-01: the race has 200 medals and announces
 * 150 places; once the list forms, the organizer wants to hand the margin out to the people of their
 * choice rather than let it go to the head of the line at once. So:
 *
 * - **the setting** — `events.waitlist_auto_offer`, «Ofertele din lista de așteptare pleacă automat»:
 *   with «Nu», `fillAvailableSpots` offers nothing, the one gate every caller obeys — a cancellation,
 *   an erasure, an offer's expiry, the maintenance job's sweep (the capacity raise is in
 *   `tests/integration/cms/capacity-raise.test.ts`);
 * - **newcomers queue while anyone waits**, under either value — a family too;
 * - **«Trimite-i oferta»** (`offerPlaceToByStaff`): the ordinary offer to the person chosen, under the
 *   event lock, into a counted free place, never a confirmation.
 *
 * With «Da» everything is as before: the existing suites (cancel-offers-waitlist, maintenance,
 * capacity-raise, family-reservations, give-place) run unchanged.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const WINDOW_MS = 10 * 60_000;
const HOUR = 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The send-now drain, watched: outside a request it would do nothing anyway (`drain.ts`).
const sentNow = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: (ids: readonly string[]) => {
    if (ids.length > 0) sentNow.push([...ids]);
  },
}));

const { continueFamilySittingAndReserve, submitRegistration, confirmEmail, offerPlaceToByStaff, unregister } = await import("@/modules/registrations/service");
const { cancelRegistrationByStaff, deleteRegistrationByStaff, offerPlaceByStaff, promoteRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { countOccupied, findEventsNeedingMaintenance } = await import("@/modules/registrations/repository");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  forgetCachedDeadlines();
  sentNow.length = 0;
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.ro", displayName: "Organizer", role: "MODERATOR" }).returning();
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

async function createEvent(capacity: number, options: { auto?: boolean; closesAt?: Date | null } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-11T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      registrationClosesAt: options.closesAt ?? null,
      waitlistAutoOffer: options.auto ?? true,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: event.registrationClosesAt, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, email: string, sentAt: Date) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** One person on their own address, taken as far as the address's confirmation. */
async function confirmedAddress(event: EventInput, name: string, minute: number) {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute)), at(minute), "REAL", PUBLIC);
  return confirmEmail(db, event, (await rowOf(name)).id, at(minute));
}

const setAuto = (eventId: string, auto: boolean) => db.update(events).set({ waitlistAutoOffer: auto }).where(eq(events.id, eventId));
const offersQueued = async () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
const occupied = async (eventId: string, when: Date) => computeOccupied(await countOccupied(db, eventId, when));

/**
 * A race of one place: Ana holds it (her declaration to sign), Elena and Luca wait — in that order —
 * and the offers are the organizer's («Nu»).
 */
async function oneHeldTwoWaiting(auto = false) {
  const event = await createEvent(1, { auto });
  expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
  expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");
  expect((await confirmedAddress(event, "Luca", 2)).status).toBe("WAITLISTED");
  return event;
}

describe("§NNN «Nu»: a freed place is offered to nobody — the one gate inside fillAvailableSpots", () => {
  it("a staff cancel frees the place and offers it to nobody: the line stands, no offer email, the place free", async () => {
    const event = await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    expect((await rowOf("Ana")).status).toBe("CANCELLED");
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLISTED", "WAITLISTED"]);
    expect(await offersQueued()).toHaveLength(0);
    expect(sentNow).toEqual([]);
    expect(await occupied(event.id, at(10))).toBe(0);
  });

  it("the participant's own cancel and an erasure: the same", async () => {
    const event = await oneHeldTwoWaiting();
    await unregister(db, event, (await rowOf("Ana")).id, "PARTICIPANT", at(10), { via: "MANAGE_LINK", reason: { kind: "INJURY_OR_ILLNESS", text: null } });
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(0);

    await resetTables(db);
    await db.delete(familyPlaceHolds);
    [admin] = await db.insert(staffUsers).values({ email: "admin2@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    const pair: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
    }
    await oneHeldTwoWaiting();
    await deleteRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "cerere de ștergere", at(10));
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(0);
  });

  it("the maintenance job does not select the event for its free place, and offers nobody when it runs", async () => {
    const event = await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    expect(await findEventsNeedingMaintenance(db, at(11))).not.toContain(event.id);
    const result = await runRegistrationMaintenance(db, at(11));
    expect(result.errorCount).toBe(0);
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(0);

    // Switched to «Da», the same free place is the sweep's again, and goes to the head of the line.
    await setAuto(event.id, true);
    expect(await findEventsNeedingMaintenance(db, at(12))).toContain(event.id);
    await runRegistrationMaintenance(db, at(12));
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLIST_OFFERED", "WAITLISTED"]);
  });

  it("an offer that lapses frees its place and offers it to nobody next", async () => {
    const event = await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    // The organizer's offer to Luca, ahead of Elena; its email leaves, its clock runs out.
    await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(11));
    const [offer] = await offersQueued();
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(11), attemptCount: 1 }).where(eq(emailOutbox.id, offer.id));
    const lapse = new Date((await rowOf("Luca")).holdExpiresAt!.getTime() + 60_000);
    await runRegistrationMaintenance(db, lapse);
    expect((await rowOf("Luca")).status).toBe("EXPIRED");
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(1);
    expect(await occupied(event.id, lapse)).toBe(0);
  });

  it("«Da» is today's rule: the same cancel offers the place to the head of the line at once", async () => {
    await oneHeldTwoWaiting(true);
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLIST_OFFERED", "WAITLISTED"]);
    expect(await offersQueued()).toHaveLength(1);
  });
});

describe("§NNN newcomers queue while anyone waits, whatever the setting", () => {
  it("«Nu»: a free place beside somebody waiting is not the newcomer's — they join the line", async () => {
    const event = await oneHeldTwoWaiting();
    // Two more places, offered to nobody (the editor's raise is the cms suite's; here the row itself).
    await db.update(events).set({ capacity: 3 }).where(eq(events.id, event.id));
    const wider = { ...event, capacity: 3 };
    expect(await occupied(event.id, at(5))).toBe(1);
    const newcomer = await confirmedAddress(wider, "Radu", 5);
    expect(newcomer.status).toBe("WAITLISTED");
    expect(await occupied(event.id, at(5))).toBe(1);
    expect(await offersQueued()).toHaveLength(0);
  });

  it("«Da»: places freed with people waiting go to the line in the newcomer's own transaction, and the newcomer queues behind those still waiting", async () => {
    const event = await oneHeldTwoWaiting(true);
    expect((await confirmedAddress(event, "Mara", 3)).status).toBe("WAITLISTED");
    // Two more places, written with no offer (as a row changed by hand): three wait beside two free places.
    await db.update(events).set({ capacity: 3 }).where(eq(events.id, event.id));
    const wider = { ...event, capacity: 3 };
    const newcomer = await confirmedAddress(wider, "Radu", 4);
    // The allocator's opening offered the two places to Elena and Luca, in order; Mara still waits, so Radu queues.
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status, (await rowOf("Mara")).status]).toEqual(["WAITLIST_OFFERED", "WAITLIST_OFFERED", "WAITLISTED"]);
    expect(newcomer.status).toBe("WAITLISTED");
  });

  it("an open offer is not somebody waiting: with a place left over and nobody waiting, the newcomer holds it, under either setting (§160)", async () => {
    for (const auto of [true, false]) {
      await resetTables(db);
      await db.delete(familyPlaceHolds);
      [admin] = await db.insert(staffUsers).values({ email: `admin-${auto}@example.ro`, displayName: "Admin", role: "ADMIN" }).returning();
      const pair: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
        await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
      }
      const event = await createEvent(1, { auto });
      await confirmedAddress(event, "Ana", 0);
      expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");
      // Two more places, and the organizer's offer to Elena: one offer open, one place left over, nobody waiting.
      await db.update(events).set({ capacity: 3 }).where(eq(events.id, event.id));
      const wider = { ...event, capacity: 3 };
      await offerPlaceToByStaff(db, wider, (await rowOf("Elena")).id, admin, at(2));
      expect((await rowOf("Elena")).status).toBe("WAITLIST_OFFERED");
      const newcomer = await confirmedAddress(wider, "Radu", 3);
      expect(newcomer.status, `auto ${auto}`).toBe("PENDING_DECLARATION");
    }
  });

  it("with nobody in the line a newcomer takes a free place directly, as before", async () => {
    const event = await createEvent(2, { auto: false });
    expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
    expect((await confirmedAddress(event, "Radu", 1)).status).toBe("PENDING_DECLARATION");
  });

  it("a family that arrives while somebody waits reserves nothing and joins the line whole", async () => {
    const event = await oneHeldTwoWaiting();
    await db.update(events).set({ capacity: 4 }).where(eq(events.id, event.id));
    const wider = { ...event, capacity: 4 };
    const first = await submitRegistration(db, wider, submission("Ioana", "familia@example.ro", at(5)), at(5), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = first.sittingId ?? randomUUID();
    const firstWindowEnd = new Date(at(5).getTime() + WINDOW_MS);
    const pressed = await continueFamilySittingAndReserve(db, { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" }, firstWindowEnd, at(5), { firstWindowEnd, firstName: "Ioana Munteanu", email: "familia@example.ro" });
    expect(pressed.place).toBe("waitlist");
    const second = await submitRegistration(db, wider, submission("Mihai", "familia@example.ro", at(6)), at(6), "REAL", { ...PUBLIC, sitting: { id: pressed.sittingId ?? cookieId, joined: true, newPerson: true } });
    expect(second.sittingPlace).toBe("waitlist");
    // Nothing reserved and no place held for the second form: the count is Ana's hold alone, three
    // places free and two people waiting — every form of the family said «pe lista de așteptare».
    expect(await occupied(event.id, at(6))).toBe(1);
    expect(await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.holdsPlace, true))).toEqual([]);
    expect((await rowOf("Ioana")).holdExpiresAt).toBeNull();
    // The address confirmed: into the line, behind Elena and Luca.
    expect((await confirmEmail(db, wider, (await rowOf("Ioana")).id, at(7))).status).toBe("WAITLISTED");
  });

  it("the same family, with nobody waiting, reserves its places as before (§543)", async () => {
    const event = await createEvent(4, { auto: false });
    const first = await submitRegistration(db, event, submission("Ioana", "familia@example.ro", at(5)), at(5), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = first.sittingId ?? randomUUID();
    const firstWindowEnd = new Date(at(5).getTime() + WINDOW_MS);
    const pressed = await continueFamilySittingAndReserve(db, { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" }, firstWindowEnd, at(5), { firstWindowEnd, firstName: "Ioana Munteanu", email: "familia@example.ro" });
    expect(pressed.place).toBe("reserved");
    const second = await submitRegistration(db, event, submission("Mihai", "familia@example.ro", at(6)), at(6), "REAL", { ...PUBLIC, sitting: { id: pressed.sittingId ?? cookieId, joined: true, newPerson: true } });
    expect(second.sittingPlace).toBe("reserved");
    expect(await occupied(event.id, at(6))).toBe(2);
  });
});

describe("§NNN «Trimite-i oferta»: the ordinary offer, to the person chosen, into a counted free place", () => {
  it("offers the chosen row — not the oldest — with the ordinary deadline and email, and the trail names who, to whom and how many waited before", async () => {
    const event = await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    const luca = await rowOf("Luca");
    const offered = await offerPlaceByStaff(db, admin, luca.id, at(11));
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.offerCreatedAt).toEqual(at(11));
    // The club's 24 hours (§377), capped by nothing here: the race is weeks away, with no close.
    expect(offered.holdExpiresAt).toEqual(new Date(at(11).getTime() + 24 * HOUR));
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(offered.bibNumber).toBeNull();

    const offers = await offersQueued();
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ registrationId: luca.id, status: "PENDING", payloadJson: { startsDeadline: true, sentNow: true } });
    expect(sentNow.flat()).toContain(offers[0].id);

    const [trail] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.offered_by_staff"), eq(auditLogs.entityId, luca.id)));
    expect(trail).toMatchObject({ actorStaffUserId: admin.id, participantId: luca.participantId, entityType: "registration", metadataJson: { from: "WAITLISTED", to: "WAITLIST_OFFERED", aheadOf: 1 } });
    // The offer is counted: the place is promised, not free.
    expect(await occupied(event.id, at(11))).toBe(1);
  });

  it("two offers in a row for one free place: the second is refused with who holds the places", async () => {
    await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(11));
    const refusal = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(12)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(NoFreePlaceError);
    expect((refusal as NoFreePlaceError).places).toEqual({ capacity: 1, confirmed: 0, declaration: 0, offered: 1, family: 0 });
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(1);
  });

  it("refuses a full event, a row that is not waiting, a cancelled event and an event past its close", async () => {
    const event = await oneHeldTwoWaiting();
    // Full: Ana holds the one place.
    const full = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(5)).then(() => null, (error: unknown) => error);
    expect(full).toBeInstanceOf(NoFreePlaceError);
    // Not waiting: Ana's own row.
    const notWaiting = await offerPlaceByStaff(db, admin, (await rowOf("Ana")).id, at(5)).then(() => null, (error: unknown) => error);
    expect(isDomainError(notWaiting) && notWaiting.code).toBe("CONFLICT");

    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    // Cancelled: nobody is offered a place in a race that will not run (§331).
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    const cancelled = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(11)).then(() => null, (error: unknown) => error);
    expect(isDomainError(cancelled) && cancelled.code).toBe("VALIDATION_ERROR");
    expect(offerRefusalCode(cancelled)).toBeNull();

    // Past the close: an offer then would already be lapsed.
    await db.update(events).set({ eventStatus: "SCHEDULED", registrationClosesAt: at(12) }).where(eq(events.id, event.id));
    const late = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(13)).then(() => null, (error: unknown) => error);
    expect(offerRefusalCode(late)).toBe(OFFER_AFTER_CLOSE);
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLISTED", "WAITLISTED"]);
    expect(await offersQueued()).toHaveLength(0);
    // The desk's «Dă-i un loc» still seats a walk-in then: the paper confirmation into the free place.
    expect((await promoteRegistrationByStaff(db, admin, (await rowOf("Elena")).id, at(13))).status).toBe("CONFIRMED");
  });

  it("is the Administrator's: the Organizer, who reads the list, is refused before anything is written", async () => {
    await oneHeldTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
    const refused = await offerPlaceByStaff(db, organizer, (await rowOf("Elena")).id, at(11)).then(() => null, (error: unknown) => error);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    // The service asserts it too, for a caller that is not the admin service.
    const event = { ...(await createEvent(1)), id: (await rowOf("Elena")).eventId };
    const direct = await offerPlaceToByStaff(db, event, (await rowOf("Elena")).id, organizer, at(11)).then(() => null, (error: unknown) => error);
    expect(isDomainError(direct) && direct.code).toBe("FORBIDDEN");
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
  });

  it("a test registration is offered exactly as a real one: kind is in no condition (§30)", async () => {
    const outcomes: string[][] = [];
    for (const kind of ["REAL", "TEST"] as const) {
      await resetTables(db);
      await db.delete(familyPlaceHolds);
      [admin] = await db.insert(staffUsers).values({ email: `admin-${kind.toLowerCase()}@example.ro`, displayName: "Admin", role: "ADMIN" }).returning();
      const pair: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
        await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
      }
      const event = await createEvent(1, { auto: false });
      await confirmedAddress(event, "Ana", 0);
      await submitRegistration(db, event, submission("Elena", "elena@example.ro", at(1)), at(1), kind, PUBLIC);
      await confirmEmail(db, event, (await rowOf("Elena")).id, at(1));
      await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(10));
      const statusBefore = (await rowOf("Elena")).status;
      const offered = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(11));
      outcomes.push([statusBefore, offered.status, String(await occupied(event.id, at(11)))]);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual(["WAITLISTED", "WAITLIST_OFFERED", "1"]);
  });

  it("says its question and its refusals in both languages, inside §511's 200 characters", () => {
    for (const [messages, locale] of [[ro, "ro"], [en, "en"]] as const) {
      const say = createTranslator({ locale, messages, namespace: "Admin" });
      const body = say("confirm.offerPlaceBody", { name: "Elena Munteanu", message: say("emails.types.WAITLIST_SPOT_OFFER"), deadline: "sâm., 26 sept. 2026, 10:00" });
      expect(body).toContain("Elena Munteanu");
      expect(body).toContain(say("emails.types.WAITLIST_SPOT_OFFER"));
      expect(body.length).toBeLessThanOrEqual(200);
      expect(say("errors.OFFER_AFTER_CLOSE").length).toBeLessThanOrEqual(200);
      expect(say("desk.offerPlace")).toBe(locale === "ro" ? "Trimite-i oferta" : "Send them the offer");
      expect(say("confirm.offerPlaceTitle")).toBe(locale === "ro" ? "Îi trimiți oferta?" : "Send them the offer?");
    }
    const roBody = createTranslator({ locale: "ro", messages: ro, namespace: "Admin" })("confirm.offerPlaceBody", { name: "Elena", message: "S-a eliberat un loc", deadline: "joi, 1 oct., 10:00" });
    expect(roBody).toBe("Elena primește emailul «S-a eliberat un loc» și are până joi, 1 oct., 10:00 să semneze; sare înaintea celor dinaintea lui.");
  });
});
