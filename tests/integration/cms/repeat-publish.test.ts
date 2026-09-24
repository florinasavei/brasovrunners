import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { setRepeatPublish } from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §341 — a running series' automatic publication, switched after it started
 * (`setRepeatPublish`, `src/modules/content/events/service.ts`).
 *
 * A series begun without the tick under "Repetă evenimentul" — or from a draft — made every
 * date the standing job created a draft for good, with no way back short of stopping and
 * restarting the series. This is the switch: only the rule's `publish` flag moves, the cadence,
 * weekdays and end stay exactly as chosen, and turning it on asks the same two questions the
 * first creation asked (`repeatEvent`, §122) — a role that may publish, and a published source.
 */
describe("§341 setRepeatPublish — the running series' publish switch", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let contributor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
    [contributor] = await db
      .insert(staffUsers)
      .values({ email: "contributor@dev.test", displayName: "Contributor", role: "CONTRIBUTOR" })
      .returning();
  });

  const weekly = (publish: boolean, until: string | null = null) => ({
    cadence: "WEEKLY" as const,
    weekdays: [] as (1 | 2 | 3 | 4 | 5 | 6 | 7)[],
    until,
    publish,
  });

  /** A source event, its own rule already on the row — as `repeatEvent` leaves it. */
  async function seedSource(options: { published?: boolean; rule?: ReturnType<typeof weekly> | null } = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        surface: "ASPHALT",
        startsAt: new Date("2026-10-11T08:00:00+03:00"),
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
        repeatRule: options.rule === undefined ? weekly(false) : options.rule,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare-de-duminica", title: "Alergare de duminică", excerpt: "Relaxat." },
      { eventId: event.id, locale: "en", slug: "sunday-run", title: "Sunday run", excerpt: "Easy." },
    ]);
    return event;
  }

  const ruleOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0].repeatRule;

  it("turns publication on for a published source, keeping cadence, weekdays and end untouched", async () => {
    const source = await seedSource({ published: true, rule: { cadence: "WEEKLY", weekdays: [1, 3], until: "2026-12-01", publish: false } });
    await setRepeatPublish(db, { actor: admin, eventId: source.id, publish: true });
    expect(await ruleOf(source.id)).toEqual({ cadence: "WEEKLY", weekdays: [1, 3], until: "2026-12-01", publish: true });
  });

  it("turns publication back off, and a date that already exists keeps its own state", async () => {
    const source = await seedSource({ published: true, rule: weekly(true) });
    await setRepeatPublish(db, { actor: admin, eventId: source.id, publish: false });
    expect(await ruleOf(source.id)).toEqual(weekly(false));
  });

  it("refuses to turn publication on while the source itself is not published", async () => {
    const source = await seedSource({ published: false, rule: weekly(false) });
    const refused = await setRepeatPublish(db, { actor: admin, eventId: source.id, publish: true }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    // Refused, not silently ignored: the rule is untouched.
    expect(await ruleOf(source.id)).toEqual(weekly(false));
  });

  it("lets the switch go off even while the source is not published", async () => {
    // Turning it off never asks anything of the source — only turning it on does.
    const source = await seedSource({ published: false, rule: weekly(true) });
    await setRepeatPublish(db, { actor: admin, eventId: source.id, publish: false });
    expect(await ruleOf(source.id)).toEqual(weekly(false));
  });

  it("refuses a role below Administrator, whichever way the switch moves", async () => {
    const source = await seedSource({ published: true, rule: weekly(false) });
    const refused = await setRepeatPublish(db, { actor: contributor, eventId: source.id, publish: true }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    expect(await ruleOf(source.id)).toEqual(weekly(false));
  });

  it("refuses an event that does not repeat — a series is switched from its first event", async () => {
    const source = await seedSource({ published: true, rule: null });
    const refused = await setRepeatPublish(db, { actor: admin, eventId: source.id, publish: true }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
  });

  it("refuses an event id that does not exist", async () => {
    const refused = await setRepeatPublish(db, { actor: admin, eventId: "00000000-0000-0000-0000-000000000000", publish: true }).catch(
      (e: unknown) => e,
    );
    expect(isDomainError(refused) && refused.code).toBe("NOT_FOUND");
  });
});
