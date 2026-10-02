import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeOccupied, NoFreePlaceError } from "@/modules/registrations/domain/capacity";
import { countOccupied } from "@/modules/registrations/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { WAITLIST_FULL, waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { SUPPLEMENTARY_PLACE_UNCONFIRMED, supplementaryPlaceRefusalOutcome } from "@/modules/registrations/domain/capacity";
import {
  confirmEmail,
  type EventForRegistration,
  offerPlaceToByStaff,
  setOutsideCapacityByStaff,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";

/**
 * BR-REQ-034-02 and BR-REQ-034-03 — capacity cannot be exceeded, and the waiting list cannot
 * be leapfrogged, under real concurrent load.
 *
 * PGlite is single-connection and cannot express two transactions racing each other
 * (`tests/helpers/db.ts`); this is the suite that runs the same allocator
 * (`modules/registrations/service.ts`) against a real PostgreSQL server with genuinely
 * parallel connections, via `yarn test:concurrency` — see `tests/concurrency/cms-conflict.test.ts`
 * for the same requirement against the CMS.
 *
 * `confirmEmail`/`unregister` each manage their own transaction internally, so — unlike the
 * CMS suite — no manual session bookkeeping is needed here: calling the same pooled `db`
 * concurrently is enough for `node-postgres` to hand each call its own connection, and
 * `lockEventForCapacity`'s `SELECT ... FOR UPDATE` is what then serializes them correctly.
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "tests/concurrency needs a real PostgreSQL: set DATABASE_URL and run `yarn db:migrate` first. " +
      "Locally: docker compose up -d db.",
  );
}

describe("BR-REQ-034-02/034-03 capacity under real concurrency", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 30 });
  const db = drizzle(pool);

  const NOW = new Date("2026-09-04T10:00:00.000Z");
  let eventCounter = 0;
  const createdEventIds: string[] = [];
  const createdParticipantIds: string[] = [];
  /** The Administrator who sends the offers of §615's and §NNN's cases, made once by the first and removed after. */
  let staffId: string | null = null;
  /** The Administrator of the «În afara locurilor» case (§NNN), made by that case and removed after. */
  let outsideStaffId: string | null = null;
  async function administrator(): Promise<{ id: string; role: "ADMIN" }> {
    if (!staffId) {
      const [staff] = await db
        .insert(staffUsers)
        .values({ email: `offer.race.${Date.now()}@example.ro`, displayName: "Offers", role: "ADMIN" })
        .returning();
      staffId = staff.id;
    }
    return { id: staffId, role: "ADMIN" };
  }

  beforeAll(async () => {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    // Idempotent: only inserted if no approved version exists yet, so re-runs don't collide.
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    }).catch(() => undefined);
    // The club's terms (§421): a public submission is refused while none is approved.
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 1,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    }).catch(() => undefined);
  });

  afterAll(async () => {
    // Only this suite's own rows, in FK order — a developer's local database may hold seeded
    // or hand-created events with the same `kind` that must survive this suite running.
    // The staff offers' trail (§615): its rows name this suite's registrations and its own staff user.
    const ownRegistrations = await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.eventId, createdEventIds));
    if (ownRegistrations.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, ownRegistrations.map((row) => row.id)));
    }
    await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
    await db.delete(events).where(inArray(events.id, createdEventIds));
    await db.delete(participants).where(inArray(participants.id, createdParticipantIds));
    for (const id of [staffId, outsideStaffId]) {
      if (!id) continue;
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, id));
      await db.delete(staffUsers).where(eq(staffUsers.id, id));
    }
    await pool.end();
  });

  /** A fresh, uniquely-named event for each test, never reused across tests. */
  async function createInternalEvent(capacity: number | null, waitlistCapacity: number | null = null): Promise<EventForRegistration> {
    eventCounter += 1;
    const [event] = await db
      .insert(events)
      .values({
        type: "MEETUP",
        startsAt: new Date("2026-12-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
        capacity,
        waitlistCapacity,
      })
      .returning();
    createdEventIds.push(event.id);

    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      capacity: event.capacity,
      raceId: null,
      publishedAt: NOW,
    };
  }

  async function createPendingRegistration(eventId: string, emailLocalPart: string) {
    const identity = canonicalizeEmail(`${emailLocalPart}.${eventCounter}@example.ro`);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: emailLocalPart,
        emailVerifiedAt: NOW,
      })
      .returning();
    createdParticipantIds.push(participant.id);

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status: "PENDING_EMAIL_CONFIRMATION",
        locale: "ro",
        registeredName: emailLocalPart,
        displayName: emailLocalPart,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();

    return registration;
  }

  async function statusesFor(eventId: string) {
    return db
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, eventId));
  }

  it(
    "BR-REQ-034-02 criterion 1: exactly one of twenty simultaneous confirmations wins one free place",
    async () => {
      const event = await createInternalEvent(1);
      const pendingRegistrations = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createPendingRegistration(event.id, `runner${i}`)),
      );

      await Promise.all(
        pendingRegistrations.map((registration) => confirmEmail(db, event, registration.id, NOW)),
      );

      const rows = await statusesFor(event.id);
      const pendingDeclaration = rows.filter((r) => r.status === "PENDING_DECLARATION");
      const waitlisted = rows.filter((r) => r.status === "WAITLISTED");

      expect(pendingDeclaration).toHaveLength(1);
      expect(waitlisted).toHaveLength(19);
      // Every row landed in one of the two expected states — nothing was lost, and nothing
      // reached CONFIRMED or stayed PENDING_EMAIL_CONFIRMATION.
      expect(pendingDeclaration.length + waitlisted.length).toBe(20);
    },
    30_000,
  );

  it(
    "BR-REQ-034-03: a released place goes to the waiting list, never to a concurrent new registration",
    async () => {
      const event = await createInternalEvent(1);

      // One confirmed participant occupying the only place.
      const holder = await createPendingRegistration(event.id, "holder");
      await db
        .update(registrations)
        .set({ status: "CONFIRMED", confirmedAt: NOW })
        .where(eq(registrations.id, holder.id));

      // One participant already waiting, ahead of anyone who has not even confirmed email yet.
      const waiting = await createPendingRegistration(event.id, "waiting");
      await db
        .update(registrations)
        .set({ status: "WAITLISTED", waitlistedAt: NOW })
        .where(eq(registrations.id, waiting.id));

      // A brand-new registrant, confirming email at the exact moment the place is released.
      const newcomer = await createPendingRegistration(event.id, "newcomer");

      await Promise.all([
        unregister(db, event, holder.id, "PARTICIPANT", new Date(NOW.getTime() + 1000)),
        confirmEmail(db, event, newcomer.id, new Date(NOW.getTime() + 1000)),
      ]);

      const rows = await statusesFor(event.id);
      const byId = new Map(rows.map((r) => [r.id, r.status]));

      expect(byId.get(holder.id)).toBe("CANCELLED");
      // The entry that was already waiting gets the released place — offered it, not handed
      // it outright, since accepting still requires signing the declaration.
      expect(byId.get(waiting.id)).toBe("WAITLIST_OFFERED");
      // The newcomer joins the end of the queue rather than leapfrogging into the freed place.
      expect(byId.get(newcomer.id)).toBe("WAITLISTED");
    },
    30_000,
  );

  it(
    "BR-REQ-034-02 criterion 1, the restart door (`DECISIONS.md` §151): twenty verified participants restarting cancelled rows at once win one place",
    async () => {
      const event = await createInternalEvent(1);
      // Twenty people who registered once, cancelled, and come back — verified, so the restart
      // skips the email step and allocates straight away: the one path that used to allocate
      // without the event lock.
      const cancelled = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createPendingRegistration(event.id, `again${i}`)),
      );
      await db
        .update(registrations)
        // Each the same runner coming back (§389): a restart is of this runner's own row, found by
        // the name, once an address may carry several runners — the name the submission below types.
        .set({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "PARTICIPANT", registeredName: "Ana Pop", nameKey: "ana pop" })
        .where(
          inArray(
            registrations.id,
            cancelled.map((row) => row.id),
          ),
        );
      const people = await db
        .select({ id: participants.id, email: participants.deliveryEmail })
        .from(participants)
        .where(
          inArray(
            participants.id,
            cancelled.map((row) => row.participantId),
          ),
        );

      // Real time: the approved privacy notice the seed left in this database is effective
      // from the day it was seeded, and the event starts in December 2026 either way.
      const later = new Date();
      await Promise.all(
        people.map((person) =>
          submitRegistration(
            db,
            event,
            {
              firstName: "Ana",
              lastName: "Pop",
              birthDate: "1990-05-17",
              sex: "FEMALE",
              nationality: "RO",
              country: "RO",
              city: "Brașov",
              phone: "+40711111111",
              emergencyContactName: "Contact Urgență",
              emergencyContactPhone: "+40722222222",
              email: person.email,
              locale: "ro",
              privacyAcknowledged: true,
              fitnessDeclared: true,
              termsAccepted: true,
              rulesAcknowledged: true,
              resultsNameConsent: false,
              listOptOut: true,
              honeypot: "",
              renderedAt: new Date(later.getTime() - 10_000).toISOString(),
            },
            later,
          ),
        ),
      );

      const rows = await statusesFor(event.id);
      expect(rows.filter((r) => r.status === "PENDING_DECLARATION")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(19);
    },
    30_000,
  );

  it(
    "BR-REQ-035-01 (§348): one slot left in a capped waiting list, twenty simultaneous confirmations — exactly one joins it",
    async () => {
      // One place, taken; a waiting list of two, one already in it. One slot left in the line.
      const event = await createInternalEvent(1, 2);
      const holder = await createPendingRegistration(event.id, "holder");
      await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW }).where(eq(registrations.id, holder.id));
      const first = await createPendingRegistration(event.id, "first");
      await db.update(registrations).set({ status: "WAITLISTED", waitlistedAt: NOW }).where(eq(registrations.id, first.id));

      const racing = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createPendingRegistration(event.id, `slot${i}`)),
      );
      const outcomes = await Promise.allSettled(
        racing.map((registration) => confirmEmail(db, event, registration.id, NOW)),
      );

      // The count is taken under the event lock that decides the place, so the slot is decided
      // once: one confirmation queued, nineteen refused with the waiting list's own refusal.
      const refused = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(refused).toHaveLength(19);
      for (const outcome of refused) {
        expect(waitlistRefusalOf((outcome as PromiseRejectedResult).reason)).toBe(WAITLIST_FULL);
      }

      const rows = await statusesFor(event.id);
      expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(2);
      expect(rows.filter((r) => r.status === "CONFIRMED")).toHaveLength(1);
      // The refused ones wrote nothing: they are exactly as they were before the press.
      expect(rows.filter((r) => r.status === "PENDING_EMAIL_CONFIRMATION")).toHaveLength(19);
    },
    30_000,
  );

  it(
    "§615, §NNN: offers by hand («Nu») and one free place — two staff offers racing for it, both read while it was free: one takes it, the other is refused unasked and adds no place; pressed again, confirmed, it adds exactly one",
    async () => {
      const event = await createInternalEvent(1);
      await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
      const actor = await administrator();

      // The one place free, nobody offered it (the setting is «Nu»), and two people waiting.
      const waiting = await Promise.all(["first", "second"].map((name) => createPendingRegistration(event.id, `offer-${name}`)));
      for (const [index, row] of waiting.entries()) {
        await db
          .update(registrations)
          .set({ status: "WAITLISTED", waitlistedAt: new Date(NOW.getTime() + index * 1000) })
          .where(eq(registrations.id, row.id));
      }

      // Two Administrators press «Trimite-i oferta» at once, each on a different person. Both pages were
      // read while the place was free: the plain question, so neither form posts `addPlace`.
      const outcomes = await Promise.allSettled(waiting.map((row) => offerPlaceToByStaff(db, event, row.id, actor, NOW)));

      // One takes the free place; the other meets the full count under the lock and, unasked, adds nothing (§NNN).
      const made = outcomes.filter((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof offerPlaceToByStaff>>>[];
      expect(made).toHaveLength(1);
      expect(made[0].value.capacityRaisedTo).toBeNull();
      const refused = outcomes.filter((outcome) => outcome.status === "rejected") as PromiseRejectedResult[];
      expect(refused).toHaveLength(1);
      expect(supplementaryPlaceRefusalOutcome(refused[0].reason)).toEqual({ error: SUPPLEMENTARY_PLACE_UNCONFIRMED });

      let rows = await statusesFor(event.id);
      expect(rows.filter((r) => r.status === "WAITLIST_OFFERED")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(1);
      const capacityNow = async () => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, event.id)))[0].capacity;
      expect(await capacityNow()).toBe(1);
      const raisedRows = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, event.id))).filter((row) => row.action === "event.capacity_raised_for_offer");
      expect(await raisedRows()).toHaveLength(0);

      // The loser's page, drawn again, asks «capacitatea devine 2»; confirmed, the press adds exactly that one place.
      const loser = waiting.find((row) => !made.some((outcome) => outcome.value.id === row.id))!;
      const again = await offerPlaceToByStaff(db, event, loser.id, actor, NOW, { addPlaceTo: 2 });
      expect(again.capacityRaisedTo).toBe(2);
      rows = await statusesFor(event.id);
      expect(rows.filter((r) => r.status === "WAITLIST_OFFERED")).toHaveLength(2);
      // Two promises, two places: the capacity grew by exactly one, by a confirmed press, and never was exceeded.
      expect(await capacityNow()).toBe(2);
      const trail = await db.select().from(auditLogs).where(inArray(auditLogs.entityId, waiting.map((row) => row.id)));
      expect(trail.filter((row) => row.action === "registration.offered_by_staff")).toHaveLength(2);
      expect(await raisedRows()).toHaveLength(1);
    },
    30_000,
  );

  it(
    "§NNN: a full race and two Administrators confirming the same supplementary place at once — «capacitatea devine 2» on both pages: one raise and one offer, the other refused, never 3",
    async () => {
      const event = await createInternalEvent(1);
      await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
      const actor = await administrator();

      // The one place confirmed, and two people waiting: the race is full.
      const holder = await createPendingRegistration(event.id, "raise-holder");
      await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW }).where(eq(registrations.id, holder.id));
      const waiting = await Promise.all(["first", "second"].map((name) => createPendingRegistration(event.id, `raise-${name}`)));
      for (const [index, row] of waiting.entries()) {
        await db
          .update(registrations)
          .set({ status: "WAITLISTED", waitlistedAt: new Date(NOW.getTime() + index * 1000) })
          .where(eq(registrations.id, row.id));
      }

      // Both pages were drawn on the full race of one place: each question named 2, each form posts it.
      const outcomes = await Promise.allSettled(waiting.map((row) => offerPlaceToByStaff(db, event, row.id, actor, NOW, { addPlaceTo: 2 })));

      // The first under the lock adds the place and offers it; the second finds 2 of 2 taken, and 2 is not 2 + 1.
      const made = outcomes.filter((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof offerPlaceToByStaff>>>[];
      expect(made).toHaveLength(1);
      expect(made[0].value.capacityRaisedTo).toBe(2);
      const refused = outcomes.filter((outcome) => outcome.status === "rejected") as PromiseRejectedResult[];
      expect(refused).toHaveLength(1);
      expect(supplementaryPlaceRefusalOutcome(refused[0].reason)).toEqual({ error: SUPPLEMENTARY_PLACE_UNCONFIRMED });

      const rows = await statusesFor(event.id);
      expect(rows.filter((r) => r.status === "CONFIRMED")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "WAITLIST_OFFERED")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(1);
      // One place added, by one confirmed press: two promises, two places.
      const [{ capacity }] = await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, event.id));
      expect(capacity).toBe(2);
      const raised = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, event.id))).filter((row) => row.action === "event.capacity_raised_for_offer");
      expect(raised).toHaveLength(1);
      expect(raised[0].metadataJson).toMatchObject({ from: 1, to: 2, registrationId: made[0].value.id });
      const trail = await db.select().from(auditLogs).where(inArray(auditLogs.entityId, waiting.map((row) => row.id)));
      expect(trail.filter((row) => row.action === "registration.offered_by_staff")).toHaveLength(1);
    },
    30_000,
  );

  it(
    "§NNN «În afara locurilor»: the last counted place, ten newcomers and an unmarking racing for it — never above capacity",
    async () => {
      // Two places: one counted runner confirmed, one guest confirmed outside the places — one place free.
      const event = await createInternalEvent(2);
      const [staff] = await db
        .insert(staffUsers)
        .values({ email: `outside.race.${Date.now()}@example.ro`, displayName: "Outside", role: "ADMIN" })
        .returning();
      outsideStaffId = staff.id;
      const actor = { id: staff.id, role: staff.role };
      const holder = await createPendingRegistration(event.id, "outside-holder");
      await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW }).where(eq(registrations.id, holder.id));
      const guest = await createPendingRegistration(event.id, "outside-guest");
      await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW, outsideCapacity: true }).where(eq(registrations.id, guest.id));

      const newcomers = await Promise.all(Array.from({ length: 10 }, (_, i) => createPendingRegistration(event.id, `outside-new${i}`)));
      const outcomes = await Promise.allSettled([
        setOutsideCapacityByStaff(db, event, guest.id, false, actor, NOW),
        ...newcomers.map((row) => confirmEmail(db, event, row.id, NOW)),
      ]);

      // Whoever won the free place, the counted places never exceed the capacity.
      expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(2);
      const [unmarked] = await db.select().from(registrations).where(eq(registrations.id, guest.id));
      const rows = await statusesFor(event.id);
      const held = rows.filter((r) => r.status === "PENDING_DECLARATION").length;
      if (outcomes[0].status === "fulfilled") {
        // The guest took the place back: every newcomer waits.
        expect(unmarked.outsideCapacity).toBe(false);
        expect(held).toBe(0);
      } else {
        // A newcomer took it first; the unmarking met the full count and changed nothing.
        expect((outcomes[0] as PromiseRejectedResult).reason).toBeInstanceOf(NoFreePlaceError);
        expect(unmarked.outsideCapacity).toBe(true);
        expect(held).toBe(1);
      }
      expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(10 - held);
    },
    30_000,
  );
});
