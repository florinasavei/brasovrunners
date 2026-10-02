import { and, eq, sql } from "drizzle-orm";
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
import { publicFill } from "@/modules/events/domain/registration-cta";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «În afara locurilor» (§NNN; the owner, 2026-10-02: «Vreau și o bifă de „ascunde la numărare” per
 * fiecare participant») — a registration the club seats outside the event's places: an organizer, a
 * pacemaker, an invited runner. The capacity formula's one explicit exclusion (`AGENTS.md` §10.6):
 *
 * - the allocator: an outside row consumes nothing in any state, a full event still gives it a place,
 *   the places line does not move for it, and no stale-hold sweep releases its hold to anybody;
 * - marking a counted row frees its place — offered to the first in line on «Da», kept free on «Nu»;
 *   marking a waiting row seats it outside at once, with the declaration email;
 * - unmarking needs a free place, else §589's refusal;
 * - Administrator only, audited from → to; a cancelled row's flag is not changed; a TEST row the same.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { submitRegistration, confirmEmail, readPublicPlaces } = await import("@/modules/registrations/service");
const { cancelRegistrationByStaff, confirmRegistrationByStaff, setOutsideCapacity } = await import("@/modules/registrations/admin-service");
const { countOccupied, expireStaleHolds, countOutsideOnPublicStartList, countPublicStartList, countAnonymousStartListEntries, countOutsideCapacity } = await import(
  "@/modules/registrations/repository"
);
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { summariseRegistrationsForAdmin, listRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");
const { countRegisteredPerUpcomingEvent, registeredBadgeHint } = await import("@/modules/registrations/nav-count");

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

async function createEvent(capacity: number, options: { auto?: boolean } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-11T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
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
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, email: string, sentAt: Date, listOptOut = false) => ({
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
  listOptOut,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

async function submitted(event: EventInput, name: string, minute: number, kind: "REAL" | "TEST" = "REAL", listOptOut = false) {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute), listOptOut), at(minute), kind, PUBLIC);
  return rowOf(name);
}

async function confirmedAddress(event: EventInput, name: string, minute: number, kind: "REAL" | "TEST" = "REAL") {
  const row = await submitted(event, name, minute, kind);
  return confirmEmail(db, event, row.id, at(minute));
}

