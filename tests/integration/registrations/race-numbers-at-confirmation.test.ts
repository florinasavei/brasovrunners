import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { confirmRegistrationByStaff, setBibNumberByStaff } from "@/modules/registrations/admin-service";
import { pickBibNumber, releaseLegacyHeldNumbers } from "@/modules/registrations/bibs";
import { buildRegistrationsCsv, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration, unregister } from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01, `DECISIONS.md` §548 (amending §173, §214, §420, §105) — a race number exists only
 * once a registration is confirmed: the address proved and the declaration signed.
 *
 * The owner, 2026-09-28: «faza cu numerele de concurs provizorii e ciudată». So nothing is drawn at
 * the form, with a declaration hold or with an offer; the confirmation draws the next number from
 * the event's own first number, under the event row's lock; a number is never released, so the
 * numbers follow the order of confirmation and are never reused; and nothing shows a number before
 * the confirmation — no screen, no export, no email. The one data step empties the old held-number
 * column once: a confirmed row keeps its number, every other row loses it.
 */
const NOW = new Date("2026-09-21T09:00:00.000Z");
const STARTS_AT = new Date("2026-10-24T07:00:00.000Z");
const CLOSES_AT = new Date("2026-10-23T07:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

async function approveDocuments(db: TestDatabase) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["d"] }] } },
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
}

