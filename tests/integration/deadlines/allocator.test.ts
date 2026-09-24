import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { updateDeadlines } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { expireStalePendingEmailConfirmations, insertPendingEmailRegistration } from "@/modules/registrations/repository";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration, unregister } from "@/modules/registrations/service";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findOrCreateParticipant } from "@/modules/participants/repository";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN × AGENTS.md §10.5–§10.6 — the allocator takes the club's deadlines, and never rewrites one
 * it already gave.
 *
 * What is protected: a hold, an offer and an email link created after a change get the new length;
 * one created before keeps the deadline it was given, however the setting moves afterwards; the
 * lock, the capacity formula and read-time expiry are untouched (the concurrency suite is the proof
 * of those, `tests/concurrency/capacity.test.ts`). And the email link's lapse is written on the row,
 * which also mends a restart: an unverified registration restarted days after its first
 * submission no longer lapses at the very next run of the job.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function approveLegalDocuments(db: TestDatabase) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
  ];
  for (const [key, translations] of [
    ["PRIVACY_NOTICE", privacy],
    ["EVENT_DECLARATION", declaration],
  ] as const) {
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

function submission(email: string, at: Date, firstName = "Ana") {
  return {
    firstName,
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "UNSPECIFIED",
    nationality: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

describe("§NNN the allocator and the club's deadlines", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: { id: string; role: "ADMIN" };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
    const [row] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    admin = { id: row.id, role: "ADMIN" };
  });

  async function setDeadlines(changes: Partial<Deadlines>, at = NOW) {
    await updateDeadlines(db, admin, { ...DEFAULT_DEADLINES, ...changes }, at);
  }

  async function event(capacity: number | null): Promise<EventForRegistration> {
    const [row] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity })
      .returning();
    return {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: row.startsAt,
      registrationOpensAt: row.registrationOpensAt,
      registrationClosesAt: row.registrationClosesAt,
      capacity,
      raceId: null,
      publishedAt: NOW,
    };
  }

  async function registrationOf(eventId: string, email: string) {
    const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(email).canonicalEmail));
    const [row] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participant.id)));
    return row;
  }

  async function reload(id: string) {
    const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
    return row;
  }

  /** Submitted and confirmed at `at`: a hold, a place on the waiting list or an offer. */
  async function enter(target: EventForRegistration, email: string, at: Date) {
    await submitRegistration(db, target, submission(email, at), at);
    const pending = await registrationOf(target.id, email);
    return confirmEmail(db, target, pending.id, at);
  }

  it("gives a declaration hold made after a change the new minutes, and leaves one made before it alone", async () => {
    const race = await event(10);
    const before = await enter(race, "ana@example.ro", NOW);
    expect(before.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE));

    await setDeadlines({ holdMinutes: 15 });
    const later = new Date(NOW.getTime() + 5 * MINUTE);
    const after = await enter(race, "ion@example.ro", later);
    expect(after.status).toBe("PENDING_DECLARATION");
    expect(after.holdExpiresAt).toEqual(new Date(later.getTime() + 15 * MINUTE));

    // The hold given before the change still ends where it was told it would.
    expect((await reload(before.id)).holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE));
  });

  it("gives a waiting-list offer made after a change the new hours, and leaves an offer already out alone", async () => {
    const race = await event(1);
    const first = await enter(race, "ana@example.ro", NOW);
    await signDeclaration(db, race, first.id, await signingInput(db, NOW, "Ana Pop"), NOW);
    // A minute apart, so the line's order is theirs and not a tie broken by id.
    const second = await enter(race, "ion@example.ro", new Date(NOW.getTime() + MINUTE));
    const third = await enter(race, "maria@example.ro", new Date(NOW.getTime() + 2 * MINUTE));
    expect([second.status, third.status]).toEqual(["WAITLISTED", "WAITLISTED"]);

    // Six hours for an offer, then the confirmed runner withdraws: the first in line is offered six.
    await setDeadlines({ offerHours: 6 });
    const freed = new Date(NOW.getTime() + HOUR);
    await unregister(db, race, first.id, "PARTICIPANT", freed);
    const offered = await reload(second.id);
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.holdExpiresAt).toEqual(new Date(freed.getTime() + 6 * HOUR));

    // Twelve now: the offer already out keeps its six; the next offer gets twelve.
    await setDeadlines({ offerHours: 12 });
    expect((await reload(second.id)).holdExpiresAt).toEqual(new Date(freed.getTime() + 6 * HOUR));
    const declined = new Date(NOW.getTime() + 2 * HOUR);
    await unregister(db, race, second.id, "PARTICIPANT", declined);
    const next = await reload(third.id);
    expect(next.status).toBe("WAITLIST_OFFERED");
    expect(next.holdExpiresAt).toEqual(new Date(declined.getTime() + 12 * HOUR));
  });

  it("writes the email link's lapse on the registration, and a later change of the hours never moves it", async () => {
    const race = await event(null);
    await setDeadlines({ confirmationHours: 12 });
    await submitRegistration(db, race, submission("ana@example.ro", NOW), NOW);
    const pending = await registrationOf(race.id, "ana@example.ro");
    expect(pending.emailLinkExpiresAt).toEqual(new Date(NOW.getTime() + 12 * HOUR));

    // The club lengthens the link to three days: the one already sent still lapses at twelve hours.
    await setDeadlines({ confirmationHours: 72 });
    expect(await expireStalePendingEmailConfirmations(db, new Date(NOW.getTime() + 11 * HOUR), { confirmationHours: 72 })).toBe(0);
    expect(await expireStalePendingEmailConfirmations(db, new Date(NOW.getTime() + 13 * HOUR), { confirmationHours: 72 })).toBe(1);
    const lapsed = await reload(pending.id);
    expect(lapsed.status).toBe("EXPIRED");
    expect(lapsed.expiryReason).toBe("EMAIL_CONFIRMATION_LAPSED");
  });

  it("lapses a row written before the column at its submission plus the hours in force, as every row did before", async () => {
    const race = await event(null);
    const identity = canonicalizeEmail("vechi@example.ro");
    const participant = await findOrCreateParticipant(db, identity, "Vechi Pop", "ro", NOW);
    const legacy = await insertPendingEmailRegistration(db, {
      eventId: race.id,
      participantId: participant.id,
      locale: "ro",
      registeredName: "Vechi Pop",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      raceId: null,
      resultsNameConsent: true,
      resultsConsentVersion: 1,
      listOptOut: false,
      now: NOW,
    });
    expect(legacy.emailLinkExpiresAt).toBeNull();
    expect(await expireStalePendingEmailConfirmations(db, new Date(NOW.getTime() + 47 * HOUR), DEFAULT_DEADLINES)).toBe(0);
    expect(await expireStalePendingEmailConfirmations(db, new Date(NOW.getTime() + 48 * HOUR), DEFAULT_DEADLINES)).toBe(1);
  });

  it("gives a restart its own lapse, so it no longer expires at the next run after its new email", async () => {
    const race = await event(null);
    await submitRegistration(db, race, submission("ana@example.ro", NOW), NOW);
    const first = await registrationOf(race.id, "ana@example.ro");
    // Never confirmed: it lapses with its link.
    expect(await expireStalePendingEmailConfirmations(db, new Date(NOW.getTime() + 49 * HOUR), DEFAULT_DEADLINES)).toBe(1);

    // Five days later the same person fills the form again: a restart, with a new link.
    const restartAt = new Date(NOW.getTime() + 5 * DAY);
    await submitRegistration(db, race, submission("ana@example.ro", restartAt), restartAt);
    const restarted = await reload(first.id);
    expect(restarted.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(restarted.submittedAt).toEqual(NOW);
    expect(restarted.emailLinkExpiresAt).toEqual(new Date(restartAt.getTime() + 48 * HOUR));

    // The job's next run, an hour on, leaves it alone — measured from the submission, it lapsed.
    expect(await expireStalePendingEmailConfirmations(db, new Date(restartAt.getTime() + HOUR), DEFAULT_DEADLINES)).toBe(0);
    expect((await reload(first.id)).status).toBe("PENDING_EMAIL_CONFIRMATION");
    const rows = await db.select().from(registrations).where(and(eq(registrations.eventId, race.id), eq(registrations.status, "EXPIRED")));
    expect(rows).toEqual([]);
  });
});
