import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, createEventAndPublish } from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-01 — an event created already cancelled, or already over (`DECISIONS.md` §448).
 *
 * The owner, 2026-09-26: "ar trebui să pot crea un eveniment deja anulat din start" — an event
 * called off before the club recorded it (copied from Facebook for the record, say). The create
 * page's status card is the editor's select now; what these tests hold down is the service's half:
 * "Anulat" asks why in both languages exactly as cancelling in the editor does (§331, §354), writes
 * the same audit row, and queues no email — nobody can be registered for an event that did not
 * exist; "Încheiat" only once the start has passed; and the create-and-publish press still works.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-11T08:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
  translations: {
    ro: { slug: "crosul-toamnei", title: "Crosul toamnei", excerpt: "Zece kilometri prin parc." },
    en: { slug: "autumn-cross", title: "Autumn cross", excerpt: "Ten kilometres round the park." },
  },
};

const REASON = { ro: "Organizatorul a anulat cursa.", en: "The organizer called the race off." };

describe("BR-REQ-050-01 an event created cancelled or completed (§448)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" }).returning();
  });

  const refusalOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => (isDomainError(error) ? { code: error.code, fields: error.fields } : Promise.reject(error)),
    );

  it("creates and publishes it cancelled, records who and why, and queues no email", async () => {
    const result = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...FIELDS, eventStatus: "CANCELLED" },
      // Even a "tell them" posted by hand tells nobody: there is nobody.
      cancellation: { reason: REASON, notify: true },
      publish: true,
      now: NOW,
    });

    expect(result).toMatchObject({ published: true, refusal: null });
    const [row] = await db.select().from(events).where(eq(events.id, result.event.id));
    expect(row.eventStatus).toBe("CANCELLED");
    expect(row.editorialStatus).toBe("PUBLISHED");

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: row.id });
    expect(audit[0].metadataJson).toMatchObject({ reason: REASON, notified: false, recipients: 0, createdCancelled: true });

    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("refuses a cancelled create without the reason in both languages, naming each empty box, and writes nothing", async () => {
    expect(await refusalOf(createEvent(db, { actor: admin, fields: { ...FIELDS, eventStatus: "CANCELLED" }, now: NOW }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["cancel.reasonRo", "cancel.reasonEn"],
    });
    expect(
      await refusalOf(
        createEventAndPublish(db, {
          actor: admin,
          fields: { ...FIELDS, eventStatus: "CANCELLED" },
          cancellation: { reason: { ro: REASON.ro, en: "  " }, notify: false },
          publish: true,
          now: NOW,
        }),
      ),
    ).toEqual({ code: "VALIDATION_ERROR", fields: ["cancel.reasonEn"] });
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("ignores a reason posted with any other status: a scheduled create records no cancellation", async () => {
    const created = await createEvent(db, { actor: admin, fields: FIELDS, cancellation: { reason: REASON, notify: true }, now: NOW });
    expect(created.eventStatus).toBe("SCHEDULED");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"))).toHaveLength(0);
  });

  it("creates an event completed only once its start has passed, and refuses it on the status select before", async () => {
    expect(await refusalOf(createEvent(db, { actor: admin, fields: { ...FIELDS, eventStatus: "COMPLETED" }, now: NOW }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["eventStatus"],
    });
    expect(await db.select().from(events)).toHaveLength(0);

    const past = { ...FIELDS, eventStatus: "COMPLETED", startsAtWallTime: "2026-09-20T08:00" };
    const created = await createEvent(db, { actor: admin, fields: past, now: NOW });
    expect(created.eventStatus).toBe("COMPLETED");
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});
