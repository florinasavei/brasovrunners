import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { resolveLocaleSwitch } from "@/modules/events/locale-switch";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-040-01 criterion 5 — switching language lands on the corresponding localized page.
 *
 * This is the failure the criterion exists to prevent, and a language switcher in shared chrome
 * is the most likely place to reintroduce it: the slugs differ per locale, so swapping the
 * prefix produces a URL that does not resolve. The switcher therefore resolves through the
 * database, and these are the cases it has to get right.
 */
describe("BR-REQ-040-01 where a language switch lands", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  /**
   * Publication is one state per event now, so the case the switcher has to survive is a
   * language with no translation at all rather than one still in draft (`DECISIONS.md` §28).
   */
  async function seedEvent(options: { withEnglish: boolean }) {
    const [event] = await db
      .insert(events)
      .values({
        kind: "TRAIL_RUN",
        startsAt: new Date("2026-09-20T05:00:00Z"),
        editorialStatus: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      })
      .returning();

    await db.insert(eventTranslations).values([
      {
        eventId: event.id,
        locale: "ro" as const,
        slug: "tura-pe-tampa",
        title: "Tură pe Tâmpa",
        locationName: "Stația de telecabină",
      },
      ...(options.withEnglish
        ? [
            {
              eventId: event.id,
              locale: "en" as const,
              slug: "tampa-trail",
              title: "Tâmpa trail run",
              locationName: "Cable car station",
            },
          ]
        : []),
    ]);

    return event;
  }

  it("swaps to the other language's own slug, not the same slug under a new prefix", async () => {
    await seedEvent({ withEnglish: true });

    expect(await resolveLocaleSwitch(db, "/ro/evenimente/tura-pe-tampa", "en")).toBe(
      "/en/events/tampa-trail",
    );
    expect(await resolveLocaleSwitch(db, "/en/events/tampa-trail", "ro")).toBe(
      "/ro/evenimente/tura-pe-tampa",
    );
  });

  it("falls back to the listing when the event has no translation in the other language", async () => {
    await seedEvent({ withEnglish: false });

    // Linking to a locale with no translation would be a 404 (BR-REQ-040-02), which reads as a
    // broken site rather than as unfinished content.
    expect(await resolveLocaleSwitch(db, "/ro/evenimente/tura-pe-tampa", "en")).toBe("/en/events");
  });

  it("falls back to the listing for an event that does not exist", async () => {
    expect(await resolveLocaleSwitch(db, "/ro/evenimente/nu-exista", "en")).toBe("/en/events");
  });

  it("translates the listing and the locale root without touching the database", async () => {
    expect(await resolveLocaleSwitch(db, "/ro/evenimente", "en")).toBe("/en/events");
    expect(await resolveLocaleSwitch(db, "/en/events", "ro")).toBe("/ro/evenimente");
    expect(await resolveLocaleSwitch(db, "/ro", "en")).toBe("/en");
  });

  it("keeps a staff route on the same record in the other language", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(await resolveLocaleSwitch(db, `/ro/admin/events/${id}`, "en")).toBe(
      `/en/admin/events/${id}`,
    );
    expect(await resolveLocaleSwitch(db, `/ro/previzualizare/evenimente/${id}`, "en")).toBe(
      `/en/preview/events/${id}`,
    );
    expect(await resolveLocaleSwitch(db, "/ro/autentificare", "en")).toBe("/en/sign-in");
  });

  it("sends an unrecognised path to the listing rather than nowhere", async () => {
    for (const path of ["/", "/evenimente", "/de/veranstaltungen", "/ro/nu-exista-ruta"]) {
      expect(await resolveLocaleSwitch(db, path, "en"), path).toBe("/en/events");
    }
  });
});
