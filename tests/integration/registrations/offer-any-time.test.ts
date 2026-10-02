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
import { computeOccupied, SUPPLEMENTARY_PLACE_UNCONFIRMED, supplementaryPlaceRefusalOutcome } from "@/modules/registrations/domain/capacity";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTranslator } from "next-intl";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";

/**
 * §642 (amending §615 and §420) — the owner, 2026-10-02: «Vreau să pot „oferi loc" în orice moment,
 * chiar și pe liste suplimentare». «Trimite-i oferta» (`offerPlaceToByStaff`):
 *
 * - **after the close** the offer goes, its deadline the club's window capped by the start alone, and
 *   its queued email keeps it occupied until the start; the automatic offers still make none then;
 * - **on a full event** it adds one supplementary place — `capacity + 1` on that one event row, the
 *   trail row `event.capacity_raised_for_offer` (from, to, who, for whom) — and the offer occupies
 *   the new place before `fillAvailableSpots` runs, so on «Da» the head of the line does not take it;
 * - never overbooking, never on a cancelled or finished event, never twice for the same person,
 *   nothing on an uncapped event, and `kind` in no condition.
 *
 * The two-connection race (two Administrators, one free place) is `tests/concurrency/capacity.test.ts`.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const STARTS = new Date("2026-10-11T07:00:00.000Z");
const HOUR = 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The public cache, watched: a supplementary place must expire the free-place count (§333).
const expired = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    expired.push(contents);
  },
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { submitRegistration, confirmEmail, offerPlaceToByStaff, readPublicPlaces, signDeclaration } = await import("@/modules/registrations/service");
const { staffOfferIfMadeNow, staffOfferQuestion } = await import("@/modules/registrations/give-place-tip");
const { cancelRegistrationByStaff, offerPlaceByStaff } = await import("@/modules/registrations/admin-service");
const { countOccupied, findEventsNeedingMaintenance } = await import("@/modules/registrations/repository");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { listAuditTrail, recordAuditEvent } = await import("@/modules/audit/repository");
const { planDeadlineRebase } = await import("@/modules/notifications/deadline-rebase");

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
  expired.length = 0;
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

async function createEvent(capacity: number, options: { auto?: boolean; closesAt?: Date | null; repeatOf?: string } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      registrationClosesAt: options.closesAt ?? null,
      waitlistAutoOffer: options.auto ?? false,
      ...(options.repeatOf ? { repeatOf: options.repeatOf } : {}),
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

async function confirmedAddress(event: EventInput, name: string, minute: number, kind: "REAL" | "TEST" = "REAL") {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute)), at(minute), kind, PUBLIC);
  return confirmEmail(db, event, (await rowOf(name)).id, at(minute));
}

/** One place, Ana holding it, Elena then Luca waiting. */
async function fullWithTwoWaiting(options: { auto?: boolean; closesAt?: Date | null } = {}) {
  const event = await createEvent(1, options);
  expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
  expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");
  expect((await confirmedAddress(event, "Luca", 2)).status).toBe("WAITLISTED");
  return event;
}

const capacityOf = async (eventId: string) => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity;
const offersQueued = async () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
const raises = async (eventId: string) =>
  db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.capacity_raised_for_offer"), eq(auditLogs.entityId, eventId)));
const refusalOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

/** The page's forecast reads the wall clock: set it to the test's instant, the database's timers left alone. */
async function atTheClock<R>(now: Date, work: () => Promise<R>): Promise<R> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    return await work();
  } finally {
    vi.useRealTimers();
  }
}

