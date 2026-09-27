import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { readCoHosts } from "./co-hosts";
import { difficultyLevelOf } from "./difficulty";
import { type EventType, takesRegistrations } from "./event-type";
import { readEventLinks } from "./links";
import { hasRouteDescription } from "./route-section";
import { readScheduleItems } from "./schedule";

/**
 * The event page's sections, top to bottom — the one list the public page is drawn in and the
 * event editor lays its cards out by (§406; the owner, 2026-09-25: "am nevoie de mai multe căsuțe
 * la editor ca să văd exact ce flow am în pagină").
 *
 * **The page's own order, as a list.** `app/[locale]/events/[slug]/page.tsx` draws the overline,
 * the title, the description, the facts (when, where, the route, the cost, who may enter, the
 * partners), the registration button, the share links, then `#route`, `#links`, `#schedule`,
 * `#rules` and the start list — a film is a figure in the description since §481, the page's own
 * film section (§69) gone and its stored links moved into the descriptions (migration `0092`). A section's place here is where the page first draws
 * something its card holds. The page does not import this list — it is drawn by hand, no table of
 * elements (`AGENTS.md` §1.3) — so `tests/unit/events/page-sections.test.ts` reads the page as
 * source and fails the moment the two orders part; that test is what holds them equal. The editor
 * writes its cards out in this order on both pages, and the same test holds it to it too.
 *
 * **Numbers** are the page's: a card is "4 · Când și unde" because it is the fourth thing the page
 * draws that the club writes. An automatic section — the share links, drawn from the page's own
 * address — has no card and no number; the editor's map names it as automatic.
 *
 * **Drawn** answers, from the stored event and its languages, whether the page shows the section
 * at all: the card's title says "apare pe pagină" or "gol, nu apare pe pagină", and the map's dot
 * is filled or empty. A language is enough — both-or-neither (§352) keeps the two together — so a
 * section is drawn when some language's page draws it. The same rules the page's components follow
 * before they return nothing (`EventLinks`, `EventProgramme`, `StartList`, …), read
 * from the columns rather than re-rendered.
 *
 * Pure and free of React, so the public page, the editor, the map island and a test read the same
 * thing.
 */

/** The ids of the page's sections, in page order. */
export const PAGE_SECTION_IDS = [
  "kind",
  "title",
  "description",
  "when",
  "place",
  "course",
  "cost",
  "registration",
  "coHosts",
  "share",
  "links",
  "programme",
  "rules",
  "startList",
] as const;

export type PageSectionId = (typeof PAGE_SECTION_IDS)[number];

/**
 * A section's glyph, by name: the editor's map and cards draw it from their own table
 * (`content/events/ui/section-glyphs.ts`), so this file names a picture without importing one.
 */
export type PageSectionGlyph =
  | "kind"
  | "title"
  | "description"
  | "when"
  | "place"
  | "course"
  | "cost"
  | "registration"
  | "partner"
  | "share"
  | "links"
  | "programme"
  | "rules"
  | "startList";

/** What the predicates read of the event row: the stored columns, nothing computed. */
export type PageSectionEvent = {
  type: EventType;
  surface: string | null;
  /** The level on the club's scale of fifteen (§NNN), the difficulty's one column; absent on a cached row from before it. */
  difficultyLevel?: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  routeUrl: string | null;
  stravaEventUrl: string | null;
  facebookEventUrl: string | null;
  links: unknown;
  locationName: string | null;
  locationAddress: string | null;
  mapUrl: string | null;
  locationToBeAnnounced: boolean;
  costType: string | null;
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  coHosts: unknown;
  coHostName: string | null;
  coHostUrl: string | null;
  scheduleItems: unknown;
  participantListVisibility: string | null;
};

/** What the predicates read of one language. */
export type PageSectionText = {
  title: string;
  bodyJson: unknown;
  rulesJson: unknown;
  scheduleJson: unknown;
  routeDescriptionJson?: unknown;
  locationName?: string | null;
};

/**
 * Whether this occurrence is a night event (§394): the caller's own `clubNightEvent(event).night`,
 * the same answer the headlamp pill (`route-pills.ts`) and the card's closed line (`CourseBox`)
 * draw — computed outside this file, since it needs the occurrence's own start against the sun,
 * not merely the stored columns `PageSectionEvent` carries.
 */
export type PageSectionData = { event: PageSectionEvent; texts: readonly PageSectionText[]; night: boolean };

