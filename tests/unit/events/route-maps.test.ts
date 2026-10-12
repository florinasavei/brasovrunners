import { describe, expect, it } from "vitest";
import {
  garminEmbedSrc,
  parseGarminCourse,
  parseStravaRoute,
  readRouteMaps,
  routeMapFieldValue,
  routeMapLink,
  routeMapsToStore,
  routeUrlIsStravaMap,
  stravaEmbedSrc,
} from "@/modules/events/domain/route-maps";

/**
 * BR-REQ-011-01 (§718) — «Traseul»'s Strava and Garmin Connect maps: what the club pastes — the
 * route's link or the service's embed code — is read down to the id and, for Strava, three values
 * on strict patterns; anything else is refused, and the page builds the link and the map's address
 * from those values alone. Every id and token here is invented: the repository is public.
 */
const STRAVA_ID = "1111222233334444555";
const GARMIN_ID = "987654321";
const TOKEN = "abc123def456abc123def456abc123def456abcd";
const ORIGIN = "https://club.example.test";

/** Strava's share menu, as the owner pasted its shape: the placeholder and its script. */
const stravaEmbed = (attributes: string, script = `<script src="https://strava-embeds.com/embed.js"></script>`) =>
  `<div class="strava-embed-placeholder" ${attributes}></div>${script}`;
const STRAVA_EMBED = stravaEmbed(
  `data-embed-type="route" data-embed-id="${STRAVA_ID}" data-style="hybrid" data-map-hash="11.66/45.6375/25.5935" data-from-embed="false" data-token="${TOKEN}"`,
);
/** Garmin's share menu, its quotes as mixed as Garmin writes them. */
const GARMIN_EMBED = `<iframe src=https://connect.garmin.com/embed/course/${GARMIN_ID} width='465' height='548' title='Course Embed'></iframe>`;

describe("BR-REQ-011-01 the Strava field (§718)", () => {
  it("reads the route's link, with or without www, a trailing slash or a query", () => {
    for (const link of [
      `https://www.strava.com/routes/${STRAVA_ID}`,
      `https://strava.com/routes/${STRAVA_ID}/`,
      `https://www.strava.com/routes/${STRAVA_ID}?share=1#map`,
      `  https://www.strava.com/routes/${STRAVA_ID}  `,
    ]) {
      expect(parseStravaRoute(link), link).toEqual({ ok: true, map: { provider: "strava", id: STRAVA_ID } });
    }
  });

  it("reads the embed code down to the id, the style, the map's view and the token — and keeps nothing else", () => {
    expect(parseStravaRoute(STRAVA_EMBED)).toEqual({
      ok: true,
      map: { provider: "strava", id: STRAVA_ID, style: "hybrid", mapHash: "11.66/45.6375/25.5935", token: TOKEN },
    });
    // Without the script tag, with single quotes, on several lines: the same map.
    const multiline = `<div class='strava-embed-placeholder'\n  data-embed-type='route' data-embed-id='${STRAVA_ID}'\n  data-style='standard'></div>`;
    expect(parseStravaRoute(multiline)).toEqual({ ok: true, map: { provider: "strava", id: STRAVA_ID, style: "standard" } });
  });

  it("is empty for an empty box", () => {
    expect(parseStravaRoute("")).toEqual({ ok: true, map: null });
    expect(parseStravaRoute("   ")).toEqual({ ok: true, map: null });
    expect(parseStravaRoute(undefined)).toEqual({ ok: true, map: null });
  });

  it("refuses another host, another page of Strava, a non-https or a javascript: address", () => {
    for (const input of [
      `https://evil.example.test/routes/${STRAVA_ID}`,
      `https://www.strava.com.evil.example.test/routes/${STRAVA_ID}`,
      `https://www.strava.com/activities/${STRAVA_ID}`,
      `https://www.strava.com/routes/${STRAVA_ID}/edit`,
      `https://www.strava.com/routes/abc`,
      `http://www.strava.com/routes/${STRAVA_ID}`,
      `javascript:alert(1)//www.strava.com/routes/${STRAVA_ID}`,
      `https://user:pass@www.strava.com/routes/${STRAVA_ID}`,
    ]) {
      expect(parseStravaRoute(input).ok, input).toBe(false);
    }
  });

  it("refuses an embed with an extra attribute, an event handler, another script or another element", () => {
    for (const input of [
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}" onclick="alert(1)"`),
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}" style="position:fixed"`),
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}"`, `<script src="https://evil.example.test/embed.js"></script>`),
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}"`, `<script>alert(1)</script>`),
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}"`, `<script src="https://strava-embeds.com/embed.js" onload="x()"></script>`),
      `${stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}"`)}<img src=x onerror=alert(1)>`,
      `<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="${STRAVA_ID}"><b>x</b></div>`,
      `<span class="strava-embed-placeholder" data-embed-type="route" data-embed-id="${STRAVA_ID}"></span>`,
      stravaEmbed(`data-embed-type="activity" data-embed-id="${STRAVA_ID}"`),
      stravaEmbed(`data-embed-type="route" data-embed-id="12ab"`),
      stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}" data-embed-id="1"`),
      `<div class="other" data-embed-type="route" data-embed-id="${STRAVA_ID}"></div>`,
    ]) {
      expect(parseStravaRoute(input).ok, input).toBe(false);
    }
  });

  it("refuses a value off its pattern: an over-long token, a token with a quote or a space, a map hash with words, a style with a digit", () => {
    for (const attributes of [
      `data-token="${"a".repeat(65)}"`,
      `data-token="abc def"`,
      `data-token="abc&amp;x=1"`,
      `data-map-hash="11/45.6/25.5;alert(1)"`,
      `data-map-hash="javascript:1"`,
      `data-style="hybrid2"`,
      `data-from-embed="maybe"`,
    ]) {
      const input = stravaEmbed(`data-embed-type="route" data-embed-id="${STRAVA_ID}" ${attributes}`);
      expect(parseStravaRoute(input).ok, attributes).toBe(false);
    }
    expect(parseStravaRoute(`https://www.strava.com/routes/${"1".repeat(2001)}`)).toEqual({ ok: false, reason: "tooLong" });
  });
});