const occupied = async (eventId: string, when: Date) => computeOccupied(await countOccupied(db, eventId, when));
const offers = async () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("§NNN the allocator: a registration outside the places consumes none", () => {
  it("a full event still gives an outside registration a place when its address is confirmed — the places line unchanged", async () => {
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
    const before = await readPublicPlaces(db, { id: event.id, capacity: 1, waitlistCapacity: null }, at(5));

    const guest = await submitted(event, "Ioana", 5);
    // Marked while it waits for its address: it applies when the address is confirmed.
    expect((await setOutsideCapacity(db, admin, guest.id, true, at(6))).status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect((await confirmEmail(db, event, guest.id, at(7))).status).toBe("PENDING_DECLARATION");

    expect(await occupied(event.id, at(8))).toBe(1);
    const after = await readPublicPlaces(db, { id: event.id, capacity: 1, waitlistCapacity: null }, at(8));
    expect(after).toEqual(before);
    // The public «N înscriși din C» reads the same numbers: the guest is in none of them.
    const fill = publicFill(1, after.availablePlaces, { occupied: after.occupied, confirmed: after.confirmed, waitlisted: after.waitlisted });
    expect(fill).toEqual(publicFill(1, before.availablePlaces, { occupied: before.occupied, confirmed: before.confirmed, waitlisted: before.waitlisted }));
    expect(fill).toMatchObject({ taken: 1, capacity: 1 });
    // …and a newcomer still meets a full event.
    expect((await confirmedAddress(event, "Radu", 9)).status).toBe("WAITLISTED");
  });

  it("an outside confirmed registration is in no confirmed count the public reads", async () => {
    const event = await createEvent(3);
    await confirmedAddress(event, "Ana", 0);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Ana")).id, at(1));
    await confirmedAddress(event, "Bogdan", 2);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Bogdan")).id, at(3));
    await setOutsideCapacity(db, admin, (await rowOf("Bogdan")).id, true, at(4));
    const places = await readPublicPlaces(db, { id: event.id, capacity: 3, waitlistCapacity: null }, at(5));
    expect(places.confirmed).toBe(1);
    expect(places.occupied).toBe(1);
    expect(places.availablePlaces).toBe(2);
    // The outside runner keeps their number (§548) and their state.
    const bogdan = await rowOf("Bogdan");
    expect(bogdan.status).toBe("CONFIRMED");
    expect(bogdan.bibNumber).not.toBeNull();
  });

  it("no stale-hold sweep releases an outside hold for somebody waiting: it holds no counted place", async () => {
    const event = await createEvent(1);
    // The guest is seated outside, then a runner takes the one place and a third waits.
    const guest = await submitted(event, "Ioana", 0);
    await setOutsideCapacity(db, admin, guest.id, true, at(1));
    await confirmEmail(db, event, guest.id, at(1));
    await confirmedAddress(event, "Ana", 2);
    expect((await confirmedAddress(event, "Radu", 3)).status).toBe("WAITLISTED");
    // Both holds past their deadline, somebody waiting.
    await db.update(registrations).set({ holdExpiresAt: at(4) }).where(eq(registrations.eventId, event.id));
    await db.delete(emailOutbox);
    const later = at(60);
    await expireStaleHolds(db, { id: event.id, startsAt: event.startsAt, eventStatus: "SCHEDULED", capacity: 1 }, later);
    expect((await rowOf("Ioana")).status).toBe("PENDING_DECLARATION");
    // The counted lapsed hold is still the one released, as before (§160).
    expect((await rowOf("Ana")).status).toBe("EXPIRED");
  });
});

describe("§NNN marking and unmarking, under the event lock", () => {
  async function fullWithLine(auto: boolean) {
    const event = await createEvent(1, { auto });
    await confirmedAddress(event, "Ana", 0);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Ana")).id, at(1));
    expect((await confirmedAddress(event, "Radu", 2)).status).toBe("WAITLISTED");
    return event;
  }

  it("marking a confirmed runner on a full event frees the place: «Da» offers it to the first in line", async () => {
    const event = await fullWithLine(true);
    await setOutsideCapacity(db, admin, (await rowOf("Ana")).id, true, at(10));
    expect((await rowOf("Ana")).status).toBe("CONFIRMED");
    expect((await rowOf("Ana")).outsideCapacity).toBe(true);
    expect((await rowOf("Radu")).status).toBe("WAITLIST_OFFERED");
    expect(await offers()).toHaveLength(1);
    expect(await occupied(event.id, at(11))).toBe(1);
  });

  it("…and «Nu» keeps it free for the organizer", async () => {
    const event = await fullWithLine(false);
    await setOutsideCapacity(db, admin, (await rowOf("Ana")).id, true, at(10));
    expect((await rowOf("Radu")).status).toBe("WAITLISTED");
    expect(await offers()).toHaveLength(0);
    expect(await occupied(event.id, at(11))).toBe(0);
  });

  it("marking a waiting runner seats them outside at once: a declaration with the ordinary deadline and its email", async () => {
    const event = await fullWithLine(true);
    const radu = await setOutsideCapacity(db, admin, (await rowOf("Radu")).id, true, at(10));
    expect(radu.status).toBe("PENDING_DECLARATION");
    expect(radu.outsideCapacity).toBe(true);
    expect(radu.holdExpiresAt).not.toBeNull();
    const declarations = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.registrationId, radu.id), eq(emailOutbox.messageType, "COMPLETE_DECLARATION")));
    expect(declarations.length).toBeGreaterThan(0);
    expect(await occupied(event.id, at(11))).toBe(1);
  });

  it("unmarking is refused while the event is full, with §589's counts, and allowed once a place is free", async () => {
    const event = await createEvent(1, { auto: false });
    await confirmedAddress(event, "Ana", 0);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Ana")).id, at(1));
    await setOutsideCapacity(db, admin, (await rowOf("Ana")).id, true, at(2));
    await confirmedAddress(event, "Bogdan", 3);
    expect(await occupied(event.id, at(4))).toBe(1);

    const refused = await refusal(setOutsideCapacity(db, admin, (await rowOf("Ana")).id, false, at(5)));
    expect(refused).toBeInstanceOf(NoFreePlaceError);
    expect((refused as NoFreePlaceError).places).toMatchObject({ capacity: 1, declaration: 1 });
    expect((await rowOf("Ana")).outsideCapacity).toBe(true);

    await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));
    await setOutsideCapacity(db, admin, (await rowOf("Ana")).id, false, at(6));
    expect((await rowOf("Ana")).outsideCapacity).toBe(false);
    expect(await occupied(event.id, at(7))).toBe(2);
  });

  it("every change is written to the journal, from → to, with who", async () => {
    const event = await createEvent(2);
    await confirmedAddress(event, "Ana", 0);
    const ana = await rowOf("Ana");
    await setOutsideCapacity(db, admin, ana.id, true, at(1));
    await setOutsideCapacity(db, admin, ana.id, false, at(2));
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.outside_capacity_changed"));
    expect(trail).toHaveLength(2);
    expect(trail.map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: false, to: true, status: "PENDING_DECLARATION" }),
        expect.objectContaining({ from: true, to: false, status: "PENDING_DECLARATION" }),
      ]),
    );
    expect(trail.every((row) => row.actorStaffUserId === admin.id && row.entityId === ana.id)).toBe(true);
  });

  it("the Organizer reads and may not change it; a cancelled row's flag is not changed", async () => {
    const event = await createEvent(2);
    await confirmedAddress(event, "Ana", 0);
    const forbidden = await refusal(setOutsideCapacity(db, organizer, (await rowOf("Ana")).id, true, at(1)));
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
    expect((await rowOf("Ana")).outsideCapacity).toBe(false);

    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(2));
    const ended = await refusal(setOutsideCapacity(db, admin, (await rowOf("Ana")).id, true, at(3)));
    expect(isDomainError(ended) && ended.code).toBe("CONFLICT");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.outside_capacity_changed"))).toHaveLength(0);
  });

  it("a TEST registration is marked exactly as a real one: `kind` is in no condition", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);
    const guest = await submitted(event, "Ioana", 1, "TEST");
    await setOutsideCapacity(db, admin, guest.id, true, at(2));
    expect((await confirmEmail(db, event, guest.id, at(3))).status).toBe("PENDING_DECLARATION");
    expect(await occupied(event.id, at(4))).toBe(1);
  });
});

