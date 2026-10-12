import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { courseSummary, linksSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import type { EventLinkKind } from "@/modules/events/domain/links";
import { hasRouteSection } from "@/modules/events/domain/route-section";
import EventRoute, { type RouteMapWords } from "@/modules/events/ui/EventRoute";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-011-01 (§718) — «Traseul» on the page: Garmin Connect and Strava in tabs, Strava first (§738), each
 * map behind its own press and its link beside it; one service alone with no tabs; the GPX below,
 * with or without a map. The page draws the links and the iframes from the stored ids only, and an
 * iframe sits inside a closed `<details>` — the facade that keeps the browser from asking Strava or
 * Garmin for anything until the visitor presses (the e2e spec proves the network side).
 */
const STRAVA_ID = "1111222233334444555";
const GARMIN_ID = "987654321";
const TOKEN = "abc123def456abc123def456abc123def456abcd";
const BOTH = [
  { provider: "strava", id: STRAVA_ID, style: "hybrid", mapHash: "11.66/45.6375/25.5935", token: TOKEN },
  { provider: "garmin", id: GARMIN_ID },
];
const GPX = { key: "test/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/tampa.gpx", name: "Tâmpa.gpx", size: 300 * 1024, uploadedAt: "2026-10-11T10:00:00.000Z" };

const words = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Event;

const render = (props: { routeMaps?: unknown; routeGpx?: unknown; routeUrl?: string | null; descriptionJson?: unknown }, locale: "ro" | "en" = "ro") =>
  renderToStaticMarkup(
    withClientWords(
      createElement(EventRoute, {
        descriptionJson: props.descriptionJson ?? null,
        links: null,
        routeUrl: props.routeUrl ?? null,
        routeMaps: props.routeMaps,
        routeGpx: props.routeGpx,
        locale,
        heading: words(locale).routeSection,
        openRouteLabel: words(locale).openRoute,
        kindLabels: words(locale).links.kinds as Record<EventLinkKind, string>,
        mapWords: words(locale).routeMaps as RouteMapWords,
      }),
      locale,
    ),
  );

/** Every iframe, with whether it sits inside a `<details>` that is not open. */
const iframes = (html: string) => [...html.matchAll(/<iframe\b[^>]*>/g)].map((match) => match[0]);

describe("BR-REQ-011-01 the maps on the page (§718)", () => {
  it("draws Garmin Connect and Strava as tabs, Strava first (§738), with the right roles, and the first one chosen", () => {
    const html = render({ routeMaps: BOTH });
    expect(html).toContain('role="tablist"');
    expect(html).toContain(`aria-label="${ro.Event.routeMaps.tabs}"`);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0]);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('data-route-map-tab="strava"');
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(tabs[0]).toContain('aria-controls="route-map-panel-strava"');
    expect(tabs[1]).toContain('data-route-map-tab="garmin"');
    expect(tabs[1]).toContain('aria-selected="false"');
    expect(tabs[1]).toContain('tabindex="-1"');
    expect(html).toContain('role="tabpanel" id="route-map-panel-garmin" aria-labelledby="route-map-tab-garmin"');
    expect(html).toContain('role="tabpanel" id="route-map-panel-strava" aria-labelledby="route-map-tab-strava"');
  });

  it("puts every map's iframe inside a closed disclosure, lazy, sandboxed, built from the stored ids", () => {
    const html = render({ routeMaps: BOTH });
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    const frames = iframes(html);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toContain('loading="lazy"');
      expect(frame).toMatch(/referrerpolicy="strict-origin"/i);
      expect(frame).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    }
    expect(frames.join(" ")).toContain(`src="https://connect.garmin.com/embed/course/${GARMIN_ID}"`);
    expect(frames.join(" ")).toContain(`https://strava-embeds.com/route/${STRAVA_ID}?style=hybrid&amp;fromEmbed=false&amp;token=${TOKEN}`);
    // Each iframe is after its own summary, inside its own details.
    for (const provider of ["garmin", "strava"]) {
      const panel = html.slice(html.indexOf(`data-route-map-panel="${provider}"`));
      expect(panel.indexOf("<details")).toBeLessThan(panel.indexOf("<summary"));
      expect(panel.indexOf("<summary")).toBeLessThan(panel.indexOf("<iframe"));
      expect(panel.indexOf("<iframe")).toBeLessThan(panel.indexOf("</details>"));
    }
    // No provider script, ever.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("embed.js");
  });

  it("says what the press loads and links to each route on the service, in both languages", () => {
    for (const locale of ["ro", "en"] as const) {
      const html = render({ routeMaps: BOTH }, locale);
      const w = words(locale).routeMaps;
      for (const provider of ["garmin", "strava"] as const) {
        expect(html).toContain(w[provider].show);
        expect(html).toContain(w[provider].notice);
        expect(html).toContain(w[provider].open);
      }
      expect(html).toContain(`href="https://www.strava.com/routes/${STRAVA_ID}"`);
      expect(html).toContain(`href="https://connect.garmin.com/modern/course/${GARMIN_ID}"`);
    }
  });

  it("draws one service alone without tabs", () => {
    const html = render({ routeMaps: [{ provider: "strava", id: STRAVA_ID }] });
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).toContain('data-testid="route-map-strava"');
    expect(iframes(html)).toHaveLength(1);
  });

  it("never renders anything the stored value carries beyond the patterns", () => {
    const html = render({ routeMaps: [{ provider: "garmin", id: `1"><script>alert(1)</script>` }, { provider: "strava", id: STRAVA_ID, token: `"><img src=x>` }] });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(iframes(html)).toHaveLength(1);
  });

  it("does not draw the route link twice when it is the Strava map's own route", () => {
    const html = render({ routeMaps: BOTH, routeUrl: `https://www.strava.com/routes/${STRAVA_ID}` });
    expect(html).not.toContain(ro.Event.openRoute);
    const other = render({ routeMaps: BOTH, routeUrl: "https://www.strava.com/routes/42" });
    expect(other).toContain(ro.Event.openRoute);
  });
});

