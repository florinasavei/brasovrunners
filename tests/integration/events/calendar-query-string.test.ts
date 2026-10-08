import { createTranslator } from "next-intl";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { events, eventTranslations } from "@/db/schema/events";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §674 — `?v=2` is the same file (amending §107).
 *
 * When Google Calendar believes it already has a calendar (one the person hid or removed), «Din URL»
 * with the same address does nothing for up to a day; the same address with `?v=2` at the end is a
 * new address to Google and the same file to us. This holds the second half: both `.ics` routes
 * answer the same bytes with and without a query, whatever a stranger puts in it — neither handler
 * reads the request (on a real server Next also hands a `force-static` handler a request with its
 * search params emptied, and keys the kept copy by the path alone).
 *
 * Over a real database (PGlite), through the public cache's read-through outside a Next server, the
 * clock held still so `DTSTAMP` cannot differ between two calls.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => {
  const catalogue = (locale: string) => (locale === "en" ? en : ro) as Record<string, object>;
  return {
    getTranslations: async (arg: { locale: string; namespace: string }) =>
      createTranslator({ locale: arg.locale, messages: catalogue(arg.locale)[arg.namespace] as Record<string, string>, namespace: undefined }),
  };
});

const { GET: feed } = await import("@/app/[locale]/events/calendar.ics/route");
const { GET: eventFile } = await import("@/app/[locale]/events/[slug]/calendar.ics/route");

const NOW = new Date("2026-10-08T09:00:00.000Z");

describe("§674 the calendar files answer the same bytes whatever the query", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await resetTables(db);
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: new Date("2026-10-14T15:00:00.000Z"),
        registrationMode: "NONE",
        editorialStatus: "PUBLISHED",
        publishedAt: new Date("2026-10-01T10:00:00.000Z"),
        locationName: "Parcul Titulescu",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare-de-miercuri", title: "Alergarea de miercuri" },
      { eventId: event.id, locale: "en", slug: "wednesday-run", title: "The Wednesday run" },
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One answer's status, the headers a calendar reads, and its body. */
  async function read(response: Response) {
    return {
      status: response.status,
      type: response.headers.get("Content-Type"),
      disposition: response.headers.get("Content-Disposition"),
      body: await response.text(),
    };
  }

  it.each(["ro", "en"] as const)("the club's feed: bare, ?v=2, ?v=3 and a stranger's query are one file (%s)", async (locale) => {
    const ask = (search: string) =>
      feed(new Request(`http://localhost/${locale}/events/calendar.ics${search}`), { params: Promise.resolve({ locale }) }).then(read);
    const bare = await ask("");
    expect(bare.status).toBe(200);
    expect(bare.body).toContain("BEGIN:VCALENDAR");
    expect(bare.body).toContain(locale === "ro" ? "Alergarea de miercuri" : "The Wednesday run");
    for (const search of ["?v=2", "?v=3", "?v=2&name=x&locale=en", "?slug=other&from=0&to=9999999999999"]) {
      expect(await ask(search), search).toEqual(bare);
    }
  });

  it.each([
    ["ro", "alergare-de-miercuri"],
    ["en", "wednesday-run"],
  ] as const)("an event's own file: bare and ?v=2 are one file (%s)", async (locale, slug) => {
    const ask = (search: string) =>
      eventFile(new Request(`http://localhost/${locale}/events/${slug}/calendar.ics${search}`), { params: Promise.resolve({ locale, slug }) }).then(read);
    const bare = await ask("");
    expect(bare.status).toBe(200);
    expect(bare.body).toContain("BEGIN:VEVENT");
    expect(await ask("?v=2")).toEqual(bare);
    expect(await ask("?v=2&slug=other")).toEqual(bare);
  });
});
