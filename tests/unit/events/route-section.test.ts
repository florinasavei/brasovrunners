import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { BLANK, courseSummary, type SummaryTranslation, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { identicalTexts, storedTextReader } from "@/modules/content/events/ui/publish-check";
import { EVENT_LINK_KINDS, type EventLinkKind } from "@/modules/events/domain/links";
import { hasRouteDescription, isRouteLinkKind, partitionEventLinks } from "@/modules/events/domain/route-section";
import type { PublicEvent } from "@/modules/events/repository";
import EventLinks from "@/modules/events/ui/EventLinks";
import EventRoute from "@/modules/events/ui/EventRoute";

/**
 * BR-REQ-011-01 (`DECISIONS.md` §387) — "Traseul" / "The route" on the event page, under `#route`:
 * the organizer's route / training description, with the route's own links first — the route link
 * (a Strava route, with Strava's mark), the GPX and the map — which then leave the facts' route row
 * and "Linkuri și fișiere". An event with no description in this language keeps every link where
 * it was. The owner, 2026-09-25: "…basically a free text, might also attach a map there; you can
 * move the GPX and Strava link there."
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");

afterEach(() => {
  currentLocale = "ro";
});

const GPX = ["https:/", "drive.example.test", "file", "d", "gpx", "view"].join("/");
const MAP = ["https:/", "maps.example.test", "tampa"].join("/");
const PDF = ["https:/", "files.example.test", "regulament.pdf"].join("/");
const ALBUM = ["https:/", "photos.example.test", "album"].join("/");
const RESULTS = ["https:/", "results.example.test", "2026"].join("/");
const OTHER = ["https:/", "forms.example.test", "voluntari"].join("/");
const STRAVA_ROUTE = ["https:/", "www.strava.com", "routes", "123"].join("/");
const STRAVA_EVENT = ["https:/", "www.strava.com", "clubs", "1", "group_events", "2"].join("/");

/** One link of every kind, in the club's order. */
const EVERY_KIND = [
  { kind: "DOCUMENT", url: PDF, labelRo: null, labelEn: null },
  { kind: "GPX", url: GPX, labelRo: "Traseul de 8 km", labelEn: "The 8 km route" },
  { kind: "PHOTOS", url: ALBUM, labelRo: null, labelEn: null },
  { kind: "MAP", url: MAP, labelRo: null, labelEn: null },
  { kind: "RESULTS", url: RESULTS, labelRo: null, labelEn: null },
  { kind: "OTHER", url: OTHER, labelRo: null, labelEn: null },
];

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const DESCRIPTION_RO = doc("Oprire cu apă la km 4, apoi urcarea pe serpentine.");
/** A map and nothing else: no words, no alt text, no caption — the editor and the save count it as content. */
const MAP_PICTURE_SRC = "/api/media/0123abcd-0123-4abc-8def-0123456789ab/web.webp";
const MAP_ONLY = { type: "doc", content: [{ type: "image", attrs: { src: MAP_PICTURE_SRC, alt: "" } }] };
const DESCRIPTION_EN = doc("Water stop at km 4, then the climb up the switchbacks.");

const words = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Event;
const kindLabels = (locale: "ro" | "en") => words(locale).links.kinds as Record<EventLinkKind, string>;

const routeSection = (descriptionJson: unknown, { locale = "ro", routeUrl = null as string | null, links = EVERY_KIND as unknown } = {}) =>
  renderToStaticMarkup(
    createElement(EventRoute, {
      descriptionJson,
      links,
      routeUrl,
      locale: locale as "ro" | "en",
      heading: words(locale as "ro" | "en").routeSection,
      openRouteLabel: words(locale as "ro" | "en").openRoute,
      kindLabels: kindLabels(locale as "ro" | "en"),
    }),
  );

const linksSection = (routeSectionShown: boolean, links: unknown = EVERY_KIND, locale: "ro" | "en" = "ro") =>
  renderToStaticMarkup(createElement(EventLinks, { links, locale, heading: words(locale).links.heading, kindLabels: kindLabels(locale), routeSection: routeSectionShown }));

const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);