describe("BR-REQ-011-01 the Garmin Connect field (§718)", () => {
  it("reads the course's link in both of Garmin's shapes, the embed address and the embed code", () => {
    for (const input of [
      `https://connect.garmin.com/modern/course/${GARMIN_ID}`,
      `https://connect.garmin.com/app/course/${GARMIN_ID}`,
      `https://connect.garmin.com/embed/course/${GARMIN_ID}`,
      GARMIN_EMBED,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}" width="465" height="548" frameborder="0"></iframe>`,
      `<iframe src='https://connect.garmin.com/embed/course/${GARMIN_ID}' title="Cursa Brașov: Ștefan's" style='border:0' scrolling='no' allow='fullscreen' referrerpolicy='no-referrer' allowtransparency='true'></iframe>`,
    ]) {
      expect(parseGarminCourse(input), input).toEqual({ ok: true, map: { provider: "garmin", id: GARMIN_ID } });
    }
  });

  it("refuses an id with letters, another host, an iframe with a handler or a srcdoc, or anything around the iframe", () => {
    for (const input of [
      `https://connect.garmin.com/modern/course/12a34`,
      `https://connect.garmin.com/modern/activity/${GARMIN_ID}`,
      `https://connect.garmin.com.evil.example.test/modern/course/${GARMIN_ID}`,
      `https://evil.example.test/embed/course/${GARMIN_ID}`,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}" onload="alert(1)"></iframe>`,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}" srcdoc="<script>alert(1)</script>"></iframe>`,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}?x=1"></iframe>`,
      `<iframe src="javascript:alert(1)"></iframe>`,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}"></iframe><script>alert(1)</script>`,
      `<script src="https://connect.garmin.com/embed/course/${GARMIN_ID}"></script>`,
      `<iframe src="https://connect.garmin.com/embed/course/${GARMIN_ID}" width="100;x"></iframe>`,
    ]) {
      expect(parseGarminCourse(input).ok, input).toBe(false);
    }
  });
});

