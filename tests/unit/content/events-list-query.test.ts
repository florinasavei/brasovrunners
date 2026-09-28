import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventListParams,
  eventListQueryInUse,
  type ListedEvent,
  type ListedTranslation,
  matchesEventList,
  parseEventListQuery,
  sortEventLines,
} from "@/modules/content/events/list-query";

/**
 * BR-REQ-050-02 criterion 103 (§NNN): the backoffice events list is searched, filtered by state
 * and ordered from the address, by a GET form that works without JavaScript.
 */

const NOW = new Date("2026-10-01T09:00:00Z");

const event = (over: Partial<ListedEvent> = {}): ListedEvent => ({
  startsAt: new Date("2026-11-21T08:00:00Z"),
  editorialStatus: "PUBLISHED",
  eventStatus: "SCHEDULED",
  locationName: "Parcul Tractorul",
  ...over,
});

const tr = (title: string, slug = "x", locationName: string | null = null): ListedTranslation => ({ title, slug, locationName });

const TRANSLATIONS = [tr("Crosul Brașovului", "crosul-brasovului", "Poiana"), tr("Brașov Cross", "brasov-cross")];

describe("parseEventListQuery", () => {
  it("defaults to no search, no state and the club's order", () => {
    expect(parseEventListQuery({})).toEqual({ q: "", state: null, sort: "club", dir: "asc" });
  });

  it("keeps known values and ignores unknown ones rather than refusing", () => {
    expect(parseEventListQuery({ q: "  cros  ", state: "DRAFT", sort: "title", dir: "desc" })).toEqual({
      q: "cros",
      state: "DRAFT",
      sort: "title",
      dir: "desc",
    });
    expect(parseEventListQuery({ state: "NOPE", sort: "DROP TABLE", dir: "sideways" })).toEqual({ q: "", state: null, sort: "club", dir: "asc" });
  });

  it("gives each order its own first direction when the address leaves dir out or empty", () => {
    expect(parseEventListQuery({ sort: "date" }).dir).toBe("asc");
    expect(parseEventListQuery({ sort: "title", dir: "" }).dir).toBe("asc");
    expect(parseEventListQuery({ sort: "entries" }).dir).toBe("desc");
  });

  it("reads the first of a repeated key and cuts a pasted paragraph", () => {
    expect(parseEventListQuery({ state: ["PAST", "DRAFT"] }).state).toBe("PAST");
    expect(parseEventListQuery({ q: "a".repeat(500) }).q).toHaveLength(100);
  });
});

describe("eventListParams", () => {
  it("writes only what differs from the default, so the plain list is the plain address", () => {
    expect(eventListParams(parseEventListQuery({}))).toEqual({ q: undefined, state: undefined, sort: undefined, dir: undefined });
    expect(eventListParams(parseEventListQuery({ q: "cros", state: "UPCOMING", sort: "entries", dir: "desc" }))).toEqual({
      q: "cros",
      state: "UPCOMING",
      sort: "entries",
      dir: undefined,
    });
    expect(eventListParams(parseEventListQuery({ sort: "date", dir: "desc" })).dir).toBe("desc");
  });

  it("says when the list is narrowed or reordered", () => {
    expect(eventListQueryInUse(parseEventListQuery({}))).toBe(false);
    expect(eventListQueryInUse(parseEventListQuery({ sort: "title" }))).toBe(true);
    expect(eventListQueryInUse(parseEventListQuery({ q: "x" }))).toBe(true);
  });
});

describe("matchesEventList", () => {
  const match = (params: Record<string, string>, ev = event(), translations = TRANSLATIONS) =>
    matchesEventList(ev, translations, parseEventListQuery(params), NOW);

  it("finds a title in either language, accents and case ignored", () => {
    expect(match({ q: "brasov" })).toBe(true);
    expect(match({ q: "CROSUL" })).toBe(true);
    expect(match({ q: "cross brasov" })).toBe(true);
    expect(match({ q: "maraton" })).toBe(false);
  });

  it("finds the page address and the place, the event's own or a language's", () => {
    expect(match({ q: "brasov-cross" })).toBe(true);
    expect(match({ q: "tractorul" })).toBe(true);
    expect(match({ q: "poiana" })).toBe(true);
  });

  it("filters by the editorial state", () => {
    expect(match({ state: "PUBLISHED" })).toBe(true);
    expect(match({ state: "DRAFT" })).toBe(false);
    expect(match({ state: "DRAFT" }, event({ editorialStatus: "DRAFT" }))).toBe(true);
  });

  it("filters a called-off event by its own state, whatever its editorial one", () => {
    expect(match({ state: "CANCELLED" })).toBe(false);
    expect(match({ state: "CANCELLED" }, event({ eventStatus: "CANCELLED" }))).toBe(true);
  });

  it("filters upcoming and past by the start", () => {
    const past = event({ startsAt: new Date("2026-09-01T08:00:00Z") });
    expect(match({ state: "UPCOMING" })).toBe(true);
    expect(match({ state: "PAST" })).toBe(false);
    expect(match({ state: "PAST" }, past)).toBe(true);
    expect(match({ state: "UPCOMING" }, past)).toBe(false);
  });

  it("asks the search and the state together", () => {
    expect(match({ q: "cros", state: "DRAFT" })).toBe(false);
    expect(match({ q: "cros", state: "PUBLISHED" })).toBe(true);
  });
});

describe("sortEventLines", () => {
  type Line = { id: string; title: string; startsAt: Date; entries: number };
  const lines: Line[] = [
    { id: "featured", title: "Ștafeta", startsAt: new Date("2026-12-01T08:00:00Z"), entries: 3 },
    { id: "soon", title: "Alergare de luni", startsAt: new Date("2026-10-05T15:00:00Z"), entries: 40 },
    { id: "later", title: "Semimaraton", startsAt: new Date("2026-11-01T08:00:00Z"), entries: 3 },
  ];
  const ids = (params: Record<string, string>) => sortEventLines(lines, (line) => line, parseEventListQuery(params), "ro").map((line) => line.id);

  it("keeps the club's order by default", () => {
    expect(ids({})).toEqual(["featured", "soon", "later"]);
    expect(ids({ dir: "desc" })).toEqual(["featured", "soon", "later"]);
  });

  it("orders by date, soonest first unless asked otherwise", () => {
    expect(ids({ sort: "date" })).toEqual(["soon", "later", "featured"]);
    expect(ids({ sort: "date", dir: "desc" })).toEqual(["featured", "later", "soon"]);
  });

  it("orders titles in the reader's language, Ș after S", () => {
    expect(ids({ sort: "title" })).toEqual(["soon", "later", "featured"]);
  });

  it("orders by registrations, most first, a tie kept in the club's order", () => {
    expect(ids({ sort: "entries" })).toEqual(["soon", "featured", "later"]);
    expect(ids({ sort: "entries", dir: "asc" })).toEqual(["featured", "later", "soon"]);
  });
});

describe("the events list page wires it (source)", () => {
  const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/(list)/page.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("is a GET form with native selects, so it works with JavaScript off", () => {
    expect(page).toContain('component="form" method="get" action={basePath}');
    expect(page).toContain('name="q"');
    expect(page).toContain('name="state"');
    expect(page).toContain('name="sort"');
    expect(page.match(/select: \{ native: true \}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("filters before grouping, orders the lines, pages them and carries the state on every link", () => {
    expect(page).toContain("matchesEventList(row.event, row.translations, listQuery, now)");
    expect(page).toContain("sortEventLines(");
    expect(page).toContain("rows={pageLines}");
    expect(page).toContain("currentParams={{ ...listParams");
  });
});
