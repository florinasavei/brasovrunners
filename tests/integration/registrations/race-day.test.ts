import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  countDesk,
  findRegistrationByCheckinCode,
  listDeskRegistrations,
} from "@/modules/registrations/admin-repository";
import {
  cancelRegistrationByStaff,
  checkInByStaff,
  confirmRegistrationByStaff,
  createRegistrationByStaff,
  promoteRegistrationByStaff,
  setBibNumberByStaff,
} from "@/modules/registrations/admin-service";
import { isCheckinCode } from "@/modules/registrations/checkin-code";
import { checkIn, type EventForRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-07 — the desk confirms: address vouched for, declaration on paper, through the
 * allocator. BR-REQ-037-08 — check-in, the desk code, and who may work the desk.
 * BR-REQ-038-01 criterion 7 — one number by hand.
 *
 * The property that carries the weight is the second test: a fast-tracked walk-in at a full
 * event lands on the waiting list exactly as an online registration would, and no button on
 * the desk can put them past capacity. Everything else is about what the desk records — who
 * vouched, who attested, who checked in — so the audit trail says it.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let volunteer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

async function approveDocuments(keys: ReadonlyArray<"PRIVACY_NOTICE" | "EVENT_DECLARATION">) {
  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of keys) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
  }
}

beforeEach(async () => {
  await resetTables(db);
  await approveDocuments(["PRIVACY_NOTICE", "EVENT_DECLARATION"]);

  [admin] = await db
    .insert(staffUsers)
    .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
  // The lowest role there is: what a volunteer handing out numbers gets (`DECISIONS.md` §67).
  [volunteer] = await db
    .insert(staffUsers)
    .values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" })
    .returning();
});

async function createInternalEvent(
  capacity: number | null,
  options: { closed?: boolean } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      // `closed`: the public window is over, as it is on race morning. The desk does not care.
      registrationClosesAt: options.closed ? new Date("2026-09-01T00:00:00.000Z") : null,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

async function enter(
  event: EventForRegistration,
  email: string,
  options: { fastTrack?: boolean; actor?: StaffUser; at?: Date } = {},
) {
  await createRegistrationByStaff(
    db,
    options.actor ?? volunteer,
    {
      eventId: event.id,
      firstName: "Desk",
      lastName: email,
      email,
      locale: "ro",
      listOptOut: false,
      relayedByParticipantRequest: true,
      fastTrack: options.fastTrack,
    },
    options.at ?? NOW,
  );
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.participantId, participant.id));
  return { participant, registration };
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