export type PageSection = {
  id: PageSectionId;
  /** The editor card that writes it (`#box-…`), or null for an automatic section. */
  card: `box-${string}` | null;
  /** The page's own anchor for it, where it has one (`/evenimente/x#route`). */
  anchor: string | null;
  glyph: PageSectionGlyph;
  /** Drawn by the page from its own address, with nothing for the club to write: no card. */
  automatic: boolean;
  /** Whether the page draws it for this event. */
  drawn: (data: PageSectionData) => boolean;
  /**
   * The section whose editor card holds this one's card (§466, §481): the page draws it in its own
   * place, but the editor asks it inside another card, so it has no number and no chip on the map —
   * the cost inside «Ce fel de eveniment», the place inside «Când și unde», the rules and the public
   * list (§512) inside «Program, regulament și declarație». The holding card is drawn when any is (`cardStates`).
   */
  nestedIn?: PageSectionId;
};

const written = (value: string | null | undefined) => (value ?? "").trim() !== "";
const hasDoc = (json: unknown) => json !== null && json !== undefined && hasRichTextContent(readRichText(json));
const inSomeLanguage = (data: PageSectionData, test: (text: PageSectionText) => boolean) => data.texts.some(test);

export const PAGE_SECTIONS: readonly PageSection[] = [
  // The overline: the type, always, with its glyph (§112).
  { id: "kind", card: "box-kind", anchor: null, glyph: "kind", automatic: false, drawn: () => true },
  // The page's h1.
  { id: "title", card: "box-title", anchor: null, glyph: "title", automatic: false, drawn: (data) => inSomeLanguage(data, (text) => written(text.title)) },
  // The long description; with none, the page shows the summary in its place (`EventDescription`).
  { id: "description", card: "box-description", anchor: null, glyph: "description", automatic: false, drawn: (data) => inSomeLanguage(data, (text) => hasDoc(text.bodyJson)) },
  // "Când" — every event has a date. The editor's «Când și unde» (§481; the owner, 2026-09-27: "date
  // and location can be on the same card") asks the date, the place and the time zone in one card.
  { id: "when", card: "box-when", anchor: null, glyph: "when", automatic: false, drawn: () => true },
  // "Unde": the place, its address and its map — or "to be announced" (§328), which is drawn too.
  // Asked inside «Când și unde» since §481: `#box-place` is the place's part of that card.
  {
    id: "place",
    card: "box-place",
    anchor: null,
    glyph: "place",
    automatic: false,
    nestedIn: "when",
    drawn: ({ event, texts }) =>
      event.locationToBeAnnounced ||
      written(event.locationName) ||
      written(event.locationAddress) ||
      written(event.mapUrl) ||
      texts.some((text) => written(text.locationName)),
  },
  /*
    "Traseu": the pills, the route link, and further down the route section (`#route`, §387) — the
    course card holds all three, so it sits where the first of them is drawn, in the facts. The
    surface alone is drawn too, in the overline beside the type. The night pill is one of the
    route's pills (`routePillParts`, §394), so a night event with nothing else filled in still
    draws the row.
  */
  {
    id: "course",
    card: "box-course",
    anchor: "route",
    glyph: "course",
    automatic: false,
    drawn: ({ event, texts, night }) =>
      event.surface !== null ||
      difficultyLevelOf(event) !== null ||
      event.distanceMeters !== null ||
      event.elevationGainMeters !== null ||
      written(event.routeUrl) ||
      night ||
      texts.some((text) => hasRouteDescription(text.routeDescriptionJson)),
  },
  // "Cost" (§343, §356): its own row in the facts, on every type, while a cost is stated. The
  // editor asks it inside card 1, «Ce fel de eveniment», since §466 (the owner, 2026-09-26:
  // "cardul 7. Cost poate fi inclus în cardul 1"), so it has no number and no chip of its own.
  { id: "cost", card: "box-cost", anchor: null, glyph: "cost", automatic: false, nestedIn: "kind", drawn: ({ event }) => event.costType !== null },
  /*
    Who may enter and the button (`RegistrationCta`), under the cost row. A group run takes no
    registration (§111) and draws neither; a race with no registration open still draws the row —
    EventFacts shows "no registration needed" rather than a button (~EventFacts.tsx:918), so this
    predicate mirrors EventFacts' own — `registrationMode` decides what the row says, never
    whether it is drawn.
  */
  {
    id: "registration",
    card: "box-registration",
    anchor: null,
    glyph: "registration",
    automatic: false,
    drawn: ({ event }) => takesRegistrations(event.type),
  },
  // "Împreună cu": each partner's card, the last of the facts (§344).
  { id: "coHosts", card: "box-cohosts", anchor: null, glyph: "partner", automatic: false, drawn: ({ event }) => readCoHosts(event).length > 0 },
  // Facebook, WhatsApp, Instagram and the calendar (§90, §107): from the page's own address.
  { id: "share", card: null, anchor: null, glyph: "share", automatic: true, drawn: () => true },
  /*
    "Linkuri și fișiere" (`#links`, §332). The card also holds the Strava and Facebook events, which
    the page draws in the route row, so either makes it drawn.
  */
  {
    id: "links",
    card: "box-links",
    anchor: "links",
    glyph: "links",
    automatic: false,
    drawn: ({ event }) => readEventLinks(event.links).length > 0 || written(event.stravaEventUrl) || written(event.facebookEventUrl),
  },
  // The programme (`#schedule`, §96, §117): the timed rows, or the text. The editor's «Program,
  // regulament și declarație» (§481; the owner, 2026-09-27: "Programul, regulamentul și declarația
  // la fel pe același card") holds the programme, the rules and the declaration as three cards.
  {
    id: "programme",
    card: "box-programme",
    anchor: "schedule",
    glyph: "programme",
    automatic: false,
    drawn: (data) => readScheduleItems(data.event.scheduleItems).length > 0 || inSomeLanguage(data, (text) => hasDoc(text.scheduleJson)),
  },
  // The rules (`#rules`), a card inside «Program, regulament și declarație» since §481.
  {
    id: "rules",
    card: "box-rules",
    anchor: "rules",
    glyph: "rules",
    automatic: false,
    nestedIn: "programme",
    drawn: (data) => inSomeLanguage(data, (text) => hasDoc(text.rulesJson)),
  },
  // The public participant list (BR-REQ-039-01): only where the event publishes one.
  //
  // Left as the switch alone, not also `publicListStillOpen` (§421, finding (11) of the fix
  // round on `feat/registration-consent-and-terms`): the editor's page map has no `now` or the
  // club's deadlines to consult, and it says "drawn", not "drawn right now" — the list the club
  // switched on stays marked drawn on the map after the club's period has closed it on the
  // public page, the way every other still-true fact does. Wiring the deadlines through here
  // would tell the editor something the public page already tells a visitor more plainly.
  //
  // Asked inside «Program, regulament și declarație» since §512 (after the declaration, the last
  // of its cards, as the page draws the list last): no number and no chip of its own.
  {
    id: "startList",
    card: "box-start-list",
    anchor: null,
    glyph: "startList",
    automatic: false,
    nestedIn: "programme",
    drawn: ({ event }) => event.participantListVisibility === "NAMES",
  },
];

