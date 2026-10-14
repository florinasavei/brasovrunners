import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { arrangeEventList, countEventLines, parseEventListQuery } from "@/modules/content/events/list-query";
import { listEventsForBackoffice } from "@/modules/content/events/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, BR-REQ-040-04 (`DECISIONS.md` §527) — the backoffice events list's search, state
 * and order over real rows: `listEventsForBackoffice` as the page fetches it, then
 * `arrangeEventList` as the page arranges it. A weekly series with dates behind and ahead, a
 * finished series, a draft, an archived race, a called-off race and one marked completed — every
 * state and every order asked once.
 */
describe("§527 the backoffice events list over seeded events and a series", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const NOW = new Date("2026-10-01T09:00:00Z");

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  type Seed = {
    ro: string;
    en: string;
    startsAt: string;
    editorialStatus?: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
    eventStatus?: "SCHEDULED" | "CANCELLED" | "COMPLETED";
    locationName?: string;
  };

  let slugIndex = 0;
  async function seed({ ro, en, startsAt, editorialStatus = "PUBLISHED", eventStatus = "SCHEDULED", locationName = "Parcul Tractorul" }: Seed) {
    const start = new Date(startsAt);
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        surface: "ASPHALT",
        startsAt: start,
        endsAt: new Date(start.getTime() + 90 * 60_000),
        timezone: "Europe/Bucharest",
        locationName,
        registrationMode: "INTERNAL",
        capacity: 30,
        registrationOpensAt: new Date(start.getTime() - 7 * 24 * 3_600_000),
        registrationClosesAt: new Date(start.getTime() - 3_600_000),
        declarationDocumentId: null,
        editorialStatus,
        eventStatus,
        publishedAt: editorialStatus === "PUBLISHED" ? new Date("2026-01-01T00:00:00Z") : null,
      })
      .returning();
    slugIndex += 1;
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `ro-${slugIndex}`, title: ro, excerpt: "." },
      { eventId: event.id, locale: "en", slug: `en-${slugIndex}`, title: en, excerpt: "." },
    ]);
  }

  beforeEach(async () => {
    await resetTables(db);
    // A weekly run: two Tuesdays gone, two to come (the last a draft).
    for (const [day, editorialStatus] of [
      ["2026-09-22", "PUBLISHED"],
      ["2026-09-29", "PUBLISHED"],
      ["2026-10-06", "PUBLISHED"],
      ["2026-10-13", "DRAFT"],
    ] as const) {
      await seed({ ro: "Alergare de marți", en: "Tuesday run", startsAt: `${day}T15:00:00Z`, editorialStatus });
    }
    // A finished series.
    await seed({ ro: "Ștafeta de vară", en: "Summer relay", startsAt: "2026-08-30T08:00:00Z" });
    await seed({ ro: "Ștafeta de vară", en: "Summer relay", startsAt: "2026-09-20T08:00:00Z" });
    // Single dates, one per state.
    await seed({ ro: "Tură pe Tâmpa", en: "Tâmpa trail run", startsAt: "2026-10-04T06:00:00Z", locationName: "Stația de telecabină Tâmpa" });
    await seed({ ro: "Crosul de toamnă", en: "Autumn cross", startsAt: "2026-11-21T08:00:00Z", editorialStatus: "DRAFT" });
    await seed({ ro: "Maratonul", en: "The marathon", startsAt: "2026-11-01T08:00:00Z", eventStatus: "CANCELLED" });
    await seed({ ro: "Crosul de primăvară", en: "Spring cross", startsAt: "2026-04-01T08:00:00Z", editorialStatus: "ARCHIVED" });
    await seed({ ro: "Semimaratonul", en: "Half marathon", startsAt: "2026-10-02T08:00:00Z", editorialStatus: "IN_REVIEW", eventStatus: "COMPLETED" });
  });

  async function titles(params: Record<string, string>) {
    const rows = await listEventsForBackoffice(db);
    return arrangeEventList(rows, parseEventListQuery(params), NOW, "ro").map(({ next, members }) => {
      const title = next.translations.find((translation) => translation.locale === "ro")?.title;
      return members.length > 1 ? `${title} ×${members.length}` : title;
    });
  }

  it("groups the series into one line each and counts the unfiltered lines", async () => {
    expect(countEventLines(await listEventsForBackoffice(db))).toBe(7);
    expect(await titles({ state: "ALL" })).toHaveLength(7);
  });

  it("opens on «Viitoare» with no state in the address; «Toate» is its own choice (§555)", async () => {
    expect(await titles({})).toEqual(await titles({ state: "UPCOMING" }));
    expect(await titles({})).toHaveLength(3);
    expect(await titles({ state: "ALL" })).toHaveLength(7);
  });

  it("orders by the nearest date by default, a series by its next date, a finished one by its last", async () => {
    expect(await titles({ state: "ALL" })).toEqual([
      "Semimaratonul",
      "Tură pe Tâmpa",
      "Alergare de marți ×4",
      "Maratonul",
      "Crosul de toamnă",
      "Ștafeta de vară ×2",
      "Crosul de primăvară",
    ]);
  });

  it("orders the oldest first, by name both ways, and by state", async () => {
    expect(await titles({ state: "ALL", sort: "date-old" })).toEqual([
      "Crosul de primăvară",
      "Ștafeta de vară ×2",
      "Semimaratonul",
      "Tură pe Tâmpa",
      "Alergare de marți ×4",
      "Maratonul",
      "Crosul de toamnă",
    ]);
    expect(await titles({ state: "ALL", sort: "title-asc" })).toEqual([
      "Alergare de marți ×4",
      "Crosul de primăvară",
      "Crosul de toamnă",
      "Maratonul",
      "Semimaratonul",
      "Ștafeta de vară ×2",
      "Tură pe Tâmpa",
    ]);
    expect((await titles({ state: "ALL", sort: "title-desc" }))[0]).toBe("Tură pe Tâmpa");
    expect(await titles({ state: "ALL", sort: "state" })).toEqual([
      "Crosul de toamnă",
      "Tură pe Tâmpa",
      "Alergare de marți ×4",
      "Ștafeta de vară ×2",
      "Crosul de primăvară",
      "Maratonul",
      "Semimaratonul",
    ]);
  });

  it("filters every state, narrowing a series to its matching dates", async () => {
    expect(await titles({ state: "UPCOMING" })).toEqual(["Tură pe Tâmpa", "Alergare de marți ×2", "Crosul de toamnă"]);
    expect(await titles({ state: "PAST" })).toEqual(["Semimaratonul", "Alergare de marți ×2", "Ștafeta de vară ×2", "Crosul de primăvară"]);
    expect(await titles({ state: "DRAFT" })).toEqual(["Alergare de marți", "Crosul de toamnă"]);
    expect(await titles({ state: "IN_REVIEW" })).toEqual(["Semimaratonul"]);
    expect(await titles({ state: "ARCHIVED" })).toEqual(["Crosul de primăvară"]);
    expect(await titles({ state: "CANCELLED" })).toEqual(["Maratonul"]);
    expect(await titles({ state: "PUBLISHED" })).toHaveLength(4);
    // The label typed for the key is the default list, «Viitoare», never an error (§555).
    expect(await titles({ state: "Încheiate" })).toEqual(["Tură pe Tâmpa", "Alergare de marți ×2", "Crosul de toamnă"]);
  });

  /** Marks one date as the club's main event, as the editor's «Evidențiere pe site» box does (§NNN). */
  async function feature(ro: string, startsAt?: string) {
    const rows = await listEventsForBackoffice(db);
    const row = rows.find(
      ({ event, translations }) =>
        translations.some((translation) => translation.locale === "ro" && translation.title === ro) &&
        (startsAt === undefined || event.startsAt.toISOString() === new Date(startsAt).toISOString()),
    );
    if (!row) throw new Error(`no seeded date ${ro}`);
    await db.update(events).set({ featured: true }).where(eq(events.id, row.event.id));
  }

  describe("§NNN the main event stands first", () => {
    // «Crosul de toamnă» is the last date still to come (21 November, a draft): by the nearest date it is third of three.
    beforeEach(async () => {
      await feature("Crosul de toamnă");
    });

    it("is first in the default list, the others keeping the nearest-date order", async () => {
      expect(await titles({})).toEqual(["Crosul de toamnă", "Tură pe Tâmpa", "Alergare de marți ×2"]);
      expect(await titles({ state: "ALL" })).toEqual([
        "Crosul de toamnă",
        "Semimaratonul",
        "Tură pe Tâmpa",
        "Alergare de marți ×4",
        "Maratonul",
        "Ștafeta de vară ×2",
        "Crosul de primăvară",
      ]);
    });

    it("is first in every order", async () => {
      for (const sort of ["date-near", "date-old", "title-asc", "title-desc", "state"]) {
        expect((await titles({ state: "ALL", sort }))[0]).toBe("Crosul de toamnă");
      }
      expect(await titles({ state: "ALL", sort: "title-asc" })).toEqual([
        "Crosul de toamnă",
        "Alergare de marți ×4",
        "Crosul de primăvară",
        "Maratonul",
        "Semimaratonul",
        "Ștafeta de vară ×2",
        "Tură pe Tâmpa",
      ]);
    });

    it("is listed only where the state and the search match it", async () => {
      expect(await titles({ state: "DRAFT" })).toEqual(["Crosul de toamnă", "Alergare de marți"]);
      expect(await titles({ state: "PUBLISHED" })).not.toContain("Crosul de toamnă");
      expect(await titles({ state: "PAST" })).not.toContain("Crosul de toamnă");
      expect(await titles({ state: "ARCHIVED" })).toEqual(["Crosul de primăvară"]);
      expect(await titles({ q: "tampa" })).toEqual(["Tură pe Tâmpa"]);
      // «cros» finds it, and it leads the other «Cros» (archived) when both are shown.
      expect(await titles({ q: "cros", state: "ALL" })).toEqual(["Crosul de toamnă", "Crosul de primăvară"]);
    });

    it("is one line on the first page, counted once", async () => {
      const lines = arrangeEventList(await listEventsForBackoffice(db), parseEventListQuery({ state: "ALL" }), NOW, "ro");
      expect(lines).toHaveLength(countEventLines(await listEventsForBackoffice(db)));
      // Paged by two, the marked date (third by its date) is on the first page and on no other.
      const pages = [];
      for (let from = 0; from < lines.length; from += 2) pages.push(lines.slice(from, from + 2).map(({ key }) => key));
      expect(pages.length).toBeGreaterThan(1);
      expect(pages[0][0]).toBe(lines[0].key);
      expect(pages.slice(1).flat()).not.toContain(lines[0].key);
      expect(new Set(lines.map(({ key }) => key)).size).toBe(lines.length);
    });
  });

  it("lifts a series' line when the marked date is one of its dates still shown (§NNN)", async () => {
    await feature("Alergare de marți", "2026-10-06T15:00:00Z");
    expect((await titles({ state: "ALL" }))[0]).toBe("Alergare de marți ×4");
    expect((await titles({}))[0]).toBe("Alergare de marți ×2");
    // «Ciorne» holds only the 13 October draft, not the marked date: nothing is lifted.
    expect(await titles({ state: "DRAFT" })).toEqual(["Alergare de marți", "Crosul de toamnă"]);
    // «Încheiate» holds the two dates gone, not the marked one (6 October is still to come).
    expect((await titles({ state: "PAST" }))[0]).toBe("Semimaratonul");
  });

  it("searches either language, the address and the place, accents ignored", async () => {
    expect(await titles({ q: "tampa" })).toEqual(["Tură pe Tâmpa"]);
    expect(await titles({ q: "telecabina" })).toEqual(["Tură pe Tâmpa"]);
    expect(await titles({ q: "relay", state: "ALL" })).toEqual(["Ștafeta de vară ×2"]);
    expect(await titles({ q: "cros", state: "DRAFT" })).toEqual(["Crosul de toamnă"]);
  });
});
