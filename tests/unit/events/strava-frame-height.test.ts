import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stravaEmbedSrc, stravaFrameNamespace, type StravaRouteMap } from "@/modules/events/domain/route-maps";
import { STRAVA_EMBED_ORIGIN, STRAVA_HEIGHT_MAX, STRAVA_HEIGHT_MIN, stravaFrameHeight } from "@/modules/events/domain/strava-frame-height";
import RouteMapPanel from "@/modules/events/ui/RouteMapPanel";

/**
 * BR-REQ-011-01 (§NNN) — Strava's frame is as tall as its card: the height message is believed only
 * from Strava's origin, for this frame's namespace, under its name, as a number kept in a sane range.
 */
const MAP: StravaRouteMap = { provider: "strava", id: "1111222233334444555" };
const NS = stravaFrameNamespace(MAP);
const NAME = "BROADCAST_IFRAME_HEIGHT";
const ORIGIN = "https://example.test";

describe("BR-REQ-011-01 stravaFrameHeight (§NNN)", () => {
  it("reads the height from Strava's origin, our namespace and the message's name", () => {
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 512] }, NS)).toBe(512);
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 511.6] }, NS)).toBe(512);
  });

  it("clamps the number to a sane range", () => {
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 5] }, NS)).toBe(STRAVA_HEIGHT_MIN);
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 99999] }, NS)).toBe(STRAVA_HEIGHT_MAX);
  });

  it("ignores every other message, the page's own included", () => {
    const good = [NS, NAME, 500];
    expect(stravaFrameHeight({ origin: ORIGIN, data: good }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: "https://strava-embeds.com.evil.test", data: good }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: ["another", NAME, 500] }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, "BROADCAST_SETTINGS_CHANGE", 500] }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, "500"] }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, Number.NaN] }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME] }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: { 0: NS } }, NS)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: null }, NS)).toBeNull();
  });

  it("ignores a message that did not come from this frame", () => {
    const frame = {};
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 500], source: {} }, NS, frame)).toBeNull();
    expect(stravaFrameHeight({ origin: STRAVA_EMBED_ORIGIN, data: [NS, NAME, 500], source: frame }, NS, frame)).toBe(500);
  });
});

describe("BR-REQ-011-01 the Strava frame carries its namespace (§NNN)", () => {
  const words = { tab: "Strava", show: "Arată harta pe Strava", notice: "Harta vine de la Strava; Strava vede adresa ta IP.", open: "Deschide în Strava", frame: "Harta" };

  it("puts the namespace in the address and beside the frame, with a fallback that is not 760", () => {
    const url = new URL(stravaEmbedSrc(MAP, ORIGIN));
    expect(new URLSearchParams(url.hash.slice(1)).get("ns")).toBe(NS);
    const html = renderToStaticMarkup(createElement(RouteMapPanel, { map: MAP, words, origin: ORIGIN }));
    expect(html).toContain(`data-strava-ns="${NS}"`);
    expect(html).toContain(encodeURIComponent(NS));
    // The listener goes on before the frame has an address: the frame has `data-src` only, the
    // `<noscript>` copy carries the real `src`, and the island's marker sits beside the frame.
    expect(html).toMatch(/<iframe[^>]*data-src="https:\/\/strava-embeds\.com\/route\//);
    expect(html.match(/<iframe[^>]*data-strava-ns[^>]*>/)?.[0]).not.toMatch(/ src=/);
    expect(html).toMatch(/<noscript>[^]*<iframe[^>]* src="https:\/\/strava-embeds\.com\/route\//);
    expect(html).toContain("<span hidden");
    expect(html).not.toContain("760px");
    expect(html).toContain(words.notice);
  });

  it("draws no namespace on Garmin's frame", () => {
    const html = renderToStaticMarkup(createElement(RouteMapPanel, { map: { provider: "garmin", id: "987654321" }, words, origin: ORIGIN }));
    expect(html).not.toContain("data-strava-ns");
  });
});
