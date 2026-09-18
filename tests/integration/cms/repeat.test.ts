import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { repeatEvent } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 criterion 7 — the weekly run, made once.
 *
 * The properties that matter: every occurrence keeps the *wall-clock* time in the event's zone
 * across a daylight-saving change; everything with a time moves together; the slug says which
 * date it is, in both languages; copies are drafts unless the source is published and publishing
 * is asked for by somebody who may publish; and a series that already exists is refused whole
 * rather than half-made.
 */
describe("BR-REQ-050-02 criterion 7 repeating an event", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let author: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
    [author] = await db
      .insert(staffUsers)
      .values({ email: "contributor@dev.test", displayName: "Author", role: "CONTRIBUTOR" })
      .returning();
  });

  /** A Sunday-morning run two weeks before the clocks go back in Romania (2026-10-25). */
  async function seedRun(options: { published?: boolean } = {}) {
    const startsAt = new Date("2026-10-11T08:00:00+03:00");
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        surface: "ASPHALT",
        startsAt,
        endsAt: new Date("2026-10-11T09:30:00+03:00"),
        timezone: "Europe/Bucharest",
        locationName: "Parcul Tractorul",
        registrationMode: "INTERNAL",
        capacity: 30,
        registrationOpensAt: new Date("2026-10-04T08:00:00+03:00"),
        registrationClosesAt: new Date("2026-10-11T07:00:00+03:00"),
        declarationDocumentId: null,
        editorialStatus: options.published ? "PUBLISHED" : "DRAFT",
        publishedAt: options.published ? new Date("2026-09-01T00:00:00Z") : null,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare-de-duminica", title: "Alergare de duminică", excerpt: "Relaxat." },
      { eventId: event.id, locale: "en", slug: "sunday-run", title: "Sunday run", excerpt: "Easy." },
    ]);
    return event;
  }

  const copiesOf = (sourceId: string) =>
    db.select().from(events).where(eq(events.editorialStatus, "DRAFT")).orderBy(asc(events.startsAt)).then((rows) => rows.filter((row) => row.id !== sourceId));

  it("keeps the wall-clock time across the October clock change, and moves every time with it", async () => {
    const source = await seedRun();
    const result = await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count: 4, publish: false });
    expect(result).toEqual({ created: 4, published: false });

    const copies = await copiesOf(source.id);
    expect(copies.map((copy) => toWallTimeInput(copy.startsAt, "Europe/Bucharest"))).toEqual([
      "2026-10-18T08:00",
      // The clocks went back on 2026-10-25 at 04:00: still 08:00 on the wall, an hour later as an instant.
      "2026-10-25T08:00",
      "2026-11-01T08:00",
      "2026-11-08T08:00",
    ]);
    expect(copies[1].startsAt.getTime() - copies[0].startsAt.getTime()).toBe(8 * 24 * 3_600_000 - 24 * 3_600_000 + 3_600_000);

    // The end, the window: same relationship to the start on every occurrence.
    const third = copies[2];
    expect(toWallTimeInput(third.endsAt, "Europe/Bucharest")).toBe("2026-11-01T09:30");
    expect(toWallTimeInput(third.registrationOpensAt, "Europe/Bucharest")).toBe("2026-10-25T08:00");
    expect(toWallTimeInput(third.registrationClosesAt, "Europe/Bucharest")).toBe("2026-11-01T07:00");
    // Copied configuration; never the featured flag or the start list.
    expect(third.capacity).toBe(30);
    expect(third.featured).toBe(false);
    expect(third.participantListVisibility).toBe("HIDDEN");
  });

  /**
   * "Every Monday and Wednesday" (criterion 7, 2026-09-18). The series covers `count` weeks
   * counted from the source's own week, each chosen day at the source's wall time, never the
   * source itself and never a day before it — so a Sunday source with Monday and Wednesday
   * ticked contributes nothing from its own week, and three weeks are the two that follow.
   */
  it("repeats on chosen weekdays, for a number of weeks, skipping days on or before the source", async () => {
    const source = await seedRun(); // Sunday 2026-10-11, 08:00
    const result = await repeatEvent(db, {
      actor: editor,
      eventId: source.id,
      cadence: "WEEKLY",
      count: 3,
      weekdays: [1, 3],
      publish: false,
    });
    expect(result.created).toBe(4);

    const copies = await copiesOf(source.id);
    expect(copies.map((copy) => toWallTimeInput(copy.startsAt, "Europe/Bucharest"))).toEqual([
      "2026-10-12T08:00", // Monday of the week after the source's
      "2026-10-14T08:00", // Wednesday
      "2026-10-19T08:00",
      "2026-10-21T08:00",
    ]);
    const [ro] = await db.select().from(eventTranslations).where(and(eq(eventTranslations.eventId, copies[1].id), eq(eventTranslations.locale, "ro")));
    expect(ro.slug).toBe("alergare-de-duminica-2026-10-14");

    // A Sunday run "every Sunday" for one week is the source alone: nothing to make.
    await expect(
      repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count: 1, weekdays: [7], publish: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Every day for a year is more than one press may make.
    await expect(
      repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count: 52, weekdays: [1, 2, 3, 4, 5, 6, 7], publish: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("gives every occurrence a slug carrying its date, in both languages", async () => {
    const source = await seedRun();
    await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "FORTNIGHTLY", count: 2, publish: false });

    const slugs = await db.select({ locale: eventTranslations.locale, slug: eventTranslations.slug }).from(eventTranslations).orderBy(asc(eventTranslations.slug));
    expect(slugs.map((row) => row.slug).sort()).toEqual([
      "alergare-de-duminica",
      "alergare-de-duminica-2026-10-25",
      "alergare-de-duminica-2026-11-08",
      "sunday-run",
      "sunday-run-2026-10-25",
      "sunday-run-2026-11-08",
    ]);
  });

  it("adds months on the calendar for a monthly series", async () => {
    const source = await seedRun();
    await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "MONTHLY", count: 3, publish: false });
    const copies = await copiesOf(source.id);
    expect(copies.map((copy) => toWallTimeInput(copy.startsAt, "Europe/Bucharest"))).toEqual([
      "2026-11-11T08:00",
      "2026-12-11T08:00",
      "2027-01-11T08:00",
    ]);
  });

  it("publishes the copies only when asked and only from a published source", async () => {
    const draftSource = await seedRun();
    const fromDraft = await repeatEvent(db, { actor: editor, eventId: draftSource.id, cadence: "WEEKLY", count: 1, publish: true });
    // The flag is ignored, not refused: a draft's copies cannot be complete.
    expect(fromDraft.published).toBe(false);

    await resetTables(db);
    [editor] = await db.insert(staffUsers).values({ email: "m2@dev.test", displayName: "E", role: "MODERATOR" }).returning();
    const publishedSource = await seedRun({ published: true });
    const fromPublished = await repeatEvent(db, { actor: editor, eventId: publishedSource.id, cadence: "WEEKLY", count: 2, publish: true });
    expect(fromPublished.published).toBe(true);

    const live = await db.select().from(events).where(eq(events.editorialStatus, "PUBLISHED"));
    expect(live).toHaveLength(3);
    expect(live.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("refuses a Contributor, and refuses to publish for anyone below the publishing role", async () => {
    const source = await seedRun({ published: true });
    const refused = await repeatEvent(db, { actor: author, eventId: source.id, cadence: "WEEKLY", count: 1, publish: false }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
  });

  it("refuses a series that already exists, and writes nothing", async () => {
    const source = await seedRun();
    await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count: 2, publish: false });
    const again = await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count: 3, publish: false }).catch((e: unknown) => e);
    expect(isDomainError(again) && again.code).toBe("CONFLICT");
    expect(await copiesOf(source.id)).toHaveLength(2);
  });

  it("bounds the count", async () => {
    const source = await seedRun();
    for (const count of [0, 53, 1.5]) {
      const refused = await repeatEvent(db, { actor: editor, eventId: source.id, cadence: "WEEKLY", count, publish: false }).catch((e: unknown) => e);
      expect(isDomainError(refused) && refused.code, String(count)).toBe("VALIDATION_ERROR");
    }
  });
});