describe("BR-REQ-037-07 the desk confirms a registration", () => {
  it("fast-tracks a walk-in to CONFIRMED on a paper declaration, under the volunteer's id", async () => {
    const event = await createInternalEvent(10);
    const { participant, registration } = await enter(event, "walkin@example.org", { fastTrack: true });

    expect(registration.status).toBe("CONFIRMED");
    expect(registration.source).toBe("STAFF");
    // The address was vouched for by a person, not clicked: the row says who, and the
    // participant's own verification is deliberately left unset (criterion 2).
    expect(registration.emailConfirmedAt).toEqual(NOW);
    expect(registration.emailConfirmedByStaffUserId).toBe(volunteer.id);
    expect(participant.emailVerifiedAt).toBeNull();
    // A desk code, minted at confirmation (BR-REQ-037-08).
    expect(registration.checkinCode).not.toBeNull();
    expect(isCheckinCode(registration.checkinCode as string)).toBe(true);

    const [acceptance] = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, registration.id));
    expect(acceptance.method).toBe("PAPER");
    expect(acceptance.attestedByStaffUserId).toBe(volunteer.id);
    expect(acceptance.typedName).toBe(registration.registeredName);
    expect(acceptance.declarationVersion).toBe(1);

    // The confirmation email still goes out — it carries the QR.
    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration.id));
    expect(queued.map((row) => row.messageType)).toContain("REGISTRATION_CONFIRMED");
    expect(queued.map((row) => row.messageType)).not.toContain("VERIFY_REGISTRATION_EMAIL");

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.entityId, registration.id));
    expect(trail.map((row) => row.action)).toEqual([
      "registration.created_by_staff",
      "registration.confirmed_by_staff",
    ]);
    expect(trail.every((row) => row.actorStaffUserId === volunteer.id)).toBe(true);
  });

  it("puts a fast-tracked walk-in on the waiting list when the event is full, and refuses to promote past capacity", async () => {
    const event = await createInternalEvent(1);
    const first = await enter(event, "first@example.org", { fastTrack: true });
    expect(first.registration.status).toBe("CONFIRMED");

    const second = await enter(event, "second@example.org", { fastTrack: true, at: new Date(NOW.getTime() + 60_000) });
    expect(second.registration.status).toBe("WAITLISTED");
    // No paper acceptance was recorded for somebody who has no place yet.
    const acceptances = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, second.registration.id));
    expect(acceptances).toHaveLength(0);

    // The allocator's own count, under the same lock: full is full, whoever asks.
    expect(await codeOf(promoteRegistrationByStaff(db, admin, second.registration.id, NOW))).toBe(
      "VALIDATION_ERROR",
    );

    // A place frees up, and the promotion goes through — on paper, attested.
    await cancelRegistrationByStaff(db, admin, first.registration.id, "did not come", new Date(NOW.getTime() + 120_000));
    // Cancelling offered the place to the queue's head automatically; the desk's promote must
    // then find it WAITLIST_OFFERED or CONFIRMED rather than WAITLISTED — either way, the
    // paper confirmation from the desk finishes it.
    const promoted = await confirmRegistrationByStaff(db, volunteer, second.registration.id, new Date(NOW.getTime() + 180_000));
    expect(promoted.status).toBe("CONFIRMED");
    const [acceptance] = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, second.registration.id));
    expect(acceptance.method).toBe("PAPER");
    expect(acceptance.attestedByStaffUserId).toBe(volunteer.id);
  });

  it("confirms a pending online registration whose email never arrived", async () => {
    const event = await createInternalEvent(10);
    const { registration } = await enter(event, "pending@example.org");
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");

    const confirmed = await confirmRegistrationByStaff(db, volunteer, registration.id, NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.emailConfirmedByStaffUserId).toBe(volunteer.id);
    // Idempotent: pressing twice is one confirmation.
    const again = await confirmRegistrationByStaff(db, volunteer, registration.id, NOW);
    expect(again.checkinCode).toBe(confirmed.checkinCode);
  });

  it("refuses without an approved declaration, exactly as the email path does", async () => {
    await resetTables(db);
    await approveDocuments(["PRIVACY_NOTICE"]);
    [volunteer] = await db
      .insert(staffUsers)
      .values({ email: "v2@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" })
      .returning();
    const event = await createInternalEvent(10);

    expect(await codeOf(enter(event, "nodecl@example.org", { fastTrack: true }))).toBe("VALIDATION_ERROR");
  });

  it("enters a walk-in after the public window closed, but never at a cancelled event", async () => {
    const event = await createInternalEvent(10, { closed: true });
    // Without the fast track the public rule applies; with it, the desk decides.
    expect(await codeOf(enter(event, "late@example.org"))).toBe("VALIDATION_ERROR");
    const { registration } = await enter(event, "late@example.org", { fastTrack: true });
    expect(registration.status).toBe("CONFIRMED");

    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    expect(
      await codeOf(enter({ ...event, eventStatus: "CANCELLED" }, "cancelled@example.org", { fastTrack: true })),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("BR-REQ-037-08 check-in and the desk", () => {
  it("checks a confirmed runner in, once, by a volunteer or by themselves, and undoes it", async () => {
    const event = await createInternalEvent(10);
    const { registration } = await enter(event, "runner@example.org", { fastTrack: true });

    const here = await checkInByStaff(db, volunteer, registration.id, "in", NOW);
    expect(here.checkedInAt).toEqual(NOW);
    expect(here.checkedInByStaffUserId).toBe(volunteer.id);
    // A second press changes nothing, not even the time.
    const again = await checkInByStaff(db, volunteer, registration.id, "in", new Date(NOW.getTime() + 60_000));
    expect(again.checkedInAt).toEqual(NOW);

    const undone = await checkInByStaff(db, volunteer, registration.id, "undo", NOW);
    expect(undone.checkedInAt).toBeNull();

    // From the participant's own link: nobody's id.
    const self = await checkIn(db, registration.id, null, NOW);
    expect(self.checkedInAt).toEqual(NOW);
    expect(self.checkedInByStaffUserId).toBeNull();

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.entityId, registration.id));
    expect(trail.map((row) => row.action)).toContain("registration.checked_in");
    expect(trail.map((row) => row.action)).toContain("registration.checkin_undone");
  });

  it("refuses to check in anybody who is not confirmed", async () => {
    const event = await createInternalEvent(10);
    const { registration } = await enter(event, "pending@example.org");
    expect(await codeOf(checkInByStaff(db, volunteer, registration.id, "in", NOW))).toBe("CONFLICT");
  });

  it("finds a runner by code, by a fragment of the name, or by number, and counts the desk", async () => {
    const event = await createInternalEvent(10);
    const a = await enter(event, "ana@example.org", { fastTrack: true });
    await enter(event, "pending@example.org", { at: new Date(NOW.getTime() + 60_000) });
    await setBibNumberByStaff(db, volunteer, a.registration.id, 17, NOW);
    await checkInByStaff(db, volunteer, a.registration.id, "in", NOW);

    const byCode = await findRegistrationByCheckinCode(db, a.registration.checkinCode as string, "ro");
    expect(byCode?.id).toBe(a.registration.id);
    expect(byCode?.bibNumber).toBe(17);
    expect(byCode?.checkedInByName).toBe("Volunteer");

    const byName = await listDeskRegistrations(db, { eventId: event.id, query: "ana@", locale: "ro" });
    expect(byName.map((row) => row.id)).toEqual([a.registration.id]);
    const byNumber = await listDeskRegistrations(db, { eventId: event.id, query: "17", locale: "ro" });
    expect(byNumber.map((row) => row.id)).toEqual([a.registration.id]);
    // Everybody, pending included — a pending row is what "no email arrived" looks like.
    const everybody = await listDeskRegistrations(db, { eventId: event.id, query: "", locale: "ro" });
    expect(everybody).toHaveLength(2);

    expect(await countDesk(db, event.id)).toEqual({ confirmed: 1, checkedIn: 1, withoutBib: 0, pending: 1 });
  });

  it("gives one number by hand, refuses a duplicate and a nonsense value, and clears it", async () => {
    const event = await createInternalEvent(10);
    const a = await enter(event, "a@example.org", { fastTrack: true });
    const b = await enter(event, "b@example.org", { fastTrack: true, at: new Date(NOW.getTime() + 60_000) });

    await setBibNumberByStaff(db, volunteer, a.registration.id, 5, NOW);
    expect(await codeOf(setBibNumberByStaff(db, volunteer, b.registration.id, 5, NOW))).toBe("CONFLICT");
    expect(await codeOf(setBibNumberByStaff(db, volunteer, b.registration.id, 0, NOW))).toBe("VALIDATION_ERROR");
    expect(await codeOf(setBibNumberByStaff(db, volunteer, b.registration.id, 1.5, NOW))).toBe("VALIDATION_ERROR");

    const cleared = await setBibNumberByStaff(db, volunteer, a.registration.id, null, NOW);
    expect(cleared.bibNumber).toBeNull();
    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "registration.bib_set"));
    expect(entry.metadataJson).toEqual({ from: null, to: 5 });
  });
});
