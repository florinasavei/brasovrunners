import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, createEventAndPublish, publishEvent, transitionEvent } from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-051-01 — «Publică» from a draft's own editor, in one press (§423). «Creează și publică»
 * (§315) walks DRAFT → IN_REVIEW → PUBLISHED for a new event of any type, with or without a
 * series; `publishEvent` walks the same two moves for an event that already exists as a draft —
 * one saved with the plain create, a copy, a date a series made. The same guard, the same
 * version check, the same role; a refusal leaves the draft a draft.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");

const EVENT_FIELDS = {
  type: "GROUP_RUN",
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
};

const complete = (slug: string, fields: Record<string, unknown> = {}) => ({
  ...EVENT_FIELDS,
  ...fields,
  translations: {
    ro: { slug: `${slug}-ro`, title: "Alergare de duminică", excerpt: "Zece kilometri prin parc." },
    en: { slug: `${slug}-en`, title: "Sunday run", excerpt: "Ten kilometres round the park." },
  },
});

describe("BR-REQ-051-01 «Publică» from a draft in one press (§423)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let copywriter: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin, organizer, copywriter] = await db
      .insert(staffUsers)
      .values([
        { email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" },
        { email: "organizer@dev.test", displayName: "Dani", role: "MODERATOR" },
        { email: "copywriter@dev.test", displayName: "Ioana", role: "COPYWRITER" },
      ])
      .returning();
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  it.each([
    ["a group run", "grup", {}],
    ["a race", "cursa", { type: "RACE" }],
    ["an event at another organizer's", "extern", { type: "EXTERNAL", registrationMode: "EXTERNAL", externalProvider: "Organizator", externalRegistrationUrl: "https://example.test/inscriere" }],
  ])("publishes %s straight from its draft, as the create page's one press does", async (_case, slug, fields) => {
    const draft = await createEvent(db, { actor: admin, fields: complete(slug, fields), now: NOW });
    expect(draft.editorialStatus).toBe("DRAFT");

    const published = await publishEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version, now: NOW });

    expect(published.editorialStatus).toBe("PUBLISHED");
    const row = await rowOf(draft.id);
    expect([row.editorialStatus, row.publishedAt, row.updatedByStaffUserId]).toEqual(["PUBLISHED", NOW, admin.id]);
  });

  it("publishes a date a series made as a draft, the source untouched", async () => {
    const source = await createEventAndPublish(db, {
      actor: admin,
      fields: complete("serie"),
      publish: false,
      repeat: { cadence: "WEEKLY", weekdays: [], until: null, publish: true },
      now: NOW,
    });
    const [copy] = await db.select().from(events).where(eq(events.repeatOf, source.event.id)).limit(1);
    expect(copy.editorialStatus).toBe("DRAFT");

    await publishEvent(db, { actor: admin, eventId: copy.id, expectedVersion: copy.version, now: NOW });

    expect((await rowOf(copy.id)).editorialStatus).toBe("PUBLISHED");
    expect((await rowOf(source.event.id)).editorialStatus).toBe("DRAFT");
  });

  it("is the plain publication from a submission", async () => {
    const draft = await createEvent(db, { actor: admin, fields: complete("verificat"), now: NOW });
    const reviewed = await transitionEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version, to: "IN_REVIEW", now: NOW });

    await publishEvent(db, { actor: admin, eventId: draft.id, expectedVersion: reviewed.version, now: NOW });

    expect((await rowOf(draft.id)).editorialStatus).toBe("PUBLISHED");
  });

  it("leaves the draft a draft, never a submission, when publication is refused", async () => {
    const fields = complete("incomplet");
    const draft = await createEvent(db, {
      actor: admin,
      fields: { ...fields, translations: { ...fields.translations, en: { ...fields.translations.en, excerpt: "" } } },
      now: NOW,
    });

    const refusal = await publishEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version, now: NOW }).catch((error: unknown) => error);

    expect(isDomainError(refusal) && refusal.code).toBe("VALIDATION_ERROR");
    const row = await rowOf(draft.id);
    expect([row.editorialStatus, row.version, row.publishedAt]).toEqual(["DRAFT", draft.version, null]);
  });

  it("refuses a stale page: a colleague's save since it was loaded is a conflict", async () => {
    const draft = await createEvent(db, { actor: admin, fields: complete("vechi"), now: NOW });

    const refusal = await publishEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version - 1, now: NOW }).catch((error: unknown) => error);

    expect(isDomainError(refusal) && refusal.code).toBe("CONFLICT");
    expect((await rowOf(draft.id)).editorialStatus).toBe("DRAFT");
  });

  it.each([
    ["an Organizer", () => organizer],
    ["a Redactor", () => copywriter],
  ])("refuses %s before anything moves — the draft is not sent for review either", async (_case, who) => {
    const draft = await createEvent(db, { actor: admin, fields: complete("rol"), now: NOW });

    const refusal = await publishEvent(db, { actor: who(), eventId: draft.id, expectedVersion: draft.version, now: NOW }).catch((error: unknown) => error);

    expect(isDomainError(refusal) && refusal.code).toBe("FORBIDDEN");
    const row = await rowOf(draft.id);
    expect([row.editorialStatus, row.version]).toEqual(["DRAFT", draft.version]);
  });
});