describe("§NNN the counts: public apart, backoffice joined apart", () => {
  it("the public list keeps a ticked outside runner's row and leaves them out of its numbers; an unticked one is in neither", async () => {
    const event = await createEvent(5);
    for (const [name, minute, optOut] of [["Ana", 0, false], ["Ioana", 2, false], ["Mihai", 4, true]] as const) {
      await submitted(event, name, minute, "REAL", optOut);
      await confirmEmail(db, event, (await rowOf(name)).id, at(minute));
      await confirmRegistrationByStaff(db, admin, (await rowOf(name)).id, at(minute + 1));
    }
    await setOutsideCapacity(db, admin, (await rowOf("Ioana")).id, true, at(10));
    await setOutsideCapacity(db, admin, (await rowOf("Mihai")).id, true, at(11));
    // The table pages over every ticked confirmed row; the title and the summary line subtract the outside ones.
    expect(await countPublicStartList(db, event.id)).toBe(2);
    expect(await countOutsideOnPublicStartList(db, event.id)).toBe(1);
    // Mihai did not tick and is outside: not even «Participant (nume ascuns)».
    expect(await countAnonymousStartListEntries(db, event.id)).toBe(0);
    expect(await countOutsideCapacity(db, event.id)).toBe(2);
  });

  it("the summary strip counts them apart, the list filters to them, the badge leaves them out of «cu loc»", async () => {
    const event = await createEvent(5);
    await confirmedAddress(event, "Ana", 0);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Ana")).id, at(1));
    await confirmedAddress(event, "Ioana", 2);
    await confirmRegistrationByStaff(db, admin, (await rowOf("Ioana")).id, at(3));
    await setOutsideCapacity(db, admin, (await rowOf("Ioana")).id, true, at(4));

    const summary = await summariseRegistrationsForAdmin(db, { eventId: event.id });
    expect(summary).toMatchObject({ real: 2, outside: 1, byStatus: { CONFIRMED: 2 } });
    const rows = await listRegistrationsForAdmin(db, { eventId: event.id, outsideCapacity: true });
    expect(rows.map((row) => [row.registeredName, row.outsideCapacity])).toEqual([["Ioana Munteanu", true]]);

    const [badge] = await countRegisteredPerUpcomingEvent(db, at(5), "ro");
    expect(badge).toMatchObject({ count: 2, withPlace: 1, confirmed: 1, outside: 1 });
    const hint = registeredBadgeHint(
      { withPlace: 1, confirmed: 1, waitlisted: 0, awaitingEmail: 0, events: [badge] },
      {
        rule: () => "rule",
        event: (title, count, parts) => `${title}: ${count} — ${parts}`,
        withPlace: (count) => `${count} cu loc`,
        withPlaceOf: (count, capacity) => `${count} cu loc din ${capacity}`,
        awaitingEmail: (count) => `${count} email`,
        waitlisted: (count) => `${count} așteaptă`,
        outside: (count) => `${count} în afara locurilor`,
        more: (count) => `+${count}`,
      },
    );
    expect(hint.split("\n")[1]).toBe("Crosul: 2 — 1 cu loc din 5, 1 în afara locurilor");
  });
});
