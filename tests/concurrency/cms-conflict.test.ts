import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  saveEventFields,
  saveEventTranslation,
  transitionEvent,
} from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * BR-REQ-051-01 criterion 5 — a stale save is a conflict, proven with two real connections.
 *
 * This suite is deliberately NOT part of `yarn test`, and it deliberately does not use PGlite.
 * PGlite is a single connection: two transactions cannot race in it, so a green test there
 * would prove only that the SQL parses. `tests/helpers/db.ts` says the same thing about
 * capacity, and this is the first requirement in the repository to actually need the other
 * kind of database.
 *
 * Run it with `yarn test:concurrency` against a real PostgreSQL — `docker compose up -d db &&
 * yarn db:migrate` locally, and the service container in CI.
 *
 * The failure being prevented: two organizers open the same event on a Sunday morning, both
 * save, and one of them silently loses their work. That is the ordinary case for a club with
 * a handful of volunteers, not an edge case.
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Loud, not skipped. A concurrency suite that quietly passes with nothing connected is
  // worse than no suite at all: it reports success for a rule it never exercised.
  throw new Error(
    "tests/concurrency needs a real PostgreSQL: set DATABASE_URL and run `yarn db:migrate` first. " +
      "Locally: docker compose up -d db.",
  );
}

describe("BR-REQ-051-01 criterion 5 two organizers saving at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  const db = drizzle(pool);

  let editor: StaffUser;
  let eventId: string;
  let translationId: string;

  let eventVersion: number;

  /** The event row as the form posts it, so a save here exercises the same path a page does. */
  const EVENT_FIELDS = {
    kind: "OTHER",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    latitude: "",
    longitude: "",
    // One value for the whole event now (`DECISIONS.md` §36).
    locationName: "Parcul Tractorul",
    locationAddress: "",
    difficultyLabel: "",
    costText: "",
    mapUrl: "",
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

  const FIELDS = {
    slug: "concurrency-fixture",
    title: "Titlu inițial",
    excerpt: "Descriere.",
    seoTitle: "",
    seoDescription: "",
  };

  beforeAll(async () => {
    // Only this suite's own rows are removed, never the whole database: this runs against a
    // developer's local PostgreSQL, which may hold seeded events they are working on.
    await db.delete(events).where(eq(events.kind, "OTHER"));
    await db.delete(staffUsers).where(eq(staffUsers.email, "concurrency@dev.test"));

    [editor] = await db
      .insert(staffUsers)
      .values({ email: "concurrency@dev.test", displayName: "Concurrency", role: "EDITOR" })
      .returning();
  });

  afterAll(async () => {
    await db.delete(events).where(eq(events.id, eventId));
    await db.delete(staffUsers).where(eq(staffUsers.id, editor.id));
    await pool.end();
  });

  beforeEach(async () => {
    if (eventId) await db.delete(events).where(eq(events.id, eventId));

    const [event] = await db
      .insert(events)
      .values({
        kind: "OTHER",
        startsAt: new Date("2026-10-11T06:00:00Z"),
        editorialStatus: "IN_REVIEW",
      })
      .returning();
    eventId = event.id;
    eventVersion = event.version;

    // Both locales, complete: publication requires every language to be finished, so a fixture
    // with only Romanian would fail the publish for a reason this suite is not about.
    const [translation] = await db
      .insert(eventTranslations)
      .values({
        eventId: event.id,
        locale: "ro",
        slug: FIELDS.slug,
        title: FIELDS.title,
        excerpt: FIELDS.excerpt,
        locationName: "Parcul Tractorul",
        authorStaffUserId: editor.id,
      })
      .returning();
    translationId = translation.id;

    await db.insert(eventTranslations).values({
      eventId: event.id,
      locale: "en",
      slug: `${FIELDS.slug}-en`,
      title: "Concurrency fixture",
      excerpt: "Description.",
      locationName: "Parcul Tractorul",
      authorStaffUserId: editor.id,
    });
  });

  /** One connection of its own, with an open transaction, as a browser session would have. */
  async function session() {
    const client = await pool.connect();
    await client.query("BEGIN");
    return {
      db: drizzle(client),
      commit: async () => {
        await client.query("COMMIT");
        client.release();
      },
      rollback: async () => {
        await client.query("ROLLBACK");
        client.release();
      },
    };
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

  it("blocks the second save until the first commits, then refuses it as stale", async () => {
    const first = await session();
    const second = await session();

    try {
      // Both organizers loaded version 1.
      await saveEventTranslation(first.db, {
        actor: editor,
        translationId,
        expectedVersion: 1,
        fields: { ...FIELDS, title: "Salvarea Anei" },
      });

      // The second save reaches the same row while the first transaction is still open. Its
      // UPDATE blocks on the row lock — this promise does not settle until the commit below.
      const secondSave = codeOf(
        saveEventTranslation(second.db, {
          actor: editor,
          translationId,
          expectedVersion: 1,
          fields: { ...FIELDS, title: "Salvarea lui Radu" },
        }),
      );

      let settledEarly = false;
      void secondSave.then(() => {
        settledEarly = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settledEarly, "the second save must wait for the first transaction").toBe(false);

      await first.commit();

      // PostgreSQL now re-evaluates the blocked UPDATE against the committed row, whose
      // version is 2. The WHERE no longer matches, nothing is written, and the service says so.
      expect(await secondSave).toBe("CONFLICT");
      await second.commit();
    } finally {
      await first.commit().catch(() => undefined);
      await second.rollback().catch(() => undefined);
    }

    const [current] = await db
      .select()
      .from(eventTranslations)
      .where(eq(eventTranslations.id, translationId));

    expect(current.title, "the first save survived, whole").toBe("Salvarea Anei");
    expect(current.version, "exactly one save was applied").toBe(2);
  });

  it("lets exactly one of two simultaneous saves win", async () => {
    const first = await session();
    const second = await session();

    const outcomes = await Promise.all([
      codeOf(
        saveEventTranslation(first.db, {
          actor: editor,
          translationId,
          expectedVersion: 1,
          fields: { ...FIELDS, title: "A" },
        }),
      ).then(async (code) => {
        await first.commit();
        return code;
      }),
      new Promise<string>((resolve) => setTimeout(resolve, 50)).then(async () => {
        const code = await codeOf(
          saveEventTranslation(second.db, {
            actor: editor,
            translationId,
            expectedVersion: 1,
            fields: { ...FIELDS, title: "B" },
          }),
        );
        await second.commit();
        return code;
      }),
    ]);

    expect(outcomes.filter((code) => code === "no error")).toHaveLength(1);
    expect(outcomes.filter((code) => code === "CONFLICT")).toHaveLength(1);

    const [current] = await db
      .select()
      .from(eventTranslations)
      .where(eq(eventTranslations.id, translationId));
    expect(current.version).toBe(2);
  });

  /**
   * Publication moved to the event row (`DECISIONS.md` §28), so the race that matters is
   * against the event's own version: one editor reconfigures the race — its times, its capacity
   * — while another publishes the copy they were looking at a minute ago.
   */
  it("refuses a publish that races a change to the event, so nothing goes live half-changed", async () => {
    const writer = await session();
    const publisher = await session();

    try {
      await saveEventFields(writer.db, {
        actor: editor,
        eventId,
        expectedVersion: eventVersion,
        fields: { ...EVENT_FIELDS, startsAtWallTime: "2026-10-11T11:00" },
      });

      const publish = codeOf(
        transitionEvent(publisher.db, {
          actor: editor,
          eventId,
          expectedVersion: eventVersion,
          to: "PUBLISHED",
        }),
      );

      await writer.commit();
      expect(await publish).toBe("CONFLICT");
      await publisher.commit();
    } finally {
      await writer.commit().catch(() => undefined);
      await publisher.rollback().catch(() => undefined);
    }

    const [current] = await db.select().from(events).where(eq(events.id, eventId));

    // The editor who published had not seen the change, so the page did not go public.
    expect(current.editorialStatus).toBe("IN_REVIEW");
    expect(current.publishedAt).toBeNull();
  });
});