describe("§642 «Trimite-i oferta» after the close: capped by the start alone; the automatic offers still make none", () => {
  it("the automatic sweep offers nobody after the close; the staff offer goes, with the club's 24 hours", async () => {
    const event = await fullWithTwoWaiting({ auto: true, closesAt: at(12) });
    // Ana's place freed after the close: «Da», yet nothing is offered (§420).
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(13));
    await runRegistrationMaintenance(db, at(14));
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLISTED", "WAITLISTED"]);
    expect(await offersQueued()).toHaveLength(0);

    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(15));
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.holdExpiresAt).toEqual(new Date(at(15).getTime() + 24 * HOUR));
    expect(offered.capacityRaisedTo).toBeNull();
    // On «Da», the sweep inside the press offered Elena nothing either: it is after the close.
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    const [offer] = await offersQueued();
    expect(offer.payloadJson).toMatchObject({ startsDeadline: true, untilStart: true });
    expect(await capacityOf(event.id)).toBe(1);
  });

  it("an offer made two hours before the start lapses at the start", async () => {
    await fullWithTwoWaiting({ closesAt: at(12) });
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(13));
    const late = new Date(STARTS.getTime() - 2 * HOUR);
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, late)).holdExpiresAt).toEqual(STARTS);
  });

  it("its queued email keeps it occupied past its stored deadline until the start, and its send moves it from the send (§513, §520)", async () => {
    const event = await fullWithTwoWaiting({ closesAt: at(12) });
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(13));
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(15));
    const past = new Date(offered.holdExpiresAt!.getTime() + HOUR);
    // The email still queued: its clock has not started, though the close is long behind.
    expect(computeOccupied(await countOccupied(db, event.id, past))).toBe(1);
    expect(await findEventsNeedingMaintenance(db, past)).not.toContain(event.id);
    // Its send re-bases it from the send, with the start as its one cap.
    const [row] = await offersQueued();
    const plan = await planDeadlineRebase(db, row, past);
    expect(plan?.to).toEqual(new Date(offered.holdExpiresAt!.getTime() + (past.getTime() - row.createdAt.getTime())));
    // Gone at the start, whatever its email is doing.
    expect(computeOccupied(await countOccupied(db, event.id, STARTS))).toBe(0);
  });

  it("made after the close, it is accepted by signing the declaration, as any offer", async () => {
    const event = await fullWithTwoWaiting({ closesAt: at(12) });
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(15), { addPlaceTo: 2 });
    expect(offered.capacityRaisedTo).toBe(2);
    const confirmed = await signDeclaration(db, event, offered.id, await signingInput(db, at(30), "Luca Munteanu"), at(30));
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("refuses once the event has started: an offer then would be born lapsed", async () => {
    const event = await fullWithTwoWaiting({ closesAt: at(12) });
    const started = await refusalOf(offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, STARTS));
    expect(isDomainError(started) && started.code).toBe("VALIDATION_ERROR");
    expect(await capacityOf(event.id)).toBe(1);
    expect(await raises(event.id)).toHaveLength(0);
  });
});

