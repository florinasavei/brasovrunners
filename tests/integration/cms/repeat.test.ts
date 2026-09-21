import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { materializeStandingRepeats, repeatEvent, stopRepeat } from "@/modules/content/events/service";
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
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "ADMIN" })
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

  const copiesOf = (sourceId: string) => db.select().from(events).where(eq(events.repeatOf, sourceId)).orderBy(asc(events.startsAt));

  /** The day the series is made: the horizon (8 weeks) reaches 2026-11-14 from here. */
  const NOW = new Date("2026-09-19T10:00:00.000Z");
  const weekly = (until: string | null, weekdays: number[] = [], publish = false) => ({ cadence: "WEEKLY" as const, weekdays: weekdays as (1 | 2 | 3 | 4 | 5 | 6 | 7)[], until, publish });

  it("keeps the wall-clock time across the October clock change, and moves every time with it", async () => {
    const source = await seedRun();
    const result = await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly(null), now: NOW });
    // For ever, so the horizon decides: four Sundays before 14 November.
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
    // Copied configuration; never the featured flag, the start list or the rule itself.
    expect(third.capacity).toBe(30);
    expect(third.featured).toBe(false);
    expect(third.participantListVisibility).toBe("HIDDEN");
    expect(third.repeatOf).toBe(source.id);
    expect(third.repeatRule).toBeNull();
    // The source carries the rule.
    expect((await db.select().from(events).where(eq(events.id, source.id)))[0].repeatRule).toEqual({ cadence: "WEEKLY", weekdays: [], until: null, publish: false });
  });

  /**
   * "Every Monday and Wednesday" until a date (criterion 7, §122): each chosen day at the
   * source's wall time, never the source itself and never a day before it — so a Sunday source
   * with Monday and Wednesday ticked contributes nothing from its own week.
   */
  it("repeats on chosen weekdays and the event's own day until a date, skipping days on or before the source (§128)", async () => {
    const source = await seedRun(); // Sunday 2026-10-11, 08:00
    const result = await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-10-24", [1, 3]), now: NOW });
    expect(result.created).toBe(5);

    // The Sunday is in the rule although only Monday and Wednesday were ticked: the source
    // is the first date of the series, not a one-off before it.
    expect((await db.select().from(events).where(eq(events.id, source.id)))[0].repeatRule).toEqual({ cadence: "WEEKLY", weekdays: [1, 3, 7], until: "2026-10-24", publish: false });
    const copies = await copiesOf(source.id);
    expect(copies.map((copy) => toWallTimeInput(copy.startsAt, "Europe/Bucharest"))).toEqual([
      "2026-10-12T08:00", // Monday of the week after the source's
      "2026-10-14T08:00", // Wednesday
      "2026-10-18T08:00", // Sunday — the source's own day, a week on
      "2026-10-19T08:00",
      "2026-10-21T08:00",
    ]);
    const [ro] = await db.select().from(eventTranslations).where(and(eq(eventTranslations.eventId, copies[1].id), eq(eventTranslations.locale, "ro")));
    expect(ro.slug).toBe("alergare-de-duminica-2026-10-14");
  });

  it("makes nothing when the rule gives no date after the event, and refuses an end before it", async () => {
    const source = await seedRun();
    // A Sunday run "every Sunday" until the Saturday after: the source alone.
    expect((await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-10-17", [7]), now: NOW })).created).toBe(0);
    const refused = await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-10-01"), now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    const notADate = await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("soon"), now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(notADate) && notADate.code).toBe("VALIDATION_ERROR");
  });

  it("gives every occurrence a slug carrying its date, in both languages", async () => {
    const source = await seedRun();
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "FORTNIGHTLY", weekdays: [], until: "2026-11-10", publish: false }, now: NOW });

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

  it("keeps a monthly series going as the horizon advances, and stops when told (§122)", async () => {
    const source = await seedRun();
    // Made on 11 October: eight weeks reach 6 December, so one occurrence.
    const made = await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "MONTHLY", weekdays: [], until: null, publish: false }, now: new Date("2026-10-11T10:00:00Z") });
    expect(made.created).toBe(1);
    // The job, five weeks later: the horizon now reaches 15 January, two more months.
    const run = await materializeStandingRepeats(db, new Date("2026-11-20T10:00:00Z"));
    expect(run).toEqual({ sources: 1, created: 2 });
    // And again the same day: nothing new — two reads, no write.
    expect((await materializeStandingRepeats(db, new Date("2026-11-20T11:00:00Z"))).created).toBe(0);
    expect((await copiesOf(source.id)).map((copy) => toWallTimeInput(copy.startsAt, "Europe/Bucharest"))).toEqual([
      "2026-11-11T08:00",
      "2026-12-11T08:00",
      "2027-01-11T08:00",
    ]);

    await stopRepeat(db, { actor: editor, eventId: source.id });
    expect((await materializeStandingRepeats(db, new Date("2027-03-01T10:00:00Z"))).sources).toBe(0);
    expect(await copiesOf(source.id)).toHaveLength(3);
  });

  it("publishes the occurrences only when asked and only from a published source", async () => {
    const draftSource = await seedRun();
    const fromDraft = await repeatEvent(db, { actor: editor, eventId: draftSource.id, rule: weekly("2026-10-20", [], true), now: NOW });
    // The flag is ignored, not refused: a draft's copies cannot be complete.
    expect(fromDraft.published).toBe(false);

    await resetTables(db);
    [editor] = await db.insert(staffUsers).values({ email: "m2@dev.test", displayName: "E", role: "ADMIN" }).returning();
    const publishedSource = await seedRun({ published: true });
    const fromPublished = await repeatEvent(db, { actor: editor, eventId: publishedSource.id, rule: weekly("2026-10-26", [], true), now: NOW });
    expect(fromPublished.published).toBe(true);

    const live = await db.select().from(events).where(eq(events.editorialStatus, "PUBLISHED"));
    expect(live).toHaveLength(3);
    expect(live.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("refuses a Contributor, and a series started from one of its own dates", async () => {
    const source = await seedRun({ published: true });
    const refused = await repeatEvent(db, { actor: author, eventId: source.id, rule: weekly(null), now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-10-20"), now: NOW });
    const [copy] = await copiesOf(source.id);
    const fromCopy = await repeatEvent(db, { actor: editor, eventId: copy.id, rule: weekly(null), now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(fromCopy) && fromCopy.code).toBe("VALIDATION_ERROR");
  });

  it("is idempotent: repeating again makes no second copy of a date", async () => {
    const source = await seedRun();
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-10-26"), now: NOW });
    const again = await repeatEvent(db, { actor: editor, eventId: source.id, rule: weekly("2026-11-02"), now: NOW });
    // The rule now reaches a week further: one more date, the two that existed untouched.
    expect(again.created).toBe(1);
    expect(await copiesOf(source.id)).toHaveLength(3);
  });
});
