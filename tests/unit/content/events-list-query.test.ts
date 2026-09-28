import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventListBack,
  arrangeEventList,
  countEventLines,
  eventListNarrowed,
  eventListParams,
  eventListQueryInUse,
  type ListedEvent,
  type ListedRow,
  type ListedTranslation,
  matchesEventList,
  parseEventListQuery,
  type SortableLine,
  sortEventLines,
} from "@/modules/content/events/list-query";

/**
 * BR-REQ-060-01, BR-REQ-040-04 (`DECISIONS.md` §NNN): the backoffice events list is searched,
 * filtered by state and ordered by one select, from the address, by a GET form that works
 * without JavaScript, every word in both catalogues.
 */

const NOW = new Date("2026-10-01T09:00:00Z");

const event = (over: Partial<ListedEvent> = {}): ListedEvent => ({
  startsAt: new Date("2026-11-21T08:00:00Z"),
  editorialStatus: "PUBLISHED",
  eventStatus: "SCHEDULED",
  locationName: "Parcul Tractorul",
  ...over,
});

const tr = (title: string, slug = "x", locationName: string | null = null, locale?: string): ListedTranslation => ({ locale, title, slug, locationName });

const TRANSLATIONS = [tr("Crosul Brașovului", "crosul-brasovului", "Poiana"), tr("Brașov Cross", "brasov-cross")];

describe("parseEventListQuery", () => {
  it("defaults to no search, no state and the nearest date first", () => {
    expect(parseEventListQuery({})).toEqual({ q: "", state: null, sort: "date-near" });
  });

  it("keeps known values and ignores unknown ones rather than refusing", () => {
    expect(parseEventListQuery({ q: "  cros  ", state: "DRAFT", sort: "title-desc" })).toEqual({ q: "cros", state: "DRAFT", sort: "title-desc" });
    expect(parseEventListQuery({ state: "NOPE", sort: "DROP TABLE" })).toEqual({ q: "", state: null, sort: "date-near" });
  });

  it("falls back to the whole list when the label is typed for the key (state=Încheiate)", () => {
    expect(parseEventListQuery({ state: "Încheiate" }).state).toBeNull();
    expect(parseEventListQuery({ state: "PAST" }).state).toBe("PAST");
  });

  it("reads the first of a repeated key and cuts a pasted paragraph", () => {
    expect(parseEventListQuery({ state: ["PAST", "DRAFT"] }).state).toBe("PAST");
    expect(parseEventListQuery({ q: "a".repeat(500) }).q).toHaveLength(100);
  });
});

