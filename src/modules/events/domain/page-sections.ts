import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { readCoHosts } from "./co-hosts";
import { type EventType, takesRegistrations } from "./event-type";
import { readEventLinks } from "./links";
import { hasRouteDescription } from "./route-section";
import { readScheduleItems } from "./schedule";
import { youtubeVideoId } from "./video";

/**
 * The event page's sections, top to bottom — the one list the public page is drawn in and the
 * event editor lays its cards out by (§NNN; the owner, 2026-09-25: "am nevoie de mai multe căsuțe
 * la editor ca să văd exact ce flow am în pagină").
 *
 * **The page's own order, as a list.** `app/[locale]/events/[slug]/page.tsx` draws the overline,
 * the title, the description, the facts (when, where, the route, the cost and who may enter, the
 * partners), the registration button, the share links, then `#route`, `#links`, `#schedule`,
 * `#rules`, the film and the start list. A section's place here is where the page first draws
 * something its card holds. The page does not import this list — it is drawn by hand, no table of
 * elements (`AGENTS.md` §1.3) — so `tests/unit/events/page-sections.test.ts` reads the page as
 * source and fails the moment the two orders part; that test is what holds them equal. The editor
 * writes its cards out in this order on both pages, and the same test holds it to it too.
 *
 * **Numbers** are the page's: a card is "4 · Data și ora" because it is the fourth thing the page
 * draws that the club writes. An automatic section — the share links, drawn from the page's own
 * address — has no card and no number; the editor's map names it as automatic.
 *
 * **Drawn** answers, from the stored event and its languages, whether the page shows the section
 * at all: the card's title says "apare pe pagină" or "gol, nu apare pe pagină", and the map's dot
 * is filled or empty. A language is enough — both-or-neither (§352) keeps the two together — so a
 * section is drawn when some language's page draws it. The same rules the page's components follow
 * before they return nothing (`EventLinks`, `EventProgramme`, `EventVideo`, `StartList`, …), read
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
  "registration",
  "coHosts",
  "share",
  "links",
  "programme",
  "rules",
  "video",
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
  | "registration"
  | "partner"
  | "share"
  | "links"
  | "programme"
  | "rules"
  | "video"
  | "startList";

/** What the predicates read of the event row: the stored columns, nothing computed. */
export type PageSectionEvent = {
  type: EventType;
  surface: string | null;
  difficulty: string | null;
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
  videoUrl: string | null;
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
  // "Când" — every event has a date.
  { id: "when", card: "box-when", anchor: null, glyph: "when", automatic: false, drawn: () => true },
  // "Unde": the place, its address and its map — or "to be announced" (§328), which is drawn too.
  {
    id: "place",
    card: "box-place",
    anchor: null,
    glyph: "place",
    automatic: false,
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
      event.difficulty !== null ||
      event.distanceMeters !== null ||
      event.elevationGainMeters !== null ||
      written(event.routeUrl) ||
      night ||
      texts.some((text) => hasRouteDescription(text.routeDescriptionJson)),
  },
  /*
    "Cost", who may enter, and the button (`RegistrationCta`): the cost row is the first of them the
    page draws. A group run takes no registration (§111); an event with no cost stated and nobody
    to register draws none of it.
  */
  {
    id: "registration",
    card: "box-registration",
    anchor: null,
    glyph: "registration",
    automatic: false,
    drawn: ({ event }) => event.costType !== null || (takesRegistrations(event.type) && event.registrationMode !== "NONE"),
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
  // The programme (`#schedule`, §96, §117): the timed rows, or the text.
  {
    id: "programme",
    card: "box-programme",
    anchor: "schedule",
    glyph: "programme",
    automatic: false,
    drawn: (data) => readScheduleItems(data.event.scheduleItems).length > 0 || inSomeLanguage(data, (text) => hasDoc(text.scheduleJson)),
  },
  // The rules (`#rules`).
  { id: "rules", card: "box-rules", anchor: "rules", glyph: "rules", automatic: false, drawn: (data) => inSomeLanguage(data, (text) => hasDoc(text.rulesJson)) },
  // Last year's film (§69): the stored link an older event carries; a new film is a figure in the description (§266).
  { id: "video", card: "box-video", anchor: null, glyph: "video", automatic: false, drawn: ({ event }) => youtubeVideoId(event.videoUrl) !== null },
  // The public participant list (BR-REQ-039-01): only where the event publishes one.
  { id: "startList", card: "box-start-list", anchor: null, glyph: "startList", automatic: false, drawn: ({ event }) => event.participantListVisibility === "NAMES" },
];

/** A section with its place on the page: its number, or null for an automatic one. */
export type NumberedPageSection = PageSection & { number: number | null };

/** Every section with its number, counting only those with a card. */
export function numberedPageSections(): NumberedPageSection[] {
  let next = 0;
  return PAGE_SECTIONS.map((section) => ({ ...section, number: section.automatic ? null : (next += 1) }));
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
 * What the create page's event is before anything is typed: a group run, free (§398), no place,
 * nothing else. The create page shows the same numbers and states from it, so the two pages read
 * alike; its states are those of an event saved as it opens.
 */
export const BLANK_PAGE_SECTION_DATA: PageSectionData = {
  event: {
    type: "GROUP_RUN",
    surface: null,
    difficulty: null,
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
    videoUrl: null,
    participantListVisibility: "HIDDEN",
  },
  texts: [],
  night: false,
};
