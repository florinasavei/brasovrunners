import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import { createEvent, createEventAndPublish, transitionEvent } from "@/modules/content/events/service";
import type { Weekday } from "@/modules/events/domain/repeat";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02, BR-REQ-051-01 — create and publish in one press (`DECISIONS.md` §315).
 *
 * The owner: "ar trebui sa pot crea si publica dintr-un foc!" A new event was a draft that needed
 * two more presses in the editor, DRAFT → IN_REVIEW → PUBLISHED (§201). The one press walks those
 * same two transitions through `transitionEvent`, so what these tests hold down is that nothing
 * about publication changed: the same guard refuses the same events, the draft survives a
 * refusal with everything that was typed, and a role that may not publish never publishes.
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

const COMPLETE = {
  ...EVENT_FIELDS,
  translations: {
    ro: { slug: "alergare-de-duminica", title: "Alergare de duminică", excerpt: "Zece kilometri prin parc." },
    en: { slug: "sunday-run", title: "Sunday run", excerpt: "Ten kilometres round the park." },
  },
};

/** The English summary left empty: a draft may be saved like this, and publication refuses it. */
const ENGLISH_SUMMARY_MISSING = {
  ...COMPLETE,
  translations: { ...COMPLETE.translations, en: { ...COMPLETE.translations.en, excerpt: "" } },
};