function submissionInput(firstName: string, email: string, at: Date) {
  return {
    firstName,
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
    locale: "ro",
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

describe("BR-REQ-038-01 §548 a race number only once a registration is confirmed", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let volunteer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveDocuments(db);
    [volunteer] = await db
      .insert(staffUsers)
      .values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" })
      .returning();
  });

  async function createEvent(overrides: { bibStartNumber?: number; capacity?: number | null } = {}): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: STARTS_AT,
        registrationMode: "INTERNAL",
        capacity: overrides.capacity === undefined ? 50 : overrides.capacity,
        bibStartNumber: overrides.bibStartNumber ?? 1,
        registrationClosesAt: CLOSES_AT,
      })
      .returning();
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", title: "Cros", slug: `cros-${event.id.slice(0, 8)}` });
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

  async function submit(event: EventForRegistration, firstName: string, at: Date, kind: "REAL" | "TEST" = "REAL") {
    const email = `${firstName.toLowerCase()}@example.test`;
    await submitRegistration(db, event, submissionInput(firstName, email, at), at, kind);
    const [participant] = await db.select().from(participants).where(eq(participants.deliveryEmail, email));
    const [row] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, event.id), eq(registrations.participantId, participant.id)));
    return row;
  }

  /** The online way to a confirmation: the address from the email's link, then the declaration signed. */
  async function confirmOnline(event: EventForRegistration, id: string, firstName: string, at: Date) {
    await confirmEmail(db, event, id, at);
    await signDeclaration(db, event, id, await signingInput(db, at, `${firstName} Pop`), at);
    return reread(id);
  }

  async function reread(id: string) {
    const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
    return row;
  }

  it("draws nothing at the form, the address's confirmation or a declaration hold", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    expect([ana.status, ana.bibNumber, ana.provisionalBibNumber]).toEqual(["PENDING_EMAIL_CONFIRMATION", null, null]);

    await confirmEmail(db, event, ana.id, later(1));
    const held = await reread(ana.id);
    expect([held.status, held.bibNumber, held.provisionalBibNumber]).toEqual(["PENDING_DECLARATION", null, null]);
    expect(raceNumberOf(held)).toBeNull();
  });

  it("numbers in the order of confirmation, not of the forms, from the event's own first number", async () => {
    const event = await createEvent({ bibStartNumber: 100 });
    const ana = await submit(event, "Ana", NOW);
    const bogdan = await submit(event, "Bogdan", later(1));
    const cristi = await submit(event, "Cristi", later(2));

    // Sent Ana, Bogdan, Cristi; confirmed Cristi, Ana, Bogdan.
    expect((await confirmOnline(event, cristi.id, "Cristi", later(10))).bibNumber).toBe(100);
    expect((await confirmOnline(event, ana.id, "Ana", later(20))).bibNumber).toBe(101);
    expect((await confirmOnline(event, bogdan.id, "Bogdan", later(30))).bibNumber).toBe(102);
  });

  it("keeps a cancelled confirmed runner's number retired: the next confirmation takes the next one", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    const bogdan = await submit(event, "Bogdan", later(1));
    expect((await confirmOnline(event, ana.id, "Ana", later(5))).bibNumber).toBe(1);

    await unregister(db, event, ana.id, "PARTICIPANT", later(10));
    const cancelled = await reread(ana.id);
    expect([cancelled.status, cancelled.bibNumber]).toEqual(["CANCELLED", 1]);
    // Retired, and still shown as the number that runner had (§311).
    expect(raceNumberOf(cancelled)).toBe(1);

    expect((await confirmOnline(event, bogdan.id, "Bogdan", later(15))).bibNumber).toBe(2);
    expect(await pickBibNumber(db, event.id)).toBe(3);
  });

  it("gives a test registration no number at its confirmation (AGENTS.md §12.6)", async () => {
    const event = await createEvent();
    const test = await submit(event, "Test", NOW, "TEST");
    const confirmed = await confirmOnline(event, test.id, "Test", later(5));
    expect([confirmed.status, confirmed.bibNumber]).toEqual(["CONFIRMED", null]);
  });

  it("numbers a paper confirmation at the desk as it is pressed, in the same order", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    const bogdan = await submit(event, "Bogdan", later(1));
    expect((await confirmOnline(event, bogdan.id, "Bogdan", later(5))).bibNumber).toBe(1);

    // Ana's email never arrived; she signs on paper at the desk.
    const onPaper = await confirmRegistrationByStaff(db, volunteer, ana.id, later(10));
    expect([onPaper.status, onPaper.bibNumber]).toEqual(["CONFIRMED", 2]);
  });

  it("lets only an Administrator replace a confirmed number; any desk role fills a gap; nobody clears one", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    const bogdan = await submit(event, "Bogdan", later(1));
    expect((await confirmOnline(event, ana.id, "Ana", later(5))).bibNumber).toBe(1);
    const [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
    const codeOf = (attempt: Promise<unknown>) => attempt.then(() => "OK", (error: { code?: string }) => error.code);

    // Ana was emailed 1: a volunteer may not retire it, and nothing is written.
    expect(await codeOf(setBibNumberByStaff(db, volunteer, ana.id, 9, later(6)))).toBe("FORBIDDEN");
    expect((await reread(ana.id)).bibNumber).toBe(1);
    // Nor clear it, whoever asks.
    expect(await codeOf(setBibNumberByStaff(db, admin, ana.id, null, later(6)))).toBe("VALIDATION_ERROR");
    expect((await reread(ana.id)).bibNumber).toBe(1);
    // The Administrator replaces it; 1 is retired.
    expect((await setBibNumberByStaff(db, admin, ana.id, 9, later(7))).bibNumber).toBe(9);

    // A confirmed row with no number (confirmed before §87): the volunteer fills the gap.
    await confirmOnline(event, bogdan.id, "Bogdan", later(8));
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, bogdan.id));
    expect((await setBibNumberByStaff(db, volunteer, bogdan.id, 12, later(9))).bibNumber).toBe(12);
  });

  it("shows an empty export cell before the confirmation and the number after it", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    const bibCell = async () => {
      const [row] = await listRegistrationsForAdmin(db, { eventId: event.id });
      const csv = buildRegistrationsCsv([
        {
          eventTitle: "Cros",
          registeredName: row.registeredName,
          firstName: "",
          lastName: "",
          idDocument: "",
          email: "ana@example.test",
          status: row.status,
          clubMemberDeclared: false,
          memberVerified: false,
          fitnessDeclaredAt: null,
          stravaUrl: "",
          instagramHandle: "",
          guardianName: "",
          guardianIdDocument: "",
          submittedAt: "",
          confirmedAt: "",
          bibNumber: row.bibNumber,
          checkedInAt: "",
          emailBounced: false,
        } satisfies RegistrationCsvRow,
      ]);
      const [header, line] = csv.split("\r\n");
      return line.split(",")[header.split(",").indexOf("Race number (BIB)")];
    };
    expect(await bibCell()).toBe("");
    await confirmOnline(event, ana.id, "Ana", later(5));
    expect(await bibCell()).toBe("1");
  });

  it("sends the number with the confirmation and never in the emails before it", async () => {
    const event = await createEvent({ bibStartNumber: 700 });
    const ana = await submit(event, "Ana", NOW);
    await confirmOnline(event, ana.id, "Ana", later(5));

    const rendered = async (type: EmailMessageType) => {
      const [row] = await db
        .select()
        .from(emailOutbox)
        .where(and(eq(emailOutbox.registrationId, ana.id), eq(emailOutbox.messageType, type)));
      expect(row, type).toBeDefined();
      return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: later(6) }, db, later(6));
    };
    for (const type of ["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION"] as const) {
      const message = await rendered(type);
      expect(message.text, type).not.toContain("700");
      expect(message.text, type).not.toMatch(/num[ăa]r(ul)? (tău )?de concurs/i);
    }
    const confirmation = await rendered("REGISTRATION_CONFIRMED");
    expect(confirmation.text).toContain("Numărul tău de concurs: **700**".replace(/\*\*/g, ""));
    expect(confirmation.text).not.toContain("provizoriu");
  });

  /**
   * Every message a registration can be sent, rendered for a registration that is not confirmed
   * but wears a number anyway — a cancelled confirmed runner who restarted, or a number settled
   * before §548: none of them prints it. The number is a fact of a confirmed registration only.
   */
  it("prints no number in any message of a registration not confirmed, whatever the row holds", async () => {
    const event = await createEvent();
    const ana = await submit(event, "Ana", NOW);
    await confirmEmail(db, event, ana.id, later(1));
    await db.update(registrations).set({ bibNumber: 777 }).where(eq(registrations.id, ana.id));

    const types: EmailMessageType[] = [
      "VERIFY_REGISTRATION_EMAIL",
      "COMPLETE_DECLARATION",
      "WAITLIST_JOINED",
      "WAITLIST_SPOT_OFFER",
      "REGISTRATION_CONFIRMED",
      "REGISTRATION_CANCELLED",
      "WAITLIST_OFFER_EXPIRED",
      "REGISTRATION_MANAGE_LINK",
      "REGISTRATION_STATE_NOTICE",
      "EVENT_REMINDER",
      "BIB_ASSIGNED",
      "CLUB_CONFIRMATION_NOTICE",
      "EVENT_UPDATE_NOTICE",
      "EVENT_CANCELLED",
      "ORGANIZER_MESSAGE",
    ];
    for (const [index, messageType] of types.entries()) {
      const message = await renderOutboxMessage(
        {
          id: `row-${index}`,
          participantId: ana.participantId,
          registrationId: ana.id,
          messageType,
          locale: "ro",
          recipientEmail: "ana@example.test",
          payloadJson: messageType === "BIB_ASSIGNED" ? { bibNumber: 777 } : {},
          idempotencyKey: `render:${messageType}`,
          requestedByStaffUserId: null,
          isManualResend: false,
          status: "PROCESSING",
          attemptCount: 1,
          nextAttemptAt: null,
          lockedAt: later(2),
          providerMessageId: null,
          transport: null,
          recipientCount: null,
          lastError: null,
          createdAt: later(2),
          sentAt: null,
        },
        db,
        later(2),
      );
      expect(`${message.subject}\n${message.text}\n${message.html}`, messageType).not.toContain("777");
    }
  });

  describe("the one data step: the old held-number column, emptied once", () => {
    async function plant(event: EventForRegistration, name: string, status: "CONFIRMED" | "PENDING_DECLARATION" | "PENDING_EMAIL_CONFIRMATION" | "CANCELLED", held: number) {
      const email = `${name.toLowerCase()}@example.test`;
      const [participant] = await db
        .insert(participants)
        .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name })
        .returning();
      const [row] = await db
        .insert(registrations)
        .values({
          eventId: event.id,
          participantId: participant.id,
          status,
          locale: "ro",
          registeredName: name,
          displayName: name,
          provisionalBibNumber: held,
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
          ...(status === "PENDING_DECLARATION" ? { holdExpiresAt: later(24 * 60) } : {}),
          ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "PARTICIPANT" as const } : {}),
        })
        .returning();
      return row;
    }

    it("keeps a confirmed runner's number, clears everybody else's, tells the runner once, and changes nothing the second time", async () => {
      const event = await createEvent();
      const kept = await plant(event, "Ana", "CONFIRMED", 1);
      const signing = await plant(event, "Bogdan", "PENDING_DECLARATION", 2);
      const unproved = await plant(event, "Cristi", "PENDING_EMAIL_CONFIRMATION", 3);
      const gone = await plant(event, "Dan", "CANCELLED", 4);

      // Before the step, every draw still treats the old numbers as taken.
      expect(await pickBibNumber(db, event.id)).toBe(5);
      // And nothing shows them: none is a race number yet.
      expect([kept, signing, unproved, gone].map((row) => raceNumberOf(row))).toEqual([null, null, null, null]);

      const run = await runRegistrationMaintenance(db, later(1));
      expect(run.legacyNumbersKept).toBe(1);

      const after = await Promise.all([kept, signing, unproved, gone].map((row) => reread(row.id)));
      expect(after.map((row) => [row.bibNumber, row.provisionalBibNumber])).toEqual([
        [1, null],
        [null, null],
        [null, null],
        [null, null],
      ]);
      expect(raceNumberOf(after[0])).toBe(1);
      const told = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "BIB_ASSIGNED"));
      expect(told.map((row) => [row.registrationId, row.payloadJson])).toEqual([[kept.id, { bibNumber: 1 }]]);

      // Re-given at their own confirmation, in order: 2 is free again.
      expect(await pickBibNumber(db, event.id)).toBe(2);

      // Idempotent: a second run finds nothing and sends nothing.
      expect(await releaseLegacyHeldNumbers(db, later(2))).toEqual({ kept: [], cleared: 0 });
      const second = await runRegistrationMaintenance(db, later(3));
      expect(second.legacyNumbersKept).toBe(0);
      expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "BIB_ASSIGNED"))).toHaveLength(1);
    });

    it("never keeps a number another row already wears, and tells nobody about a race already run", async () => {
      const event = await createEvent();
      const worn = await plant(event, "Ana", "CONFIRMED", 9);
      await db.update(registrations).set({ bibNumber: 3, provisionalBibNumber: null }).where(eq(registrations.id, worn.id));
      const clash = await plant(event, "Bogdan", "CONFIRMED", 3);
      const past = await createEvent();
      await db.update(events).set({ startsAt: new Date("2026-09-01T07:00:00.000Z") }).where(eq(events.id, past.id));
      const ran = await plant(past, "Cristi", "CONFIRMED", 1);

      const result = await releaseLegacyHeldNumbers(db, later(1));
      expect(result.kept.map((row) => [row.registrationId, row.bibNumber, row.raceAhead])).toEqual([[ran.id, 1, false]]);
      expect(result.cleared).toBe(1);
      // The clash is left without a number, for «Alocă numerele»; it never wears somebody else's 3.
      expect((await reread(clash.id)).bibNumber).toBeNull();
    });
  });
});
