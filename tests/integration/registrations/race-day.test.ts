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
import { suggestFreeBibNumbers } from "@/modules/registrations/bibs";
import { findRegistrationById } from "@/modules/registrations/repository";
import { isCheckinCode } from "@/modules/registrations/checkin-code";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { checkIn, confirmEmail, type EventForRegistration } from "@/modules/registrations/service";
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
  options: { closed?: boolean; bibStartNumber?: number } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      // The race's own band of numbers (§173); 1 unless the test is about a band.
      bibStartNumber: options.bibStartNumber ?? 1,
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

  it("confirms on paper at the desk after the gun, when the start itself released the hold (§160)", async () => {
    const event = await createInternalEvent(10);
    const { registration } = await enter(event, "forgot@example.org");
    const held = await confirmEmail(db, event, registration.id, NOW);
    expect(held.status).toBe("PENDING_DECLARATION");

    // The race starts. The job sweeps the hold — the one case §160 does not keep — while the
    // kit table is still open and the person is standing at it with their paper.
    const afterStart = new Date(event.startsAt.getTime() + 5 * 60_000);
    await runRegistrationMaintenance(db, afterStart);
    const [swept] = await db.select().from(registrations).where(eq(registrations.id, registration.id));
    expect(swept.status).toBe("EXPIRED");
    expect(swept.expiryReason).toBe("DECLARATION_HOLD_LAPSED");

    const confirmed = await confirmRegistrationByStaff(db, volunteer, registration.id, afterStart);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).not.toBeNull();
    const [acceptance] = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, registration.id));
    expect(acceptance.method).toBe("PAPER");
  });

  it("keeps a number given by hand when the hold behind it expires, and never offers it again", async () => {
    const event = await createInternalEvent(10);
    const { registration } = await enter(event, "numbered@example.org");
    await confirmEmail(db, event, registration.id, NOW);
    await setBibNumberByStaff(db, volunteer, registration.id, 7, NOW);

    const afterStart = new Date(event.startsAt.getTime() + 5 * 60_000);
    await runRegistrationMaintenance(db, afterStart);

    const [expired] = await db.select().from(registrations).where(eq(registrations.id, registration.id));
    expect(expired.status).toBe("EXPIRED");
    // Expiry touches the status and nothing else: a number that was printed is not handed to
    // somebody else because the person who had it never signed.
    expect(expired.bibNumber).toBe(7);
    expect(await suggestFreeBibNumbers(db, event.id, 5, 4)).toEqual([5, 6, 8, 9]);
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
    // Confirmed at the desk, so numbered on the spot (§87) — the event's first number (§173).
    expect(a.registration.bibNumber).toBe(1);
    await checkInByStaff(db, volunteer, a.registration.id, "in", NOW);

    const byCode = await findRegistrationByCheckinCode(db, a.registration.checkinCode as string, "ro");
    expect(byCode?.id).toBe(a.registration.id);
    expect(byCode?.bibNumber).toBe(1);
    expect(byCode?.checkedInByName).toBe("Volunteer");

    const byName = await listDeskRegistrations(db, { eventId: event.id, query: "ana@", locale: "ro" });
    expect(byName.map((row) => row.id)).toEqual([a.registration.id]);
    const byNumber = await listDeskRegistrations(db, { eventId: event.id, query: "1", locale: "ro" });
    expect(byNumber.map((row) => row.id)).toEqual([a.registration.id]);
    // Everybody, pending included — a pending row is what "no email arrived" looks like.
    const everybody = await listDeskRegistrations(db, { eventId: event.id, query: "", locale: "ro" });
    expect(everybody).toHaveLength(2);

    expect(await countDesk(db, event.id)).toEqual({ confirmed: 1, checkedIn: 1, withoutBib: 0, pending: 1 });
  });

  /**
   * §173 — numbers run in order from the event's own start, and a confirmed runner's number is
   * settled. §94's random draw is gone: sequential is how every race does it, it is a list a
   * volunteer can check off, and the band a number falls in says which start line it belongs on.
   */
  it("numbers in order of confirmation, from the event's own first number", async () => {
    const event = await createInternalEvent(10);
    const a = await enter(event, "a@example.org", { fastTrack: true });
    const b = await enter(event, "b@example.org", { fastTrack: true, at: new Date(NOW.getTime() + 60_000) });
    expect(a.registration.bibNumber).toBe(1);
    expect(b.registration.bibNumber).toBe(2);

    const hundreds = await createInternalEvent(10, { bibStartNumber: 100 });
    const c = await enter(hundreds, "c@example.org", { fastTrack: true });
    const d = await enter(hundreds, "d@example.org", { fastTrack: true, at: new Date(NOW.getTime() + 60_000) });
    expect(c.registration.bibNumber).toBe(100);
    expect(d.registration.bibNumber).toBe(101);
  });

  it("refuses to change the number of a confirmed runner, whoever asks", async () => {
    const event = await createInternalEvent(10);
    const a = await enter(event, "a@example.org", { fastTrack: true });

    // The runner has been emailed this number and it may already be printed (§173).
    expect(await codeOf(setBibNumberByStaff(db, volunteer, a.registration.id, 9, NOW))).toBe("VALIDATION_ERROR");
    // Clearing it is a change too.
    expect(await codeOf(setBibNumberByStaff(db, volunteer, a.registration.id, null, NOW))).toBe("VALIDATION_ERROR");

    const unchanged = await findRegistrationById(db, a.registration.id);
    expect(unchanged?.bibNumber).toBe(1);
  });

  it("gives a number by hand before confirmation, refuses a duplicate and a nonsense value", async () => {
    const event = await createInternalEvent(10);
    const confirmed = await enter(event, "a@example.org", { fastTrack: true });
    const waiting = await enter(event, "b@example.org", { at: new Date(NOW.getTime() + 60_000) });
    const other = await enter(event, "c@example.org", { at: new Date(NOW.getTime() + 120_000) });

    // A preferential number, chosen among the free ones, before anything is printed (§105).
    const given = await setBibNumberByStaff(db, volunteer, waiting.registration.id, 7, NOW);
    expect(given.bibNumber).toBe(7);
    expect(await codeOf(setBibNumberByStaff(db, volunteer, other.registration.id, 7, NOW))).toBe("CONFLICT");
    expect(await codeOf(setBibNumberByStaff(db, volunteer, other.registration.id, 0, NOW))).toBe("VALIDATION_ERROR");
    expect(await codeOf(setBibNumberByStaff(db, volunteer, other.registration.id, 1.5, NOW))).toBe("VALIDATION_ERROR");

    // Not yet confirmed, so nothing is emailed: the number travels with the confirmation.
    const quiet = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, waiting.registration.id)))
      .filter((row) => row.messageType === "BIB_ASSIGNED");
    expect(quiet).toHaveLength(0);

    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bib_set"));
    expect(entry.metadataJson).toEqual({ from: null, to: 7 });
    // And the confirmed one is untouched by any of it.
    expect(confirmed.registration.bibNumber).toBe(1);
  });

  /**
   * The one case a confirmed registration may still be numbered by hand: it has no number at
   * all. A row confirmed before §87 drew one automatically is exactly that, and filling the gap
   * is not moving anybody (§173).
   */
  it("fills a confirmed registration that has no number, and tells the runner", async () => {
    const event = await createInternalEvent(10);
    const a = await enter(event, "a@example.org", { fastTrack: true });
    // A legacy row: confirmed, no number. Written directly, because no verb produces one now.
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, a.registration.id));

    const numbered = await setBibNumberByStaff(db, volunteer, a.registration.id, 5, NOW);
    expect(numbered.bibNumber).toBe(5);

    // The runner is told the number given by hand, once (§105).
    const told = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, a.registration.id))).filter(
      (row) => row.messageType === "BIB_ASSIGNED",
    );
    expect(told).toHaveLength(1);
    expect(told[0].payloadJson).toEqual({ bibNumber: 5 });
    const message = await renderOutboxMessage({ ...told[0], status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toMatch(/^Numărul tău de concurs: /);
    expect(message.html).toContain("#cancel"); // the manage link, localized, with the cancel section
  });

  it("suggests the first free numbers from the event's own band, skipping the ones worn (§105, §173)", async () => {
    const event = await createInternalEvent(10);
    // Confirmed on the spot, so it wears 1.
    await enter(event, "a@example.org", { fastTrack: true });
    expect(await suggestFreeBibNumbers(db, event.id, undefined, 4)).toEqual([2, 3, 4, 5]);
    expect(await suggestFreeBibNumbers(db, event.id, 40, 2)).toEqual([40, 41]);

    // A race whose numbers start at 500 suggests 500, not 1 (§173).
    const hundreds = await createInternalEvent(10, { bibStartNumber: 500 });
    expect(await suggestFreeBibNumbers(db, hundreds.id, undefined, 2)).toEqual([500, 501]);
  });
});
