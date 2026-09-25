import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmByStaff, confirmEmail, type EventForRegistration, readPublicAvailability, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-01 criterion 7 (`DECISIONS.md` §104) — a free race is confirmed a week before.
 *
 * A registration for a race five weeks away keeps its place until two days before the start,
 * gets the declaration email at once and again when the window opens, is confirmed by the
 * signature whenever it comes, and loses the place at the deadline when somebody is waiting
 * for it — through the same hold expiry that releases a lapsed thirty-minute hold; with
 * nobody waiting the place stays theirs until the start (§160).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const START = new Date("2026-10-11T06:00:00.000Z");

async function approve(db: TestDatabase) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

/** The full row, as the routes pass it — the window's two columns included. */
async function createEvent(db: TestDatabase, overrides: Partial<typeof events.$inferInsert> = {}): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, registrationMode: "INTERNAL", capacity: 1, locationName: "Parcul Tractorul", publishedAt: NOW, ...overrides })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: event.registrationMode,
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}

const submission = (email: string) => ({
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
});

describe("the participation window (§104)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function verified(event: EventForRegistration, email: string, now = NOW) {
    await submitRegistration(db, event, submission(email), now);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id)).then((rows) => rows.filter((r) => r.status === "PENDING_EMAIL_CONFIRMATION"));
    return confirmEmail(db, event, row.id, now);
  }

  it("holds the place until the deadline for a race five weeks away, and says so in the email", async () => {
    await approve(db);
    const event = await createEvent(db);
    // The defaults from the row: opens 7 days before, due 2 days before.
    expect(confirmationWindow(event)).toEqual({ opensAt: new Date(START.getTime() - 7 * DAY), deadline: new Date(START.getTime() - 2 * DAY) });

    const pending = await verified(event, "ana@example.ro");
    expect(pending.status).toBe("PENDING_DECLARATION");
    expect(pending.holdExpiresAt).toEqual(new Date(START.getTime() - 2 * DAY));

    const [queued] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "COMPLETE_DECLARATION"));
    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    // The deadline with its weekday, and the English half in English (§349).
    expect(message.subject).toBe(
      "Ești înscris — confirmă participarea până la vineri, 9 oct. 2026, 09:00 / You are registered — confirm your participation by Friday, 9 Oct 2026, 09:00",
    );
    expect(message.text).toContain("Cursa e gratuită");
    expect(message.text).toContain("pe hârtie la masa de înscrieri");
    expect(message.text).toContain("Dacă se formează lista de așteptare, locul îți este ținut până la vineri, 9 oct. 2026, 09:00");
    expect(message.text).toContain("If a waiting list forms, the place is held for you until Friday, 9 Oct 2026, 09:00");
  });

  it("keeps the thirty minutes inside the window, on a weekly run, and when the window is switched off", async () => {
    await approve(db);
    const soon = await createEvent(db, { startsAt: new Date(NOW.getTime() + 3 * DAY) });
    const inside = await verified(soon, "inside@example.ro");
    expect(inside.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));

    const off = await createEvent(db, { confirmationOpensDaysBefore: 0 });
    const immediate = await verified(off, "off@example.ro");
    expect(immediate.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));

    const queued = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, immediate.id))).find((r) => r.messageType === "COMPLETE_DECLARATION")!;
    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toMatch(/^Un loc te așteaptă — semnează declarația/);
  });

  it("reminds once when the window opens, confirms on the signature, and releases the place at the deadline", async () => {
    await approve(db);
    const event = await createEvent(db);
    const pending = await verified(event, "ana@example.ro");
    const before = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, pending.id));
    expect(before.map((r) => r.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION"]);

    // A week out but still before the window opens (eight days): nothing new.
    const eightDaysBefore = new Date(START.getTime() - 8 * DAY);
    expect((await runRegistrationMaintenance(db, eightDaysBefore)).confirmationsQueued).toBe(0);

    // The window opens: one reminder, and a second run adds none.
    const opened = new Date(START.getTime() - 7 * DAY + 60_000);
    expect((await runRegistrationMaintenance(db, opened)).confirmationsQueued).toBe(1);
    expect((await runRegistrationMaintenance(db, new Date(opened.getTime() + 3600_000))).confirmationsQueued).toBe(0);
    const reminders = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, pending.id));
    expect(reminders.filter((r) => r.messageType === "COMPLETE_DECLARATION")).toHaveLength(2);
    expect(reminders.some((r) => r.idempotencyKey === `registration:${pending.id}:confirm-participation`)).toBe(true);

    // The place is still theirs, and the signature — inside the window — confirms it.
    const signedAt = new Date(START.getTime() - 5 * DAY);
    const confirmed = await signDeclaration(db, event, pending.id, await signingInput(db, signedAt, "Ana Popescu"), signedAt);
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("keeps an unsigned place past the deadline while nobody waits, and the desk confirms it on paper (§160)", async () => {
    await approve(db);
    const event = await createEvent(db); // capacity 1
    const held = await verified(event, "late@example.ro");

    const afterDeadline = new Date(START.getTime() - 2 * DAY + 60_000);
    expect((await runRegistrationMaintenance(db, afterDeadline)).eventsProcessed).toBe(0);
    const [kept] = await db.select().from(registrations).where(eq(registrations.id, held.id));
    expect(kept.status).toBe("PENDING_DECLARATION");
    expect(await readPublicAvailability(db, event, afterDeadline)).toBe(0);

    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    const raceMorning = new Date(START.getTime() - 60 * 60_000);
    const onPaper = await confirmByStaff(db, event, held.id, { id: volunteer.id }, raceMorning);
    expect(onPaper.status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, held.id));
    expect(acceptance.method).toBe("PAPER");
  });

  it("lets the deadline release an unsigned place to the waiting list", async () => {
    await approve(db);
    const event = await createEvent(db); // capacity 1
    const first = await verified(event, "first@example.ro");
    const second = await verified(event, "second@example.ro");
    expect(second.status).toBe("WAITLISTED");

    // The deadline passes without a signature: the hold lapses, the place goes to the queue.
    const afterDeadline = new Date(START.getTime() - 2 * DAY + 60_000);
    await runRegistrationMaintenance(db, afterDeadline);
    const [lapsed] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(lapsed.status).toBe("EXPIRED");
    const [offered] = await db.select().from(registrations).where(eq(registrations.id, second.id));
    expect(offered.status).toBe("WAITLIST_OFFERED");
  });

  it("refuses the late signature when somebody is waiting, and signs nothing (§160)", async () => {
    await approve(db);
    const event = await createEvent(db); // capacity 1
    const first = await verified(event, "first@example.ro");
    const second = await verified(event, "second@example.ro");
    expect(second.status).toBe("WAITLISTED");

    // The deadline is behind and a queue exists, so the hold is not kept: signing re-runs
    // allocation (§15.3 step 7) and finds the place is the queue's, not this person's.
    const afterDeadline = new Date(START.getTime() - 2 * DAY + 60_000);
    const outcome = await signDeclaration(db, event, first.id, await signingInput(db, afterDeadline, "Ana Popescu"), afterDeadline);
    expect(outcome.status).toBe("WAITLISTED");
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, first.id))).toEqual([]);

    // And the place that was released went to the person who was waiting for it.
    const [promoted] = await db.select().from(registrations).where(eq(registrations.id, second.id));
    expect(promoted.status).toBe("WAITLIST_OFFERED");
  });

  /*
    §NNN (amending §104; the owner, 2026-09-25: "fereastra de confirmare trebuie să fie 0 la final,
    să nu expire"): a deadline of zero days is the start itself. The place given before the window
    opens lapses nowhere before the race begins — not even with somebody waiting — the email says
    "până la start" beside the date, the desk confirms on paper on the race morning (§67), and at
    the start the unsigned place ends and the waiting list closes, as for every race (§160).
  */
  it("a deadline of zero holds the place until the start, says so, and releases nothing before it (§NNN)", async () => {
    await approve(db);
    const event = await createEvent(db, { confirmationDeadlineDaysBefore: 0 }); // capacity 1
    expect(confirmationWindow(event)).toEqual({ opensAt: new Date(START.getTime() - 7 * DAY), deadline: START });

    const first = await verified(event, "first@example.ro");
    expect(first.status).toBe("PENDING_DECLARATION");
    expect(first.holdExpiresAt).toEqual(START);
    const second = await verified(event, "second@example.ro");
    expect(second.status).toBe("WAITLISTED");

    const [queued] = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, first.id)).then((rows) => rows.filter((r) => r.messageType === "COMPLETE_DECLARATION"));
    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toBe(
      "Ești înscris — confirmă participarea până la start, duminică, 11 oct. 2026, 09:00 / You are registered — confirm your participation by the start, Sunday, 11 Oct 2026, 09:00",
    );
    expect(message.text).toContain("locul îți este ținut până la start, duminică, 11 oct. 2026, 09:00");
    expect(message.text).toContain("the place is held for you until the start, Sunday, 11 Oct 2026, 09:00");

    // The window opens: the reminder goes, as with any deadline.
    expect((await runRegistrationMaintenance(db, new Date(START.getTime() - 7 * DAY + 60_000))).confirmationsQueued).toBe(1);

    // Two days before, and a minute before the start: somebody waits, and still nothing lapses.
    for (const at of [new Date(START.getTime() - 2 * DAY + 60_000), new Date(START.getTime() - 60_000)]) {
      await runRegistrationMaintenance(db, at);
      const [held] = await db.select().from(registrations).where(eq(registrations.id, first.id));
      expect(held.status).toBe("PENDING_DECLARATION");
      const [waiting] = await db.select().from(registrations).where(eq(registrations.id, second.id));
      expect(waiting.status).toBe("WAITLISTED");
    }

    // A signature on the race morning confirms, like any other.
    const raceMorning = new Date(START.getTime() - 30 * 60_000);
    const confirmed = await signDeclaration(db, event, first.id, await signingInput(db, raceMorning, "Ana Popescu"), raceMorning);
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("at the start of a zero-deadline race the unsigned place ends and the waiting list closes, as for every race (§NNN, §160)", async () => {
    await approve(db);
    const event = await createEvent(db, { confirmationDeadlineDaysBefore: 0 }); // capacity 1
    const first = await verified(event, "first@example.ro");
    const second = await verified(event, "second@example.ro");

    // The first run after the start: nobody is offered a place in a race that has begun, and no
    // hold outlives it — the desk's paper is the race morning's, before the start.
    await runRegistrationMaintenance(db, new Date(START.getTime() + 60_000));
    const [lapsed] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(lapsed.status).toBe("EXPIRED");
    expect(lapsed.expiryReason).toBe("DECLARATION_HOLD_LAPSED");
    const [closed] = await db.select().from(registrations).where(eq(registrations.id, second.id));
    expect(closed.status).toBe("EXPIRED");
    expect(closed.expiryReason).toBe("EVENT_STARTED");
  });

  it("refuses a declaration signed against a cancelled race", async () => {
    await approve(db);
    const event = await createEvent(db);
    const held = await verified(event, "ana@example.ro");
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));

    const later = new Date(NOW.getTime() + DAY);
    await expect(signDeclaration(db, event, held.id, await signingInput(db, later, "Ana Popescu"), later)).rejects.toThrow(/CANCELLED/);
    const [unchanged] = await db.select().from(registrations).where(eq(registrations.id, held.id));
    expect(unchanged.status).toBe("PENDING_DECLARATION");
    expect(unchanged.bibNumber).toBeNull();
  });
});