describe("BR-REQ-011-01 which links belong to the route (§387)", () => {
  it("says for every kind which side it is on: the GPX and the map are the route's, the rest are not", () => {
    const route = EVENT_LINK_KINDS.filter(isRouteLinkKind);
    expect(route).toEqual(["GPX", "MAP"]);
    expect(EVENT_LINK_KINDS.filter((kind) => !isRouteLinkKind(kind))).toEqual(["DOCUMENT", "PHOTOS", "RESULTS", "OTHER"]);
  });

  it("splits a stored list between the route section and «Linkuri și fișiere», each in the club's order", () => {
    const { route, other } = partitionEventLinks(EVERY_KIND, true);
    expect(route.map((link) => link.kind)).toEqual(["GPX", "MAP"]);
    expect(other.map((link) => link.kind)).toEqual(["DOCUMENT", "PHOTOS", "RESULTS", "OTHER"]);
    // Every link lands on exactly one side.
    expect([...route, ...other].map((link) => link.url).sort()).toEqual(EVERY_KIND.map((link) => link.url).sort());
  });

  it("keeps every link in «Linkuri și fișiere» when there is no route section", () => {
    const { route, other } = partitionEventLinks(EVERY_KIND, false);
    expect(route).toEqual([]);
    expect(other.map((link) => link.kind)).toEqual(EVERY_KIND.map((link) => link.kind));
    expect(partitionEventLinks(null, true)).toEqual({ route: [], other: [] });
  });

  it("counts a description as present only when it has words or a picture", () => {
    expect(hasRouteDescription(null)).toBe(false);
    expect(hasRouteDescription(undefined)).toBe(false);
    expect(hasRouteDescription({ type: "doc", content: [] })).toBe(false);
    expect(hasRouteDescription({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(hasRouteDescription(DESCRIPTION_RO)).toBe(true);
    expect(hasRouteDescription(MAP_ONLY)).toBe(true);
  });

  it("renders the section for a description that is only a map picture with no alt text", () => {
    const html = routeSection(MAP_ONLY, { routeUrl: STRAVA_ROUTE });
    expect(html).toContain('id="route"');
    expect(html).toContain(MAP_PICTURE_SRC);
    expect(hrefs(html)).toEqual([STRAVA_ROUTE, GPX, MAP]);
  });
});

describe("BR-REQ-011-01 the «Traseul» section (§387)", () => {
  it("renders under #route: the heading, the route's links first, then the text", () => {
    const html = routeSection(DESCRIPTION_RO, { routeUrl: STRAVA_ROUTE });
    expect(html).toContain('id="route"');
    expect(html).toMatch(/<h2[^>]*>Traseul<\/h2>/);
    expect(hrefs(html)).toEqual([STRAVA_ROUTE, GPX, MAP]);
    expect(html).toContain("Vezi traseul");
    expect(html).toContain("Traseul de 8 km");
    expect(html).toContain("Harta traseului");
    expect(html.indexOf(`href="${MAP}"`)).toBeLessThan(html.indexOf("Oprire cu apă"));
    // Nothing of «Linkuri și fișiere»'s other kinds.
    for (const url of [PDF, ALBUM, RESULTS, OTHER]) expect(html).not.toContain(url);
  });

  it("draws the route's links as «Linkuri și fișiere» draws them: a new tab, 44 pixels, the host beneath", () => {
    const html = routeSection(DESCRIPTION_RO, { routeUrl: STRAVA_ROUTE });
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    expect(html).toContain("drive.example.test");
    expect(html).toContain("strava.com");
    expect(html).toMatch(/min-height:44px/);
    // A Strava route wears Strava's own mark; any other route link, the route glyph.
    expect(html).toContain('fill="#FC4C02"');
    expect(routeSection(DESCRIPTION_RO, { routeUrl: MAP, links: [] })).not.toContain('fill="#FC4C02"');
  });

  it("speaks the reader's language: the English page's heading, words and kinds", () => {
    const html = routeSection(DESCRIPTION_EN, { locale: "en", routeUrl: STRAVA_ROUTE });
    expect(html).toMatch(/<h2[^>]*>The route<\/h2>/);
    expect(html).toContain("View the route");
    expect(html).toContain("The 8 km route");
    expect(html).toContain("Route map");
    expect(html).toContain("Water stop at km 4");
    expect(html).not.toContain("Traseul");
  });

  it("renders nothing at all without a description — no heading, no anchor, no links", () => {
    expect(routeSection(null, { routeUrl: STRAVA_ROUTE })).toBe("");
    expect(routeSection({ type: "doc", content: [] }, { routeUrl: STRAVA_ROUTE })).toBe("");
  });

  it("renders the text alone when the event has no route link and no route kinds", () => {
    const html = routeSection(DESCRIPTION_RO, { links: [{ kind: "DOCUMENT", url: PDF, labelRo: null, labelEn: null }] });
    expect(html).toContain('id="route"');
    expect(hrefs(html)).toEqual([]);
    expect(html).toContain("Oprire cu apă");
  });
});

describe("BR-REQ-011-01 criterion 20 «Linkuri și fișiere» beside a route section (§387)", () => {
  it("keeps the other kinds and drops the GPX and the map", () => {
    const html = linksSection(true);
    expect(hrefs(html)).toEqual([PDF, ALBUM, RESULTS, OTHER]);
  });

  it("hides itself when the route section took every link", () => {
    expect(linksSection(true, EVERY_KIND.filter((link) => link.kind === "GPX" || link.kind === "MAP"))).toBe("");
  });

  it("is unchanged without a route section: every link, the GPX included", () => {
    expect(hrefs(linksSection(false))).toEqual(EVERY_KIND.map((link) => link.url));
  });
});

/** An event page's row for the facts, with the route link, the Strava and Facebook events. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-10-07T16:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: STRAVA_ROUTE,
    stravaEventUrl: STRAVA_EVENT,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 8000,
    elevationGainMeters: 250,
    nightOverride: null,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "running-up-that-hill",
    title: "Running up that hill",
    excerpt: "Urcăm pe Tâmpa.",
    locationName: "Stația de telecabină Tâmpa",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: "MODERATE",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    routeDescriptionJson: null,
    publishedAt: new Date("2026-09-01T09:00:00Z"),
    ...overrides,
  } as PublicEvent;
}

const facts = async (overrides: Partial<PublicEvent> = {}) =>
  renderToStaticMarkup(await EventFacts({ event: event(overrides), now: new Date("2026-09-25T10:00:00Z"), stacked: true })).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

describe("BR-REQ-011-01 the facts' route row points at the section (§387)", () => {
  it("without a description: the route link stays in the row, as before", async () => {
    const html = await facts();
    expect(html).toContain(`href="${STRAVA_ROUTE}"`);
    expect(html).not.toContain('href="#route"');
  });

  it("with one: the row links to #route instead, and keeps the Strava event, which is not the route", async () => {
    currentLocale = "en";
    const html = await facts({ routeDescriptionJson: DESCRIPTION_EN });
    expect(html).not.toContain(`href="${STRAVA_ROUTE}"`);
    expect(html).toMatch(/<a\b[^>]*href="#route"[^>]*>[\s\S]*?About the route<\/a>/);
    expect(html).toContain(`href="${STRAVA_EVENT}"`);
    // The jump is a thumb's target too.
    expect(html).toMatch(/href="#route"[^>]*data-testid="route-jump"|data-testid="route-jump"[^>]*href="#route"/);
  });
});

describe("BR-REQ-050-02 the «Traseul» card says it on its closed line and warns of the same words (§387)", () => {
  const summaryWords = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Admin.editor.boxes.summary as SummaryWords;
  const course = { distanceMeters: 8000, elevationGainMeters: 250, routeUrl: STRAVA_ROUTE, nightOverride: null };
  const labels = { surface: "Trail", difficulty: "Mediu" };
  const language = (locale: string, routeDescriptionJson: unknown): SummaryTranslation => ({
    locale,
    title: "Running up that hill",
    slug: "x",
    excerpt: null,
    excerptJson: null,
    bodyJson: null,
    rulesJson: null,
    scheduleJson: null,
    routeDescriptionJson,
    checklist: null,
    locationName: null,
  });
  const long = doc("Oprire cu apă la km 4, apoi urcarea pe serpentine până la creastă.");

  it("«cu descriere» / «with a description» when written in both languages", () => {
    // §NNN: `labels.night` is not `true` here (automatic, unstated), so «de zi (automat)» names it.
    expect(courseSummary(summaryWords("ro"), course, labels, [language("ro", DESCRIPTION_RO), language("en", DESCRIPTION_EN)])).toBe(
      "Trail · Mediu · 8 km · +250 m · de zi (automat) · traseu · cu descriere",
    );
    expect(courseSummary(summaryWords("en"), course, { surface: "Trail", difficulty: "Moderate" }, [language("ro", DESCRIPTION_RO), language("en", DESCRIPTION_EN)])).toBe(
      "Trail · Moderate · 8 km · +250 m · day (automatic) · route · with a description",
    );
  });

  it("names a description in one language only — the text the next save refuses — and says nothing when there is none", () => {
    expect(courseSummary(summaryWords("ro"), course, labels, [language("ro", DESCRIPTION_RO), language("en", null)])).toContain("descriere într-o singură limbă");
    expect(courseSummary(summaryWords("ro"), course, labels, [language("ro", null), language("en", null)])).toBe("Trail · Mediu · 8 km · +250 m · de zi (automat) · traseu");
    // A caller from before the description passes no languages, and reads as before.
    expect(courseSummary(summaryWords("ro"), course, labels)).toBe("Trail · Mediu · 8 km · +250 m · de zi (automat) · traseu");
  });

  it("marks the English tab «identic» when it copies the Romanian, and lists it in Publicare (§354)", () => {
    const translations = [language("ro", long), language("en", long)];
    expect(courseSummary(summaryWords("ro"), course, labels, translations)).toContain("EN identic cu RO");
    expect(BLANK.route(language("ro", null))).toBe(true);
    const found = identicalTexts(storedTextReader(translations, []), ["ro", "en"]);
    expect(found).toEqual([{ box: "course", field: "routeDescription", locale: "en", name: "translations.en.routeDescription" }]);
  });
});

describe("BR-REQ-011-01 where the section sits (§387)", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("on the public page: after the facts and the registration button, before «Linkuri și fișiere» and the programme", () => {
    const page = read("src/app/[locale]/events/[slug]/page.tsx");
    const route = page.indexOf("<EventRoute");
    expect(route).toBeGreaterThan(page.indexOf("<EventFacts"));
    expect(route).toBeGreaterThan(page.indexOf("<RegistrationCta"));
    expect(route).toBeLessThan(page.indexOf("<EventLinks"));
    expect(route).toBeLessThan(page.indexOf("<EventProgramme"));
    expect(page).toContain("routeSection={hasRouteDescription(event.routeDescriptionJson)}");
  });

  it("in the staff preview: the same order, the same words", () => {
    const preview = read("src/app/[locale]/preview/events/[id]/page.tsx");
    const route = preview.indexOf("<EventRoute");
    expect(route).toBeGreaterThan(preview.indexOf("<EventFacts"));
    expect(route).toBeLessThan(preview.indexOf("<EventLinks"));
    expect(preview).toContain("routeDescriptionJson: translation.routeDescriptionJson");
    expect(preview).toContain("routeSection={hasRouteDescription(preview.routeDescriptionJson)}");
  });

  it("leaves the calendar file, the structured data and the email templates without it", () => {
    // render.ts reads `routeDescriptionJson` too (§387, review round): the "Linkuri și fișiere"
    // line must agree with the page's own split (`partitionEventLinks`) about which links are
    // still in "Linkuri și fișiere" once a route section has taken the GPX and the map out of it.
    for (const file of ["src/modules/events/ical.ts", "src/modules/events/structured-data.ts", "src/modules/notifications/templates.ts"]) {
      expect(read(file), file).not.toContain("routeDescription");
    }
  });
});
