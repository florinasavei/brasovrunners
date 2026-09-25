import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLANK_PAGE_SECTION_DATA,
  numberedPageSections,
  PAGE_SECTION_IDS,
  PAGE_SECTIONS,
  type PageSectionData,
  type PageSectionId,
  pageSectionNumber,
  pageSectionStates,
} from "@/modules/events/domain/page-sections";

/**
 * §NNN — the event editor mirrors the page. The owner, 2026-09-25: "am nevoie de mai multe căsuțe
 * la editor ca să văd exact ce flow am în pagină."
 *
 * One list (`events/domain/page-sections.ts`) names the page's sections top to bottom; the public
 * page is the source of truth for that order, and the editor writes its cards in it on both pages.
 * These tests read the page and the two editor pages as source — Server Components rendering what
 * they are handed, like the rest of this folder's order tests — and fail the moment either order
 * parts from the list.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const PAGE = read("src/app/[locale]/events/[slug]/page.tsx");
const FACTS = read("src/modules/events/ui/EventFacts.tsx");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");

const ids = PAGE_SECTIONS.map((section) => section.id);

/**
 * What the public page draws, in its order, each marker with the section it belongs to. The facts
 * are expanded into their own rows, in `EventFacts`' order on the page (after the listing card's
 * branch), since four sections live among them.
 */
function pageSequence(): PageSectionId[] {
  const pageMarkers: Array<[string, PageSectionId | "facts" | null]> = [
    ['variant="overline"', "kind"],
    ['variant="h1"', "title"],
    ["<EventDescription ", "description"],
    ["<EventFacts ", "facts"],
    ["<DeclarationOffer ", "course"],
    ["<RegistrationCta ", "registration"],
    ["<ShareLinks", "share"],
    ["<EventRoute", "course"],
    ["<EventLinks", "links"],
    ["<EventProgramme ", "programme"],
    ['id="rules"', "rules"],
    ["<EventVideo ", "video"],
    ["<StartList ", "startList"],
  ];
  const pageBranch = FACTS.slice(FACTS.indexOf("/* ---- The event page"));
  const factMarkers: Array<[string, PageSectionId]> = [
    ['key: "when"', "when"],
    ['key: "where"', "place"],
    ['key: "route"', "course"],
    ['key: "cost"', "registration"],
    ['key: "age"', "registration"],
    ['key: "coHost"', "coHosts"],
  ];
  const at = (source: string, needle: string) => {
    const index = source.indexOf(needle);
    expect(index, `${needle} is drawn`).toBeGreaterThan(-1);
    return index;
  };
  const facts = factMarkers.map(([needle, id]) => ({ at: at(pageBranch, needle), id })).sort((a, b) => a.at - b.at);
  const sequence: PageSectionId[] = [];
  for (const { id } of pageMarkers.map(([needle, id]) => ({ at: at(PAGE, needle), id })).sort((a, b) => a.at - b.at)) {
    if (id === "facts") sequence.push(...facts.map((fact) => fact.id));
    else if (id) sequence.push(id);
  }
  return sequence;
}

/** Each section where the page first draws something of it. */
const firstAppearances = (sequence: readonly PageSectionId[]) => sequence.filter((id, index) => sequence.indexOf(id) === index);