describe("BR-REQ-011-01 what the page builds from the stored ids (§718)", () => {
  const strava = { provider: "strava" as const, id: STRAVA_ID, style: "hybrid", mapHash: "11.66/45.6375/25.5935", token: TOKEN };

  it("links to the route on the service, from the id alone", () => {
    expect(routeMapLink(strava)).toBe(`https://www.strava.com/routes/${STRAVA_ID}`);
    expect(routeMapLink({ provider: "garmin", id: GARMIN_ID })).toBe(`https://connect.garmin.com/modern/course/${GARMIN_ID}`);
  });

  it("builds the iframe address embed.js would have built — never the script itself — and sends no page path", () => {
    expect(garminEmbedSrc(GARMIN_ID)).toBe(`https://connect.garmin.com/embed/course/${GARMIN_ID}`);
    const src = stravaEmbedSrc(strava, ORIGIN);
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe(`https://strava-embeds.com/route/${STRAVA_ID}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ style: "hybrid", fromEmbed: "false", token: TOKEN });
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("hostOrigin")).toBe(ORIGIN);
    expect(fragment.get("mapHash")).toBe("11.66/45.6375/25.5935");
    expect(fragment.has("hostPath")).toBe(false);
    expect(fragment.has("hostTitle")).toBe(false);
    expect(src).not.toContain("embed.js");
  });

  it("shows every Strava route on the hybrid map, whatever style the pasted code chose (§NNN)", () => {
    const standard = new URL(stravaEmbedSrc({ provider: "strava", id: STRAVA_ID, style: "standard" }, ORIGIN));
    expect(standard.searchParams.get("style")).toBe("hybrid");
    const none = new URL(stravaEmbedSrc({ provider: "strava", id: STRAVA_ID }, ORIGIN));
    expect(none.searchParams.get("style")).toBe("hybrid");
  });

  it("gives the editor back a value that saves to the same map, so a second save never drops the token", () => {
    for (const map of [strava, { provider: "strava" as const, id: STRAVA_ID }, { provider: "garmin" as const, id: GARMIN_ID }]) {
      const value = routeMapFieldValue(map);
      const parsed = map.provider === "strava" ? parseStravaRoute(value) : parseGarminCourse(value);
      expect(parsed, value).toEqual({ ok: true, map });
    }
    expect(routeMapFieldValue(undefined)).toBe("");
  });

  it("reads the stored column leniently: Garmin first, one per service, a bad entry dropped, a bad value dropped alone", () => {
    expect(
      readRouteMaps([
        { provider: "strava", id: STRAVA_ID, token: "bad token", style: "hybrid" },
        { provider: "garmin", id: GARMIN_ID },
        { provider: "garmin", id: "42" },
        { provider: "komoot", id: "1" },
        { provider: "garmin", id: "12x" },
        "nonsense",
      ]),
    ).toEqual([
      { provider: "garmin", id: GARMIN_ID },
      { provider: "strava", id: STRAVA_ID, style: "hybrid" },
    ]);
    expect(readRouteMaps(null)).toEqual([]);
    expect(readRouteMaps({ provider: "garmin", id: GARMIN_ID })).toEqual([]);
    expect(routeMapsToStore([null, null])).toBeNull();
    expect(routeMapsToStore([null, { provider: "strava", id: STRAVA_ID }])).toEqual([{ provider: "strava", id: STRAVA_ID }]);
  });

  it("knows when the route link is the Strava map's own route, so the page draws it once", () => {
    const stored = [{ provider: "strava", id: STRAVA_ID }];
    expect(routeUrlIsStravaMap(`https://www.strava.com/routes/${STRAVA_ID}`, stored)).toBe(true);
    expect(routeUrlIsStravaMap(`https://www.strava.com/routes/1`, stored)).toBe(false);
    expect(routeUrlIsStravaMap(`https://www.strava.com/activities/${STRAVA_ID}`, stored)).toBe(false);
    expect(routeUrlIsStravaMap(`https://www.strava.com/routes/${STRAVA_ID}`, null)).toBe(false);
    expect(routeUrlIsStravaMap(null, stored)).toBe(false);
  });
});