describe("eventListParams", () => {
  it("writes only what differs from the default, so the plain list is the plain address", () => {
    expect(eventListParams(parseEventListQuery({}))).toEqual({ q: undefined, state: undefined, sort: undefined });
    expect(eventListParams(parseEventListQuery({ q: "cros", state: "UPCOMING", sort: "state" }))).toEqual({ q: "cros", state: "UPCOMING", sort: "state" });
  });

  it("says when the list is narrowed (the count line) and when anything is set (clear the filters)", () => {
    expect(eventListQueryInUse(parseEventListQuery({}))).toBe(false);
    expect(eventListQueryInUse(parseEventListQuery({ sort: "title-asc" }))).toBe(true);
    expect(eventListNarrowed(parseEventListQuery({ sort: "title-asc" }))).toBe(false);
    expect(eventListNarrowed(parseEventListQuery({ q: "x" }))).toBe(true);
    expect(eventListNarrowed(parseEventListQuery({ state: "DRAFT" }))).toBe(true);
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

  it("«tampa» finds «Tâmpa»", () => {
    expect(match({ q: "tampa" }, event(), [tr("Tură pe Tâmpa", "tura-pe-tampa")])).toBe(true);
    expect(match({ q: "TÂMPA" }, event(), [tr("Tura pe Tampa", "tura")])).toBe(true);
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
    expect(match({ state: "IN_REVIEW" }, event({ editorialStatus: "IN_REVIEW" }))).toBe(true);
  });

  it("filters a called-off event by its own state, whatever its editorial one", () => {
    expect(match({ state: "CANCELLED" })).toBe(false);
    expect(match({ state: "CANCELLED" }, event({ eventStatus: "CANCELLED" }))).toBe(true);
  });

  it("«Încheiate» is a start that has passed or a date marked completed; a called-off one never", () => {
    const past = event({ startsAt: new Date("2026-09-01T08:00:00Z") });
    expect(match({ state: "PAST" })).toBe(false);
    expect(match({ state: "PAST" }, past)).toBe(true);
    expect(match({ state: "PAST" }, event({ eventStatus: "COMPLETED" }))).toBe(true);
    expect(match({ state: "PAST" }, event({ startsAt: past.startsAt, eventStatus: "CANCELLED" }))).toBe(false);
  });

  it("«Viitoare» is a date still to come that is neither called off nor completed", () => {
    expect(match({ state: "UPCOMING" })).toBe(true);
    expect(match({ state: "UPCOMING" }, event({ startsAt: new Date("2026-09-01T08:00:00Z") }))).toBe(false);
    expect(match({ state: "UPCOMING" }, event({ eventStatus: "CANCELLED" }))).toBe(false);
    expect(match({ state: "UPCOMING" }, event({ eventStatus: "COMPLETED" }))).toBe(false);
  });

  it("asks the search and the state together", () => {
    expect(match({ q: "cros", state: "DRAFT" })).toBe(false);
    expect(match({ q: "cros", state: "PUBLISHED" })).toBe(true);
  });
});

describe("sortEventLines", () => {
  type Line = SortableLine & { id: string };
  const line = (id: string, title: string, startsAt: string, over: Partial<SortableLine> = {}): Line => ({
    id,
    title,
    startsAt: new Date(startsAt),
    editorialStatus: "PUBLISHED",
    eventStatus: "SCHEDULED",
    ...over,
  });
  const lines: Line[] = [
    line("december", "Ștafeta", "2026-12-01T08:00:00Z"),
    line("lastWeek", "Alergare de luni", "2026-09-24T15:00:00Z", { eventStatus: "COMPLETED" }),
    line("soon", "Semimaraton", "2026-10-05T08:00:00Z", { editorialStatus: "DRAFT" }),
    line("spring", "Crosul de primăvară", "2026-04-01T08:00:00Z", { editorialStatus: "ARCHIVED" }),
    line("called", "Maratonul", "2026-11-01T08:00:00Z", { eventStatus: "CANCELLED" }),
  ];
  const ids = (sort: string) => sortEventLines(lines, (item) => item, parseEventListQuery({ sort }), "ro", NOW).map((item) => item.id);

  it("«Data (cele mai apropiate)» by default: what is to come soonest first, then the past, the most recent first", () => {
    expect(ids("")).toEqual(["soon", "called", "december", "lastWeek", "spring"]);
  });

  it("«Data (cele mai vechi)»: the oldest first", () => {
    expect(ids("date-old")).toEqual(["spring", "lastWeek", "soon", "called", "december"]);
  });

  it("«Nume A–Z» and «Nume Z–A» in the reader's language, Ș after S", () => {
    expect(ids("title-asc")).toEqual(["lastWeek", "spring", "called", "soon", "december"]);
    expect(ids("title-desc")).toEqual(["december", "soon", "called", "spring", "lastWeek"]);
  });

  it("«Stare»: the editorial states in the editor's order, then the called-off, then the completed", () => {
    expect(ids("state")).toEqual(["soon", "december", "spring", "called", "lastWeek"]);
  });
});

describe("arrangeEventList — a series is one line, sorted by its next date", () => {
  let counter = 0;
  const row = (title: string, startsAt: string, over: Partial<ListedEvent> = {}): ListedRow => ({
    event: { id: `e${++counter}`, type: "GROUP_RUN", ...event({ startsAt: new Date(startsAt), ...over }) },
    translations: [tr(title, title.toLowerCase().replace(/\s+/g, "-"), null, "ro")],
  });
  const rows: ListedRow[] = [
    // A weekly run: two dates gone, two to come — its line sorts by 2026-10-06.
    row("Alergare de marți", "2026-09-22T15:00:00Z"),
    row("Alergare de marți", "2026-09-29T15:00:00Z"),
    row("Alergare de marți", "2026-10-06T15:00:00Z"),
    row("Alergare de marți", "2026-10-13T15:00:00Z", { editorialStatus: "DRAFT" }),
    // A finished series: its line sorts by its last date, 2026-09-20.
    row("Ștafeta de vară", "2026-08-30T08:00:00Z"),
    row("Ștafeta de vară", "2026-09-20T08:00:00Z"),
    // One race, the soonest single date.
    row("Crosul", "2026-10-03T08:00:00Z"),
  ];
  const arrange = (params: Record<string, string>) => arrangeEventList(rows, parseEventListQuery(params), NOW, "ro");
  const titles = (params: Record<string, string>) => arrange(params).map((line) => line.next.translations[0].title);

  it("groups the dates and picks the next one to come, else the last", () => {
    const lines = arrange({});
    expect(lines).toHaveLength(3);
    const weekly = lines.find((line) => line.members.length === 4);
    expect(weekly?.next.event.startsAt.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    const summer = lines.find((line) => line.next.translations[0].title === "Ștafeta de vară");
    expect(summer?.next.event.startsAt.toISOString()).toBe("2026-09-20T08:00:00.000Z");
  });

  it("orders the lines by their next date, the nearest first, a finished series after what is to come", () => {
    expect(titles({})).toEqual(["Crosul", "Alergare de marți", "Ștafeta de vară"]);
    expect(titles({ sort: "date-old" })).toEqual(["Ștafeta de vară", "Crosul", "Alergare de marți"]);
  });

  it("narrows the dates before grouping, so the series line holds only what matched", () => {
    const drafts = arrange({ state: "DRAFT" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].members).toHaveLength(1);
    const past = arrange({ state: "PAST" });
    expect(past.map((line) => [line.next.translations[0].title, line.members.length])).toEqual([
      ["Alergare de marți", 2],
      ["Ștafeta de vară", 2],
    ]);
  });

  it("counts the unfiltered lines for «N din M evenimente»", () => {
    expect(countEventLines(rows)).toBe(3);
    expect(arrange({ q: "stafeta" })).toHaveLength(1);
  });
});

describe("the events list page wires it (source)", () => {
  const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/(list)/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  const fields = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/EventListFields.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("is one GET form above the list, never folded, with native selects, so it works with JavaScript off", () => {
    expect(page).toContain('component="form"\n        method="get"\n        action={basePath}');
    expect(page).not.toContain("<Panel");
    expect(fields).toContain('name="q"');
    expect(fields).toContain("select: { native: true }");
    expect(page).toContain("EVENT_LIST_STATES.map");
    expect(page).toContain("EVENT_LIST_SORTS.map");
  });

  it("gives every control its glyph, made on the client from its own icon file", () => {
    expect(fields).toContain('import SearchIcon from "@mui/icons-material/Search"');
    expect(fields).toContain('import FilterAltIcon from "@mui/icons-material/FilterAlt"');
    expect(fields).toContain('import SortIcon from "@mui/icons-material/Sort"');
    expect(fields.match(/startAdornment/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("arranges, counts, pages and carries the state on every link; the columns do not sort", () => {
    expect(page).toContain("arrangeEventList(rows, listQuery, now, locale)");
    expect(page).toContain('t("events.listCount", { shown: lines.length, total: allLineCount })');
    expect(page).toContain("rows={pageLines}");
    expect(page).toContain("currentParams={{ ...listParams");
    expect(page).not.toContain("sortable: true");
  });
});

describe("§NNN the list's address through an action's `back`", () => {
  it("round-trips the list's own keys and nothing else", () => {
    const address = "q=tampa&state=DRAFT&sort=title-asc&dir=asc&page=2&perPage=50";
    expect(eventListBack(address)).toBe(address);
    expect(eventListBack(`?${address}`)).toBe(address);
    expect(eventListBack(eventListBack(address))).toBe(address);
  });

  it("drops what is not the list's, and the defaults", () => {
    expect(eventListBack("saved=deleted&error=X&next=//evil&sort=date-near&page=1&perPage=100")).toBe("");
    expect(eventListBack("state=Încheiate&sort=nope&page=-3&perPage=7&dir=up")).toBe("");
    expect(eventListBack("state=PAST&state=DRAFT")).toBe("state=PAST");
    expect(eventListBack("")).toBe("");
  });

  it("reads the page's own search-params record the same way", () => {
    expect(eventListBack({ q: " tâmpa ", state: ["ARCHIVED", "DRAFT"], saved: "x" })).toBe("q=t%C3%A2mpa&state=ARCHIVED");
  });
});