describe("§NNN the page's sections, one list", () => {
  it("names every section once, in the order of the ids", () => {
    expect(ids).toEqual([...PAGE_SECTION_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is the public page's own order: each section where the page first draws what its card holds", () => {
    expect(firstAppearances(pageSequence())).toEqual(ids);
  });

  it("numbers the cards 1 to 13 in that order, and gives the automatic share links none", () => {
    const numbered = numberedPageSections();
    expect(numbered.filter((section) => section.number !== null).map((section) => section.number)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(numbered.find((section) => section.id === "share")).toMatchObject({ automatic: true, card: null, number: null });
    expect(pageSectionNumber("kind")).toBe(1);
    expect(pageSectionNumber("links")).toBe(9);
    expect(pageSectionNumber("startList")).toBe(13);
  });

  it("gives every card section the id of the card the editor draws for it", () => {
    const boxes = ["KindBox", "TextBoxes", "WhenBox", "PlaceBox", "CourseBox", "RegistrationBox", "CoHostsBox", "LinksBox", "ProgrammeBox", "VideoBox", "StartListBox"]
      .map((file) => read(`src/modules/content/events/ui/boxes/${file}.tsx`))
      .join("\n");
    for (const section of PAGE_SECTIONS) {
      if (section.card === null) continue;
      expect(boxes, section.id).toMatch(new RegExp(`id(?:=|: )"${section.card}"`));
    }
  });
});

/** The editor's cards, in the order a page writes them, by the section each one's heading is for. */
const EDITOR_CARDS: Array<[string, PageSectionId]> = [
  ["<KindBox ", "kind"],
  ["<TitleSummaryBox ", "title"],
  ["<DescriptionBox ", "description"],
  ["<WhenBox ", "when"],
  ["<PlaceBox ", "place"],
  ["<CourseBox ", "course"],
  ["<RegistrationBox", "registration"],
  ["<CoHostsBox ", "coHosts"],
  ["<AutomaticSection ", "share"],
  ["<LinksBox ", "links"],
  ["<ProgrammeBox ", "programme"],
  ["<RulesBox ", "rules"],
  ["<VideoBox ", "video"],
  ["<StartListBox ", "startList"],
];

describe("§NNN the editor lays its cards out in the page's order, on both pages", () => {
  for (const [name, source] of [
    ["edit", EDIT],
    ["create", CREATE],
  ] as const) {
    it(`${name}: one card per section, in the list's order, each headed by its section`, () => {
      const positions = EDITOR_CARDS.map(([needle, id]) => {
        const index = source.indexOf(needle);
        expect(index, `${name}: ${needle}`).toBeGreaterThan(-1);
        expect(source.split(needle).length - 1, `${name}: ${needle} once`).toBe(1);
        return { index, id };
      });
      expect(positions.sort((a, b) => a.index - b.index).map((entry) => entry.id)).toEqual(ids);
      for (const [needle, id] of EDITOR_CARDS) {
        if (id === "share") continue;
        const start = source.indexOf(needle);
        const tag = source.slice(start, source.indexOf("/>", start));
        expect(tag, `${name}: ${needle}`).toContain(`heading={flow.headings.${id}}`);
      }
      // The share links are named where the page draws them, never a card.
      expect(source).toContain('<AutomaticSection testId="automatic-share">{flow.automaticLine}</AutomaticSection>');
    });

    it(`${name}: the cards that are not on the page come after, in a group of their own`, () => {
      const offPage = source.indexOf('t("editor.groups.offPage")');
      expect(offPage).toBeGreaterThan(source.indexOf("<StartListBox "));
      for (const card of ["<StatusBox ", "<PromotionBox ", "<AddressBox "]) {
        expect(source.indexOf(card), `${name}: ${card}`).toBeGreaterThan(offPage);
      }
      expect(source.indexOf('t("editor.groups.page")')).toBeLessThan(source.indexOf("<KindBox "));
    });

    it(`${name}: the map sits under Publicare and Recurență`, () => {
      expect(source.indexOf('id="box-map"')).toBeGreaterThan(source.indexOf('id="box-recurrence"'));
      expect(source.indexOf('id="box-map"')).toBeLessThan(source.indexOf("main={"));
      expect(source).toContain("<SectionMap entries={flow.entries} words={flow.words} label={flow.label} />");
    });
  }
});

/** A saved event with nothing optional in it. */
const bare = (): PageSectionData => ({
  event: { ...BLANK_PAGE_SECTION_DATA.event, costType: null },
  texts: [{ title: "Crosul Tâmpei", bodyJson: null, rulesJson: null, scheduleJson: null, routeDescriptionJson: null, locationName: null }],
});
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const drawn = (data: PageSectionData) =>
  Object.fromEntries(pageSectionStates(data).map((section) => [section.id, section.isDrawn])) as Record<PageSectionId, boolean>;

describe("§NNN whether the page draws each section", () => {
  it("draws the type, the title, the date and the share links of a bare event, and nothing else", () => {
    const states = drawn(bare());
    expect(Object.entries(states).filter(([, on]) => on).map(([id]) => id)).toEqual(["kind", "title", "when", "share"]);
  });

  it("reads each section from the columns the page reads", () => {
    const data = bare();
    data.event = {
      ...data.event,
      locationName: "Parcul Tractorul",
      distanceMeters: 10_000,
      costType: "FREE",
      coHosts: [{ name: "Brașov Running Festival", links: [] }],
      stravaEventUrl: "https://strava.example.test/e/1",
      scheduleItems: [{ startsAt: "2026-11-21T07:00:00.000Z", endsAt: null, label: { ro: "Start", en: "Start" }, place: null }],
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      participantListVisibility: "NAMES",
    };
    data.texts = [{ ...data.texts[0], bodyJson: doc("Despre"), rulesJson: doc("Reguli") }];
    const states = drawn(data);
    for (const id of PAGE_SECTION_IDS) expect(states[id], id).toBe(true);
  });

  it("draws the place while it is to be announced, and the course from a route description alone", () => {
    const data = bare();
    data.event = { ...data.event, locationToBeAnnounced: true };
    data.texts = [{ ...data.texts[0], routeDescriptionJson: doc("Urcăm pe Tâmpa") }];
    expect(drawn(data)).toMatchObject({ place: true, course: true });
  });

  it("draws no registration for a group run that states no cost, and one for a race registering here", () => {
    expect(drawn(bare()).registration).toBe(false);
    const race = bare();
    race.event = { ...race.event, type: "RACE", registrationMode: "INTERNAL" };
    expect(drawn(race).registration).toBe(true);
    const groupRun = bare();
    groupRun.event = { ...groupRun.event, registrationMode: "INTERNAL" };
    expect(drawn(groupRun).registration).toBe(false);
  });

  it("draws no film for a link YouTube cannot play, and no list while it is hidden", () => {
    const data = bare();
    data.event = { ...data.event, videoUrl: "https://vimeo.example.test/1", participantListVisibility: "HIDDEN" };
    expect(drawn(data)).toMatchObject({ video: false, startList: false });
  });

  it("starts a new event as the create page opens it: a free group run with no title yet", () => {
    const states = drawn(BLANK_PAGE_SECTION_DATA);
    expect(Object.entries(states).filter(([, on]) => on).map(([id]) => id)).toEqual(["kind", "when", "registration", "share"]);
  });
});
