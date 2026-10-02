import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { isClubCopy } from "@/modules/notifications/domain/club-notices";
import { OutboxMessageWithdrawn } from "@/modules/notifications/outbox";
import { formatDeadlineInSentence, renderOutboxMessage } from "@/modules/notifications/render";
import { holdLapsedIdempotencyKey, queueHoldLapsedEmails } from "@/modules/registrations/hold-lapsed-email";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration, unregister } from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { sendHoldEmails } from "../../helpers/outbox";

/**
 * §638 — «Da, fă emailul pentru cel care pierde locul» (the owner, 2026-10-02). A declaration hold
 * released to somebody who wanted the place (§160) queues one `DECLARATION_HOLD_EXPIRED` for the person
 * who held it, in the transaction that released it, whatever path released it and however often a
 * sweep runs — once per lapsed hold (`registration:<id>:hold-lapsed:<deadline>`), so a restarted
 * registration whose new hold lapses too is told again. A lapsed offer stays silent (§331); a hold the
 * start releases, or a cancelled event's, is told nothing.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const ZONE = "Europe/Bucharest";

describe("§638 the person whose held place lapses is told by email", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now: NOW,
      });
    }
  });

  async function createEvent(overrides: { capacity?: number | null; startsAt?: Date; waitlistCapacity?: number | null } = {}): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: overrides.startsAt ?? new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - 24 * 60 * 60_000),
        capacity: overrides.capacity ?? null,
        waitlistCapacity: overrides.waitlistCapacity ?? null,
        locationName: "Parcul Tractorul",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul de toamnă" },
      { eventId: event.id, locale: "en", slug: `autumn-${event.id.slice(0, 8)}`, title: "Autumn race" },
    ]);
    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      capacity: overrides.capacity ?? null,
      raceId: null,
      publishedAt: event.publishedAt,
    };
  }

  function input(email: string, at: Date, locale: "ro" | "en" = "ro") {
    return {
      firstName: email.split("@")[0],
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email,
      locale,
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(at.getTime() - 10_000).toISOString(),
    };
  }

  /** One person through the form and the address link at `at`: their registration, as it then stands. */
  async function join(event: EventForRegistration, email: string, at: Date, options: { locale?: "ro" | "en"; kind?: RegistrationKind } = {}) {
    const before = new Set((await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, event.id))).map((row) => row.id));
    await submitRegistration(db, event, input(email, at, options.locale), at, options.kind);
    const [fresh] = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).filter((row) => !before.has(row.id));
    return confirmEmail(db, event, fresh.id, at);
  }

  const lapsedEmails = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DECLARATION_HOLD_EXPIRED"));
  const statusOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];

  it("the maintenance job's release queues exactly one, with the locale, the address and the deadline — and a second sweep nothing more", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW, { locale: "en" });
    expect(held.status).toBe("PENDING_DECLARATION");
    const waiter = await join(event, "bogdan@example.ro", NOW);
    expect(waiter.status).toBe("WAITLISTED");
    await sendHoldEmails(db, NOW);

    await runRegistrationMaintenance(db, minutes(31));
    expect((await statusOf(held.id)).status).toBe("EXPIRED");
    expect((await statusOf(waiter.id)).status).toBe("WAITLIST_OFFERED");

    const rows = await lapsedEmails();
    expect(rows).toHaveLength(1);
    const [participant] = await db.select().from(participants).where(eq(participants.id, held.participantId));
    expect(rows[0]).toMatchObject({
      participantId: held.participantId,
      registrationId: held.id,
      locale: "en",
      recipientEmail: participant.deliveryEmail,
      status: "PENDING",
      idempotencyKey: holdLapsedIdempotencyKey(held.id, held.holdExpiresAt!),
    });
    expect(rows[0].payloadJson).toEqual({ eventId: event.id, deadline: held.holdExpiresAt?.toISOString(), toWaitlist: true });

    // Swept again, and later: nothing more, whatever runs.
    await runRegistrationMaintenance(db, minutes(32));
    await runRegistrationMaintenance(db, minutes(120));
    expect(await lapsedEmails()).toHaveLength(1);
    // The same trigger queued twice by hand: still one (the key is the hold's).
    await db.transaction(async (tx) => {
      await queueHoldLapsedEmails(tx, {
        eventId: event.id,
        released: [{ id: held.id, participantId: held.participantId, locale: "en", holdExpiresAt: held.holdExpiresAt }],
        toWaitlist: true,
        now: minutes(121),
      });
    });
    expect(await lapsedEmails()).toHaveLength(1);
  });

  it("renders the deadline in the club's zone, where the place went and what the person can do — the waiting list, a free place, the desk — and is withdrawn once the race is cancelled", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW);
    await join(event, "bogdan@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    await runRegistrationMaintenance(db, minutes(31));
    const [row] = await lapsedEmails();
    const at = minutes(32);

    // Bogdan holds the offer, nobody else waits, the line takes more: the waiting list.
    const waitlist = await renderOutboxMessage(row, db, at);
    expect(waitlist.subject.startsWith("Locul tău la Crosul de toamnă a expirat")).toBe(true);
    expect(waitlist.text).toContain(`Termenul pentru semnare a fost ${formatDeadlineInSentence(held.holdExpiresAt!, ZONE, "ro")}.`);
    expect(waitlist.text).toContain("Altcineva aștepta un loc, așa că locul tău a trecut la lista de așteptare.");
    expect(waitlist.text).toContain("Dacă mai vrei să vii, poți intra pe lista de așteptare.");
    expect(waitlist.text).toMatch(/Intră pe lista de așteptare: \S+\/crosul-[0-9a-f]{8}\/\S+/);
    expect(waitlist.text).toContain(`The deadline to sign was ${formatDeadlineInSentence(held.holdExpiresAt!, ZONE, "en")}.`);
    // A plain page, never a token; no «Nu mai pot ajunge» on a registration that is over.
    expect(waitlist.text).not.toMatch(/\/registrations\/|\/inregistrari\//);
    expect(waitlist.text).not.toContain("Nu mai pot ajunge");

    // Two more places: a newcomer would get one now — register again.
    await db.update(events).set({ capacity: 3 }).where(eq(events.id, event.id));
    const register = await renderOutboxMessage(row, db, at);
    expect(register.text).toContain("Dacă mai vrei să vii, te poți înscrie din nou: mai sunt locuri libere.");
    expect(register.text).toMatch(/Înscrie-te din nou: \S+/);

    // Registration closed: nothing more online, and no button.
    await db.update(events).set({ registrationClosesAt: minutes(1) }).where(eq(events.id, event.id));
    const desk = await renderOutboxMessage(row, db, at);
    expect(desk.text).toContain("Online nu se mai poate face nimic. Dacă în ziua evenimentului rămân locuri libere, le dă masa de înscriere.");
    expect(desk.text).not.toMatch(/Înscrie-te din nou:|Intră pe lista de așteptare:/);

    // Cancelled since (§331): nothing left to say, and the row is withdrawn.
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    await expect(renderOutboxMessage(row, db, at)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
  });

  it("a newcomer's confirmation that releases the hold queues it once — through the line, and on an event with no waiting list", async () => {
    // The line grows by the newcomer and the kept hold goes to them (§160).
    const lined = await createEvent({ capacity: 1 });
    const heldThere = await join(lined, "ana@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    const newcomer = await join(lined, "dan@example.ro", minutes(40));
    expect(newcomer.status).toBe("WAITLIST_OFFERED");
    expect((await statusOf(heldThere.id)).status).toBe("EXPIRED");

    // No waiting list (a limit of 0): the newcomer wants the place, and takes it (§348).
    const noList = await createEvent({ capacity: 1, waitlistCapacity: 0 });
    const heldHere = await join(noList, "ioana@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    const walkIn = await join(noList, "mihai@example.ro", minutes(40));
    expect(walkIn.status).toBe("PENDING_DECLARATION");
    expect((await statusOf(heldHere.id)).status).toBe("EXPIRED");

    const rows = await lapsedEmails();
    expect(rows.map((row) => row.registrationId).sort()).toEqual([heldThere.id, heldHere.id].sort());
    const payloadOf = (id: string) => rows.find((row) => row.registrationId === id)?.payloadJson;
    expect(payloadOf(heldThere.id)).toMatchObject({ toWaitlist: true });
    expect(payloadOf(heldHere.id)).toMatchObject({ toWaitlist: false });
    const noListMail = await renderOutboxMessage(rows.find((row) => row.registrationId === heldHere.id)!, db, minutes(41));
    expect(noListMail.text).toContain("Altcineva a cerut un loc, așa că locul tău a devenit liber.");
    // Full, and no line to join: the desk.
    expect(noListMail.text).toContain("Online nu se mai poate face nimic.");
  });

  it("a cancellation's refill that releases the hold queues it once", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW);
    const first = await join(event, "bogdan@example.ro", NOW);
    const second = await join(event, "carmen@example.ro", minutes(1));
    expect([first.status, second.status]).toEqual(["WAITLISTED", "WAITLISTED"]);
    await sendHoldEmails(db, NOW);

    // The hold lapses with nobody sweeping; Carmen withdraws, and the refill finds Bogdan waiting.
    await unregister(db, event, second.id, "PARTICIPANT", minutes(40));
    expect((await statusOf(held.id)).status).toBe("EXPIRED");
    expect((await statusOf(first.id)).status).toBe("WAITLIST_OFFERED");
    await runRegistrationMaintenance(db, minutes(41));

    const rows = await lapsedEmails();
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationId).toBe(held.id);
  });

  it("a restarted registration whose new hold lapses too is told again — and the older message, unsent, is withdrawn rather than sent for the newer lapse", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW);
    await join(event, "bogdan@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    await runRegistrationMaintenance(db, minutes(31));
    expect((await statusOf(held.id)).status).toBe("EXPIRED");
    const [first] = await lapsedEmails();
    expect(first.idempotencyKey).toBe(holdLapsedIdempotencyKey(held.id, held.holdExpiresAt!));

    // A second place; Ana follows the email's «Înscrie-te din nou» before the drain sent it. The form
    // restarts the same row (§10.5) into a new hold with a new deadline.
    await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));
    await submitRegistration(db, { ...event, capacity: 2 }, input("ana@example.ro", minutes(35)), minutes(35));
    const restarted = await statusOf(held.id);
    expect(restarted.status).toBe("PENDING_DECLARATION");
    expect(restarted.holdExpiresAt?.getTime()).not.toBe(held.holdExpiresAt?.getTime());
    // The first message is now about a hold that is no longer the row's: withdrawn at the send.
    await expect(renderOutboxMessage(first, db, minutes(36))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);

    // Somebody waits again, and the new hold lapses as well: a second message, for the second hold.
    await join(event, "carmen@example.ro", minutes(36));
    await sendHoldEmails(db, minutes(36));
    const later = new Date(restarted.holdExpiresAt!.getTime() + 60_000);
    await runRegistrationMaintenance(db, later);
    expect((await statusOf(held.id)).status).toBe("EXPIRED");
    const rows = await lapsedEmails();
    expect(rows).toHaveLength(2);
    const second = rows.find((row) => row.id !== first.id)!;
    expect(second.idempotencyKey).toBe(holdLapsedIdempotencyKey(held.id, restarted.holdExpiresAt!));
    expect(second.payloadJson).toMatchObject({ deadline: restarted.holdExpiresAt!.toISOString() });
    const told = await renderOutboxMessage(second, db, new Date(later.getTime() + 60_000));
    expect(told.text).toContain(`Termenul pentru semnare a fost ${formatDeadlineInSentence(restarted.holdExpiresAt!, ZONE, "ro")}.`);
    // And the older one still says nothing about the newer lapse.
    await expect(renderOutboxMessage(first, db, new Date(later.getTime() + 60_000))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    // Swept again: nothing more.
    await runRegistrationMaintenance(db, new Date(later.getTime() + 120_000));
    expect(await lapsedEmails()).toHaveLength(2);
  });

  it("a late signature whose own hold the sweep releases moves on to the line, and the message queued for it is withdrawn, never sent", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW);
    await join(event, "bogdan@example.ro", NOW);
    await sendHoldEmails(db, NOW);

    // Ana signs past her deadline while Bogdan waits: `signDeclaration`'s own sweep releases the hold
    // (and queues this message), then re-allocates her (§15.3 step 7).
    await signDeclaration(db, event, held.id, await signingInput(db, minutes(31), "ana Pop"), minutes(31));
    const after = await statusOf(held.id);
    expect(["WAITLISTED", "CONFIRMED"]).toContain(after.status);

    const [row] = await lapsedEmails();
    expect(row.registrationId).toBe(held.id);
    await expect(renderOutboxMessage(row, db, minutes(32))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
  });

  it("a lapsed offer stays silent (§331): only the declaration hold's holder is told", async () => {
    const event = await createEvent({ capacity: 1 });
    const held = await join(event, "ana@example.ro", NOW);
    const offered = await join(event, "bogdan@example.ro", NOW);
    await join(event, "carmen@example.ro", minutes(1));
    await sendHoldEmails(db, NOW);
    await runRegistrationMaintenance(db, minutes(31));
    expect((await statusOf(offered.id)).status).toBe("WAITLIST_OFFERED");
    // The offer's email left, so its own deadline runs (§520); a day later it lapses unsigned.
    await db.update(emailOutbox).set({ status: "SENT", sentAt: minutes(31) }).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
    await runRegistrationMaintenance(db, minutes(31 + 25 * 60));
    expect((await statusOf(offered.id)).expiryReason).toBe("WAITLIST_OFFER_LAPSED");

    const rows = await lapsedEmails();
    expect(rows.map((row) => row.registrationId)).toEqual([held.id]);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_OFFER_EXPIRED"))).toHaveLength(0);
  });

  it("nothing for a hold the start releases, nor for a cancelled event's (§331)", async () => {
    const startsAt = minutes(60);
    const started = await createEvent({ capacity: 1, startsAt });
    const heldAtStart = await join(started, "ana@example.ro", NOW);
    await join(started, "bogdan@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    await runRegistrationMaintenance(db, new Date(startsAt.getTime() + 1000));
    expect((await statusOf(heldAtStart.id)).status).toBe("EXPIRED");

    const cancelled = await createEvent({ capacity: 1 });
    const heldCancelled = await join(cancelled, "ioana@example.ro", NOW);
    await join(cancelled, "mihai@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, cancelled.id));
    await runRegistrationMaintenance(db, minutes(31));
    expect((await statusOf(heldCancelled.id)).status).toBe("PENDING_DECLARATION");

    expect(await lapsedEmails()).toHaveLength(0);
  });

  it("a TEST registration is released and told like a real one (§12.6), and the club gets no copy of it (§320)", async () => {
    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, NOW);
    const testEvent = await createEvent({ capacity: 1 });
    const synthetic = await join(testEvent, "test-ana@test.invalid", NOW, { kind: "TEST" });
    await join(testEvent, "test-bogdan@test.invalid", NOW, { kind: "TEST" });
    const realEvent = await createEvent({ capacity: 1 });
    const real = await join(realEvent, "ana@example.ro", NOW);
    await join(realEvent, "bogdan@example.ro", NOW);
    await sendHoldEmails(db, NOW);
    await runRegistrationMaintenance(db, minutes(31));
    expect((await statusOf(synthetic.id)).status).toBe("EXPIRED");

    const forTest = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "DECLARATION_HOLD_EXPIRED"), eq(emailOutbox.registrationId, synthetic.id)));
    expect(forTest).toHaveLength(1);
    expect(forTest[0].participantId).toBe(synthetic.participantId);
    // The real one's message is copied to the club's address; the test one's never.
    const forReal = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "DECLARATION_HOLD_EXPIRED"), eq(emailOutbox.registrationId, real.id)));
    expect(forReal.filter((row) => isClubCopy(row.payloadJson)).map((row) => row.recipientEmail)).toEqual(["arhiva@club.test"]);
    expect(forTest.some((row) => isClubCopy(row.payloadJson))).toBe(false);
    // The club's copy says what the runner read, with nothing to act on (§320): no button.
    const copy = await renderOutboxMessage(forReal.find((row) => isClubCopy(row.payloadJson))!, db, minutes(32));
    expect(copy.subject.startsWith("[Copie club] Locul tău la Crosul de toamnă a expirat")).toBe(true);
    expect(copy.text).toContain("Dacă mai vrei să vii, poți intra pe lista de așteptare.");
    expect(copy.text).not.toContain("Intră pe lista de așteptare:");
  });
});