describe("§642 «Trimite-i oferta» on a full event: one supplementary place, explicit and audited", () => {
  it("raises the capacity by one, writes who and for whom, offers the named person, and the public count reads 2 of 2 with the offer", async () => {
    const event = await fullWithTwoWaiting();
    const luca = await rowOf("Luca");
    const offered = await offerPlaceByStaff(db, admin, luca.id, at(5), { addPlaceTo: 2 });
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.capacityRaisedTo).toBe(2);
    expect(await capacityOf(event.id)).toBe(2);

    const [raised] = await raises(event.id);
    expect(raised).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", participantId: null, metadataJson: { from: 1, to: 2, registrationId: luca.id } });
    // The registration's page reads it among its own trail.
    expect((await listAuditTrail(db, "registration", luca.id, event.id)).map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["event.capacity_raised_for_offer", "registration.offered_by_staff"]),
    );
    // Elena's page does not: the place was added for Luca.
    expect((await listAuditTrail(db, "registration", (await rowOf("Elena")).id, event.id)).map((entry) => entry.action)).not.toContain("event.capacity_raised_for_offer");

    // The public count: two places, both taken — Ana's hold and Luca's offer — Elena still waiting.
    const places = await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(5));
    expect(places).toMatchObject({ availablePlaces: 0, offered: 1, occupied: 2, waitlisted: 1 });
    expect(expired).toContainEqual(["places"]);
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
  });

  it("the registration's page reads its own event's raises only: another event's are never listed (§642)", async () => {
    const event = await fullWithTwoWaiting();
    const luca = await rowOf("Luca");
    await offerPlaceByStaff(db, admin, luca.id, at(5), { addPlaceTo: 2 });
    // Another full race, with its own raise for its own waiting runner.
    const other = await createEvent(1);
    expect((await confirmedAddress(other, "Ioana", 6)).status).toBe("PENDING_DECLARATION");
    expect((await confirmedAddress(other, "Radu", 7)).status).toBe("WAITLISTED");
    await offerPlaceByStaff(db, admin, (await rowOf("Radu")).id, at(8), { addPlaceTo: 2 });
    // And a row about that other event naming Luca, which no path writes: the trail reads his event's rows alone.
    await recordAuditEvent(db, {
      actorStaffUserId: admin.id,
      participantId: null,
      action: "event.capacity_raised_for_offer",
      entityType: "event",
      entityId: other.id,
      metadata: { from: 2, to: 3, registrationId: luca.id },
      now: at(9),
    });

    const raisedFor = async (registrationId: string, eventId: string) =>
      (await listAuditTrail(db, "registration", registrationId, eventId)).filter((entry) => entry.action === "event.capacity_raised_for_offer").map((entry) => entry.metadataJson);
    expect(await raisedFor(luca.id, event.id)).toEqual([{ from: 1, to: 2, registrationId: luca.id }]);
    expect(await raisedFor((await rowOf("Radu")).id, other.id)).toEqual([{ from: 1, to: 2, registrationId: (await rowOf("Radu")).id }]);
  });

  it("with «Da», the named person gets the new place, not the head of the line", async () => {
    const event = await fullWithTwoWaiting({ auto: true });
    await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(5), { addPlaceTo: 2 });
    expect([(await rowOf("Elena")).status, (await rowOf("Luca")).status]).toEqual(["WAITLISTED", "WAITLIST_OFFERED"]);
    expect(await capacityOf(event.id)).toBe(2);
    expect(computeOccupied(await countOccupied(db, event.id, at(5)))).toBe(2);
    expect(await offersQueued()).toHaveLength(1);
  });

  it("takes a free place when there is one, and a lapsed declaration hold the line wants before adding any (§160)", async () => {
    const event = await fullWithTwoWaiting();
    // Ana's deadline is behind and her email left: the line wants her place, so the press releases it rather than adding one.
    await db.update(registrations).set({ holdExpiresAt: at(3) }).where(eq(registrations.id, (await rowOf("Ana")).id));
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(0), attemptCount: 1 });
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(10));
    expect(offered.capacityRaisedTo).toBeNull();
    expect((await rowOf("Ana")).status).toBe("EXPIRED");
    expect(await capacityOf(event.id)).toBe(1);
    expect(await raises(event.id)).toHaveLength(0);
  });

  it("a second press for the same person refuses, and adds nothing", async () => {
    const event = await fullWithTwoWaiting();
    const luca = (await rowOf("Luca")).id;
    await offerPlaceByStaff(db, admin, luca, at(5), { addPlaceTo: 2 });
    const again = await refusalOf(offerPlaceByStaff(db, admin, luca, at(6), { addPlaceTo: 3 }));
    expect(isDomainError(again) && again.code).toBe("CONFLICT");
    expect(await capacityOf(event.id)).toBe(2);
    expect(await raises(event.id)).toHaveLength(1);
    expect(await offersQueued()).toHaveLength(1);
  });

  it("an uncapped event never lacks a place: the offer is made and nothing is raised", async () => {
    const event = await fullWithTwoWaiting();
    await db.update(events).set({ capacity: null }).where(eq(events.id, event.id));
    const offered = await offerPlaceToByStaff(db, { ...event, capacity: null }, (await rowOf("Elena")).id, admin, at(5));
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.capacityRaisedTo).toBeNull();
    expect(await capacityOf(event.id)).toBeNull();
    expect(await raises(event.id)).toHaveLength(0);
  });

  it("a cancelled or finished event refuses, and its capacity stays", async () => {
    for (const status of ["CANCELLED", "COMPLETED"] as const) {
      await resetTables(db);
      await db.delete(familyPlaceHolds);
      [admin] = await db.insert(staffUsers).values({ email: `admin-${status.toLowerCase()}@example.ro`, displayName: "Admin", role: "ADMIN" }).returning();
      const pair: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
        await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
      }
      const event = await fullWithTwoWaiting();
      await db.update(events).set({ eventStatus: status }).where(eq(events.id, event.id));
      const refused = await refusalOf(offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(5)));
      expect(isDomainError(refused) && refused.code, status).toBe("VALIDATION_ERROR");
      expect(await capacityOf(event.id), status).toBe(1);
      expect(await raises(event.id), status).toHaveLength(0);
      expect((await rowOf("Elena")).status, status).toBe("WAITLISTED");
    }
  });

  it("touches one event row: the series' other dates keep their capacity, and the row's version moves", async () => {
    const source = await createEvent(1);
    const date = await createEvent(1, { repeatOf: source.id });
    const [before] = await db.select({ version: events.version }).from(events).where(eq(events.id, date.id));
    await confirmedAddress(date, "Ana", 0);
    expect((await confirmedAddress(date, "Elena", 1)).status).toBe("WAITLISTED");
    await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(5), { addPlaceTo: 2 });
    expect(await capacityOf(date.id)).toBe(2);
    expect(await capacityOf(source.id)).toBe(1);
    const [after] = await db.select({ version: events.version, updatedBy: events.updatedByStaffUserId }).from(events).where(eq(events.id, date.id));
    // An editor opened before the press is told the event changed, rather than writing 1 back (AGENTS.md §11.5).
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedBy).toBe(admin.id);
  });

  it("a press the dialog did not confirm adds no place: refused, and nothing is written (the page was read while a place was free)", async () => {
    const event = await fullWithTwoWaiting();
    const elena = (await rowOf("Elena")).id;
    expired.length = 0;
    // The plain question and the plain button: the form posts no `addPlace`.
    const unasked = await refusalOf(offerPlaceByStaff(db, admin, elena, at(5)));
    expect(supplementaryPlaceRefusalOutcome(unasked)).toEqual({ error: SUPPLEMENTARY_PLACE_UNCONFIRMED });
    expect(await capacityOf(event.id)).toBe(1);
    expect(await raises(event.id)).toHaveLength(0);
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
    expect(await offersQueued()).toHaveLength(0);
    expect(expired).not.toContainEqual(["places"]);
    // Pressed again from the page now drawn — the question names 2 — it adds that one place.
    expect((await offerPlaceByStaff(db, admin, elena, at(6), { addPlaceTo: 2 })).capacityRaisedTo).toBe(2);
  });

  it("a confirmation of another capacity is refused: another Administrator's raise since the page was read is not this one", async () => {
    const event = await fullWithTwoWaiting();
    // The page said «capacitatea devine 2»; meanwhile somebody else raised it to 2 and took that place.
    await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(5), { addPlaceTo: 2 });
    const stale = await refusalOf(offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(6), { addPlaceTo: 2 }));
    expect(supplementaryPlaceRefusalOutcome(stale)).toEqual({ error: SUPPLEMENTARY_PLACE_UNCONFIRMED });
    expect(await capacityOf(event.id)).toBe(2);
    expect(await raises(event.id)).toHaveLength(1);
    expect((await rowOf("Elena")).status).toBe("WAITLISTED");
  });

  it("a confirmed raise no longer needed adds nothing: a place freed since the page was read is used", async () => {
    const event = await fullWithTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(4));
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(5), { addPlaceTo: 2 });
    expect(offered.capacityRaisedTo).toBeNull();
    expect(await capacityOf(event.id)).toBe(1);
    expect(await raises(event.id)).toHaveLength(0);
  });

  it("is the Administrator's: the Organizer is refused and nothing is raised", async () => {
    const event = await fullWithTwoWaiting();
    const refused = await refusalOf(offerPlaceByStaff(db, organizer, (await rowOf("Elena")).id, at(5)));
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    const direct = await refusalOf(offerPlaceToByStaff(db, event, (await rowOf("Elena")).id, organizer, at(5)));
    expect(isDomainError(direct) && direct.code).toBe("FORBIDDEN");
    expect(await capacityOf(event.id)).toBe(1);
  });

  it("kind is in no condition: a test row holding the place, or chosen, is counted as a real one (§30)", async () => {
    const outcomes: unknown[] = [];
    for (const [holder, chosen] of [
      ["REAL", "REAL"],
      ["TEST", "REAL"],
      ["REAL", "TEST"],
    ] as const) {
      await resetTables(db);
      await db.delete(familyPlaceHolds);
      [admin] = await db.insert(staffUsers).values({ email: `admin-${holder.toLowerCase()}-${chosen.toLowerCase()}@example.ro`, displayName: "Admin", role: "ADMIN" }).returning();
      const pair: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
        await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
      }
      const event = await createEvent(1);
      await confirmedAddress(event, "Ana", 0, holder);
      await confirmedAddress(event, "Elena", 1, chosen);
      const offered = await offerPlaceByStaff(db, admin, (await rowOf("Elena")).id, at(5), { addPlaceTo: 2 });
      outcomes.push([offered.status, offered.capacityRaisedTo, computeOccupied(await countOccupied(db, event.id, at(5)))]);
    }
    expect(outcomes).toEqual([
      ["WAITLIST_OFFERED", 2, 2],
      ["WAITLIST_OFFERED", 2, 2],
      ["WAITLIST_OFFERED", 2, 2],
    ]);
  });
});