/** A section with its place on the page: its number, or null for an automatic one. */
export type NumberedPageSection = PageSection & { number: number | null };

/** Every section with its number, counting only those with a top-level card (a nested one, §466, has none). */
export function numberedPageSections(): NumberedPageSection[] {
  let next = 0;
  return PAGE_SECTIONS.map((section) => ({ ...section, number: section.automatic || section.nestedIn ? null : (next += 1) }));
}

/** The number a section's card wears ("4 · Data și ora"); an automatic section has none. */
export function pageSectionNumber(id: PageSectionId): number | null {
  return numberedPageSections().find((section) => section.id === id)?.number ?? null;
}

/** Each section's number and whether the page draws it, for one event. */
export function pageSectionStates(data: PageSectionData): Array<NumberedPageSection & { isDrawn: boolean }> {
  return numberedPageSections().map((section) => ({ ...section, isDrawn: section.drawn(data) }));
}

/**
 * Each editor card — every section not nested in another's card — with whether the page draws
 * anything it holds (§481): «Când și unde» is drawn when the date or the place is, «Program,
 * regulament și declarație» when the programme, the rules or the public list (§512) is. The card's heading and its chip on
 * the map read this; a nested section's own `isDrawn` stays in `pageSectionStates`.
 */
export function cardStates(data: PageSectionData): Array<NumberedPageSection & { isDrawn: boolean }> {
  const states = pageSectionStates(data);
  return states
    .filter((section) => !section.nestedIn)
    .map((section) => ({
      ...section,
      isDrawn: section.isDrawn || states.some((nested) => nested.nestedIn === section.id && nested.isDrawn),
    }));
}

/**
 * What the create page's event is before anything is typed: a group run, free (§398), no place,
 * nothing else. The create page shows the same numbers and states from it, so the two pages read
 * alike; its states are those of an event saved as it opens.
 */
export const BLANK_PAGE_SECTION_DATA: PageSectionData = {
  event: {
    type: "GROUP_RUN",
    surface: null,
    difficultyLevel: null,
    distanceMeters: null,
    elevationGainMeters: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    links: null,
    locationName: null,
    locationAddress: null,
    mapUrl: null,
    locationToBeAnnounced: false,
    costType: "FREE",
    registrationMode: "NONE",
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    scheduleItems: null,
    participantListVisibility: "HIDDEN",
  },
  texts: [],
  night: false,
};
