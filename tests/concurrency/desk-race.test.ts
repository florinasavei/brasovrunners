import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createRegistrationByStaff } from "@/modules/registrations/admin-service";
import { ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * §420 × BR-REQ-037-05, BR-REQ-037-07 — a desk entry racing a public submission on one address,
 * on two real connections.
 *
 * The desk's duplicate check (`createRegistrationByStaff`) reads outside the event's lock, so a
 * public submission on the same address can land between that read and the staff entry's own
 * locked transaction. Before the audit the staff entry then found the address registered, "re-sent"
 * as a success, and the fast track confirmed the *other* runner — somebody not at the desk, who
 * signed nothing — on this person's paper. Under the lock it is now refused out loud.
 *
 * The integration suite shows the refusal by hiding the pre-check's read (PGlite has one
 * connection); this puts the two requests on two connections and orders them with the real lock.
 * A third connection holds the event row; the public submission queues on it first, then the staff
 * entry — whose pre-check therefore finds nothing — queues behind it. PostgreSQL grants a row's
 * waiters in the order they queued, so when the holder lets go the public submission writes first
 * and the staff entry meets that row under the lock: exactly the gap, every run.
 *
 * Since §493 the desk decides by the name (`decideSubmission`, via `staff`): the guard this suite
 * proves is the *same runner* entered at the desk while the form writes him — refused under the
 * lock, confirming nobody. Another person on that address is a family member (§389, §446), and the
 * race gives her a row of her own, confirmed on her own paper, the form's runner untouched — the
 * same two cases `tests/integration/registrations/lifecycle-audit.test.ts` shows on one connection.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§420 BR-REQ-037-05 BR-REQ-037-07 a desk entry racing a public submission, on two connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-25T10:00:00.000Z");
  const createdEventIds: string[] = [];
  let staffId: string | undefined;

  beforeAll(async () => {
    // The club's terms (§421) with them: a public submission is refused while none is approved.
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      const translations: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      // Already there on a database another suite prepared: the one in force is what counts.
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now: NOW,
      }).catch(() => undefined);
    }
    const [staff] = await db
      .insert(staffUsers)
      .values({ email: `desk.race.${Date.now()}@example.ro`, displayName: "Desk", role: "ADMIN" })
      .returning();
    staffId = staff.id;
  });

  afterAll(async () => {
    const rows =
      createdEventIds.length > 0
        ? await db
            .select({ id: registrations.id, participantId: registrations.participantId })
            .from(registrations)
            .where(inArray(registrations.eventId, createdEventIds))
        : [];
    const registrationIds = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participantId))];
    if (registrationIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, registrationIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, registrationIds));
      // A paper acceptance (a desk confirmation) references its registration with no cascade.
      await db.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, registrationIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (participantIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
      await db.delete(participants).where(inArray(participants.id, participantIds));
    }
    if (staffId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, staffId));
      await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
    }
    await pool.end();
  });

  async function createEvent(): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50 })
      .returning();
    createdEventIds.push(event.id);
    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      capacity: event.capacity,
      raceId: null,
      publishedAt: NOW,
    };
  }

  const submission = (email: string, firstName: string) => ({
    firstName,
    lastName: "Pop",
    birthDate: "1985-03-02",
    city: "Brașov",
    sex: "FEMALE",
    phone: "+40711111111",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "+40722222222",
    nationality: "RO",
    country: "RO",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: false,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
  });

  /**
   * Waits until `count` backends of this database are queued on a lock — the event row's, the
   * only one held while the requests run (the suite's files run one at a time). By the wait, never
   * by the query's text: `pg_stat_activity` keeps its first kilobyte, and the event row's
   * `SELECT … FOR UPDATE` names every column before it reaches the `FOR UPDATE`.
   */
  async function queuedOnEvent(count: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      if (Number((result.rows[0] as { n: number }).n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`expected ${count} requests queued on the event's lock`);
  }

  /**
   * Ion on the public form, queued first; `deskFirstName` at the desk with a paper, whose pre-check
   * finds the address empty, queued second. Both answers, settled.
   */
  async function race(event: EventForRegistration, email: string, deskFirstName: string) {
    // A third connection holds the event row, so both requests queue on it in a known order.
    const holder = await pool.connect();
    let publicAnswer: Promise<unknown> = Promise.resolve();
    let staffAnswer: Promise<unknown> = Promise.resolve();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);

      publicAnswer = submitRegistration(db, event, submission(email, "Ion"), NOW);
      await queuedOnEvent(1);
      staffAnswer = createRegistrationByStaff(
        db,
        { id: staffId as string, role: "ADMIN" },
        {
          eventId: event.id,
          firstName: deskFirstName,
          lastName: "Pop",
          email,
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: true,
          fastTrack: true,
        },
        NOW,
      );
      await queuedOnEvent(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }
    return Promise.allSettled([publicAnswer, staffAnswer]);
  }

  it("the same runner: the public submission writes first; the desk's entry is refused under the lock and confirms nobody", async () => {
    const event = await createEvent();
    const email = `desk.race.${Date.now()}@example.ro`;

    // Ion on the form, and Ion again at the desk (§493: the name decides there).
    const [publicResult, staffResult] = await race(event, email, "Ion");
    expect(publicResult.status).toBe("fulfilled");
    expect(staffResult.status).toBe("rejected");
    const reason = (staffResult as PromiseRejectedResult).reason;
    expect(isDomainError(reason) ? { code: reason.code, fields: [...reason.fields] } : reason).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["email", ALREADY_ON_ADDRESS],
    });

    // Ion is exactly as the public form left him: waiting for his own link, confirmed by nobody.
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows.map((row) => [row.registeredName, row.status])).toEqual([["Ion Pop", "PENDING_EMAIL_CONFIRMATION"]]);
    const written = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(inArray(auditLogs.entityId, rows.map((row) => row.id)));
    const actions = written.map((row) => row.action);
    expect(actions).not.toContain("registration.confirmed_by_staff");
    expect(actions).not.toContain("registration.resubmitted");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.actorStaffUserId, staffId as string))).toHaveLength(0);
  });

  it("another person: Maria at the desk gets a row of her own, confirmed on her own paper; Ion is untouched", async () => {
    const event = await createEvent();
    const email = `desk.race.maria.${Date.now()}@example.ro`;

    // §493: another name at the desk on a registered address is a family member, within the club's limit.
    const [publicResult, staffResult] = await race(event, email, "Maria");
    expect(publicResult.status).toBe("fulfilled");
    expect(staffResult.status).toBe("fulfilled");

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows.map((row) => [row.registeredName, row.status]).sort()).toEqual([
      ["Ion Pop", "PENDING_EMAIL_CONFIRMATION"],
      ["Maria Pop", "CONFIRMED"],
    ]);
    expect(new Set(rows.map((row) => row.participantId)).size).toBe(1);

    // The one paper acceptance is Maria's; nothing was confirmed or re-sent in Ion's name.
    const ion = rows.find((row) => row.registeredName === "Ion Pop");
    const maria = rows.find((row) => row.registeredName === "Maria Pop");
    const accepted = await db
      .select({ registrationId: declarationAcceptances.registrationId })
      .from(declarationAcceptances)
      .where(inArray(declarationAcceptances.registrationId, rows.map((row) => row.id)));
    expect(accepted).toEqual([{ registrationId: maria?.id }]);
    const ionActions = (
      await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, ion?.id as string))
    ).map((row) => row.action);
    expect(ionActions).not.toContain("registration.confirmed_by_staff");
    expect(ionActions).not.toContain("registration.resubmitted");
  });
});