describe("BR-REQ-050-02 create and publish in one press (§315)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" })
      .returning();
    [organizer] = await db
      .insert(staffUsers)
      .values({ email: "organizer@dev.test", displayName: "Dani", role: "MODERATOR" })
      .returning();
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  it("publishes an Administrator's new event in the same press, both languages with it", async () => {
    const result = await createEventAndPublish(db, { actor: admin, fields: COMPLETE, publish: true, now: NOW });

    expect(result.published).toBe(true);
    expect(result.refusal).toBeNull();
    const row = await rowOf(result.event.id);
    expect(row.editorialStatus).toBe("PUBLISHED");
    expect(row.publishedAt).toEqual(NOW);
    expect(row.createdByStaffUserId).toBe(admin.id);
    expect(row.updatedByStaffUserId).toBe(admin.id);

    const translations = await listTranslationsForEvent(db, row.id);
    expect(translations.map((t) => [t.locale, t.title, t.excerpt])).toEqual([
      ["ro", "Alergare de duminică", "Zece kilometri prin parc."],
      ["en", "Sunday run", "Ten kilometres round the park."],
    ]);
  });

  it("leaves the trace a manual publish leaves, and no other", async () => {
    // The manual path, the way the editor walks it: create, submit, publish.
    const manual = await createEvent(db, {
      actor: admin,
      fields: { ...COMPLETE, translations: { ro: { ...COMPLETE.translations.ro, slug: "manual-ro" }, en: { ...COMPLETE.translations.en, slug: "manual-en" } } },
      now: NOW,
    });
    const reviewed = await transitionEvent(db, { actor: admin, eventId: manual.id, expectedVersion: manual.version, to: "IN_REVIEW", now: NOW });
    await transitionEvent(db, { actor: admin, eventId: manual.id, expectedVersion: reviewed.version, to: "PUBLISHED", now: NOW });
    const auditAfterManual = await db.select().from(auditLogs);

    const onePress = await createEventAndPublish(db, { actor: admin, fields: COMPLETE, publish: true, now: NOW });
    const auditAfterBoth = await db.select().from(auditLogs);

    // A publication is recorded on the row — who touched it last, and when it first went live —
    // and in no audit row, by hand or in one press: the press adds exactly what the hand adds.
    expect(auditAfterBoth).toEqual(auditAfterManual);
    const [manualRow, onePressRow] = [await rowOf(manual.id), await rowOf(onePress.event.id)];
    expect([onePressRow.editorialStatus, onePressRow.publishedAt, onePressRow.updatedByStaffUserId]).toEqual([
      manualRow.editorialStatus,
      manualRow.publishedAt,
      manualRow.updatedByStaffUserId,
    ]);
  });

  it("keeps the draft when a language is incomplete, names what is missing, and publishes nothing", async () => {
    const result = await createEventAndPublish(db, { actor: admin, fields: ENGLISH_SUMMARY_MISSING, publish: true, now: NOW });

    expect(result.published).toBe(false);
    expect(result.refusal?.code).toBe("VALIDATION_ERROR");
    // The guard's own sentence, the same one the editor's publish button meets.
    expect(result.refusal?.message).toContain("en is missing excerpt");

    // Nothing typed was lost: the draft stands with both languages as they were posted.
    const row = await rowOf(result.event.id);
    expect(row.editorialStatus).toBe("DRAFT");
    expect(row.publishedAt).toBeNull();
    const translations = await listTranslationsForEvent(db, row.id);
    expect(translations.map((t) => [t.locale, t.title])).toEqual([
      ["ro", "Alergare de duminică"],
      ["en", "Sunday run"],
    ]);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("is the plain create when publication is not asked for", async () => {
    const result = await createEventAndPublish(db, { actor: admin, fields: COMPLETE, publish: false, now: NOW });

    expect(result).toMatchObject({ published: false, refusal: null });
    expect((await rowOf(result.event.id)).editorialStatus).toBe("DRAFT");
  });

  it("refuses an Organizer outright — creating an event is the Administrator's — and writes nothing", async () => {
    // `canCreateEvent` is Administrator-and-above, so the Organizer's press never reaches the
    // publication question; the page does not show them the form, and the service says no.
    const refusal = await createEventAndPublish(db, { actor: organizer, fields: COMPLETE, publish: true, now: NOW }).catch(
      (error: unknown) => error,
    );

    expect(isDomainError(refusal) && refusal.code).toBe("FORBIDDEN");
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("publishes the series with its source through the rule's own flag (§122)", async () => {
    const result = await createEventAndPublish(db, {
      actor: admin,
      fields: COMPLETE,
      publish: true,
      repeat: { cadence: "WEEKLY", weekdays: [], until: null },
      now: NOW,
    });

    expect(result).toMatchObject({ published: true, refusal: null });
    expect(result.repeated).toBeGreaterThan(0);
    const copies = await db.select().from(events).where(eq(events.repeatOf, result.event.id));
    expect(copies).toHaveLength(result.repeated);
    expect(copies.every((copy) => copy.editorialStatus === "PUBLISHED")).toBe(true);
    // The rule the create form chose is on the source, with the publication it followed.
    expect((await rowOf(result.event.id)).repeatRule).toEqual({ cadence: "WEEKLY", weekdays: [], until: null, publish: true });
  });

  it("keeps the series in draft when its source could not be published", async () => {
    const result = await createEventAndPublish(db, {
      actor: admin,
      fields: ENGLISH_SUMMARY_MISSING,
      publish: true,
      repeat: { cadence: "WEEKLY", weekdays: [], until: null },
      now: NOW,
    });

    expect(result.published).toBe(false);
    const copies = await db.select().from(events).where(eq(events.repeatOf, result.event.id));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies).toHaveLength(result.repeated);
    expect(copies.every((copy) => copy.editorialStatus === "DRAFT")).toBe(true);
  });

  /*
    The review of §315: the series used to be made after the create had committed, so a rule
    `repeatEvent` refused — an end before the start — left the event behind, and the action could
    only redirect to it, losing the repeat settings. One transaction now: the refusal names the
    box the create form posts, and nothing at all is written, the publication included.
  */
  it.each([
    ["an end the day before the start", "2026-10-10"],
    ["an end that is not a date", "11/10/2026"],
  ])("refuses %s, naming repeat.until, and writes nothing", async (_case, until) => {
    const refusal = await createEventAndPublish(db, {
      actor: admin,
      fields: COMPLETE,
      publish: true,
      repeat: { cadence: "FORTNIGHTLY", weekdays: [3], until },
      now: NOW,
    }).catch((error: unknown) => error);

    expect(isDomainError(refusal) && [refusal.code, refusal.fields]).toEqual(["VALIDATION_ERROR", ["repeat.until"]]);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(eventTranslations)).toHaveLength(0);
  });

  it("refuses a weekday outside Monday to Sunday, naming repeat.weekday, and writes nothing", async () => {
    const refusal = await createEventAndPublish(db, {
      actor: admin,
      fields: COMPLETE,
      publish: false,
      repeat: { cadence: "WEEKLY", weekdays: [9 as Weekday], until: null },
      now: NOW,
    }).catch((error: unknown) => error);

    expect(isDomainError(refusal) && [refusal.code, refusal.fields]).toEqual(["VALIDATION_ERROR", ["repeat.weekday"]]);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("takes an end on the event's own day: the series is that one date", async () => {
    // The end is the last day a date may fall on, in the event's zone; the start's own day is
    // after the start by the rest of that day, so it is not refused — and nothing follows it.
    const result = await createEventAndPublish(db, {
      actor: admin,
      fields: COMPLETE,
      publish: false,
      repeat: { cadence: "WEEKLY", weekdays: [], until: "2026-10-11" },
      now: NOW,
    });

    expect(result.repeated).toBe(0);
    expect((await rowOf(result.event.id)).repeatRule).toMatchObject({ until: "2026-10-11" });
  });
});