describe("BR-REQ-011-01 the GPX on the page (§718)", () => {
  it("draws «Descarcă traseul (GPX)» under the maps, with its name and size, as a download", () => {
    const html = render({ routeMaps: BOTH, routeGpx: GPX });
    const link = /<a[^>]*data-testid="route-gpx-download"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain(`/api/media/${GPX.key}`);
    expect(link).toContain('download="tampa.gpx"');
    expect(html).toContain(ro.Event.routeMaps.gpx);
    expect(html).toContain("Tâmpa.gpx · 300 KB");
    expect(html.indexOf('data-testid="route-gpx-download"')).toBeGreaterThan(html.indexOf('data-testid="route-map-tabs"'));
  });

  it("draws the section for a GPX alone, and nothing for an event with no description, no map and no file", () => {
    const html = render({ routeGpx: GPX });
    expect(html).toContain('id="route"');
    expect(html).toContain(ro.Event.routeMaps.gpx);
    expect(html).not.toContain('role="tablist"');
    expect(render({ routeGpx: GPX }, "en")).toContain(en.Event.routeMaps.gpx);
    expect(render({})).toBe("");
    expect(hasRouteSection({ routeMaps: BOTH }, true)).toBe(true);
    expect(hasRouteSection({ routeGpx: GPX }, true)).toBe(true);
    expect(hasRouteSection({ routeMaps: [{ provider: "komoot", id: "1" }], routeGpx: { key: "elsewhere" } }, true)).toBe(false);
  });
});

describe("BR-REQ-050-02 the editor's «Traseul» card (§718)", () => {
  it("says on its closed line which maps are set, and «Linkuri și fișiere» counts the file", () => {
    const summary = ro.Admin.editor.boxes.summary as unknown as SummaryWords;
    const line = courseSummary(summary, { distanceMeters: null, elevationGainMeters: null, routeUrl: null, nightOverride: false, routeMaps: BOTH }, { surface: null });
    expect(line).toContain("Garmin");
    expect(line).toContain("Strava");
    expect(line.indexOf("Strava")).toBeLessThan(line.indexOf("Garmin"));
    // The file is said as «GPX încărcat» / "GPX uploaded", never a bare «GPX» that reads like a link's kind.
    expect(linksSummary(summary, { stravaEventUrl: null, facebookEventUrl: null, links: null, routeGpx: GPX }, {}, "ro")).toBe("GPX încărcat");
    const summaryEn = en.Admin.editor.boxes.summary as unknown as SummaryWords;
    expect(linksSummary(summaryEn, { stravaEventUrl: null, facebookEventUrl: null, links: null, routeGpx: GPX }, {}, "en")).toBe("GPX uploaded");
    expect(linksSummary(summary, { stravaEventUrl: null, facebookEventUrl: null, links: null, routeGpx: null }, {}, "ro")).toBe("Niciun link");
  });

  it("asks for the two services in the course card, Garmin first, and the file in «Linkuri și fișiere», above the rows", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/boxes/CourseBox.tsx"), "utf8");
    expect(source.indexOf('name="event.routeGarmin"')).toBeGreaterThan(source.indexOf('name="event.routeUrl"'));
    expect(source.indexOf('name="event.routeStrava"')).toBeGreaterThan(source.indexOf('name="event.routeGarmin"'));
    expect(source).not.toContain("event.routeGpx");
    const links = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/boxes/LinksBox.tsx"), "utf8");
    expect(links.indexOf('name="event.routeGpx"')).toBeGreaterThan(0);
    expect(links.indexOf('name="event.routeGpx"')).toBeLessThan(links.indexOf("<LinkRowsEditor"));
    const rows = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/LinkRowsEditor.tsx"), "utf8");
    expect(rows).toContain("ROUTE_GPX_INPUT_ID");
  });
});