describe("§642 the question before the press: «vreau confirmare când depășesc limita»", () => {
  it("on a full race after the close, the dialog says a place is added and what the capacity becomes, and its button names the added place", async () => {
    const event = await fullWithTwoWaiting({ closesAt: at(12) });
    const forecast = await atTheClock(at(15), () => staffOfferIfMadeNow(event.id, "ro"));
    expect(forecast).toMatchObject({ afterClose: true, raisedTo: 2 });
    for (const [messages, locale] of [[ro, "ro"], [en, "en"]] as const) {
      const say = createTranslator({ locale, messages, namespace: "Admin" });
      const question = staffOfferQuestion((key, values) => (say as unknown as (key: string, values?: Record<string, string>) => string)(key, values), "Luca Munteanu", forecast!);
      expect(question.confirmLabel).toBe(say("confirm.offerPlaceRaiseConfirm"));
      expect(question.body).toContain(say("confirm.offerPlaceRaise", { n: "2" }));
      expect(question.body).toContain(say("confirm.offerPlaceAfterClose"));
      expect(question.body).toContain("Luca Munteanu");
    }
    // The press agrees with the question.
    // The form posts the capacity the question named (`addPlace`), and the server adds that one place.
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Luca")).id, at(15), { addPlaceTo: forecast!.raisedTo })).capacityRaisedTo).toBe(2);
  });

  it("with a place free and registration open, it says neither, and the button is the plain «Trimite-i oferta»", async () => {
    const event = await fullWithTwoWaiting();
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "nu mai vine", at(3));
    const forecast = await atTheClock(at(4), () => staffOfferIfMadeNow(event.id, "ro"));
    expect(forecast).toMatchObject({ afterClose: false, raisedTo: null });
    const say = createTranslator({ locale: "ro", messages: ro, namespace: "Admin" });
    const question = staffOfferQuestion((key, values) => (say as unknown as (key: string, values?: Record<string, string>) => string)(key, values), "Elena Munteanu", forecast!);
    expect(question.confirmLabel).toBe("Trimite-i oferta");
    expect(question.body).not.toContain(say("confirm.offerPlaceAfterClose"));
    expect(question.body).not.toContain("capacitatea devine");
  });

  it("a lapsed declaration hold the line wants is not «full»: the press releases it rather than adding a place", async () => {
    const event = await fullWithTwoWaiting();
    await db.update(registrations).set({ holdExpiresAt: at(3) }).where(eq(registrations.id, (await rowOf("Ana")).id));
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(0), attemptCount: 1 });
    expect(await atTheClock(at(10), () => staffOfferIfMadeNow(event.id, "ro"))).toMatchObject({ raisedTo: null });
  });

  it("once the event has started there is no question: the button is not drawn", async () => {
    const event = await fullWithTwoWaiting();
    expect(await atTheClock(STARTS, () => staffOfferIfMadeNow(event.id, "ro"))).toBeNull();
  });
});
