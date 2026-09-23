import { describe, expect, it } from "vitest";
import { type BibDesign, bibDesignFromQuery, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import {
  BIB_DESIGN_FORM_PREFIX,
  bibDesignSearchParams,
  bibDesignValuesFromQuery,
  bibNumberFromQuery,
  bibPreviewUrl,
  isBibDesignInput,
  readBibDesignForm,
} from "@/modules/registrations/bib-design-query";

/**
 * BR-REQ-038-01, `DECISIONS.md` §249 — the editor's live bib preview.
 *
 * The panel's `<img>` carries the unsaved design in the picture route's query string, and the
 * route reads it back with the schema the save uses. What can go wrong is the wire: a design
 * that does not survive the trip is a preview of a different bib, and a query somebody typed by
 * hand must draw the platform's design rather than a 500. Both ends are pure and tested here;
 * the picture itself is `bib-image.test.ts`'s.
 */

const OURS = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
const LOCAL = "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/web.webp";

const EVERYTHING_OFF: BibDesign = {
  showName: false,
  showEventTitle: false,
  showDate: false,
  showLogo: false,
  numberScale: "large",
  namePosition: "above",
  headerImageSrc: OURS,
  sponsorImageSrc: LOCAL,
  cutMarks: true,
  // The footer (§317): every switch the other way, and a line with the characters a URL must
  // escape — the separator's dot, a colon, an ampersand, a plus, diacritics.
  showEmail: false,
  showPartners: false,
  showEventInFooter: true,
  showWebsite: true,
  footerText: "Cronometraj: Start & Go + 50% · Urgențe organizator 0722 000 000",
};

describe("§249 the design on the wire: encode, then parse", () => {
  it("round-trips the platform's design", () => {
    expect(bibDesignFromQuery(bibDesignSearchParams(DEFAULT_BIB_DESIGN))).toEqual(DEFAULT_BIB_DESIGN);
  });

  it("round-trips a design with every choice away from its default", () => {
    // Switches off, the other size and position, both pictures — including a local one whose
    // address has slashes, and a stored one with a scheme.
    const query = bibDesignSearchParams(EVERYTHING_OFF).toString();
    expect(bibDesignFromQuery(new URLSearchParams(query))).toEqual(EVERYTHING_OFF);
  });

  it("round-trips through a real address, next to the route's own parameters", () => {
    const url = new URL(
      bibPreviewUrl({ eventId: "evt-1", locale: "en", number: "500", colour: "#1b7f3b", design: EVERYTHING_OFF }),
      "http://localhost",
    );
    expect(url.pathname).toBe("/api/admin/events/evt-1/bibs/preview");
    expect(url.searchParams.get("sample")).toBe("1");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("number")).toBe("500");
    expect(url.searchParams.get("colour")).toBe("#1b7f3b");
    expect(bibDesignFromQuery(url.searchParams)).toEqual(EVERYTHING_OFF);
  });

  it("leaves the number and the colour out of the address when the boxes are empty", () => {
    // The route then falls back to the event's own start and the club's colour, as the save does.
    const url = new URL(bibPreviewUrl({ eventId: "evt-1", locale: "ro", number: "", colour: "", design: DEFAULT_BIB_DESIGN }), "http://localhost");
    expect(url.searchParams.has("number")).toBe(false);
    expect(url.searchParams.has("colour")).toBe(false);
    expect(url.searchParams.get("locale")).toBe("ro");
  });

  it("draws the platform's design from a query that says nothing", () => {
    expect(bibDesignFromQuery(new URLSearchParams())).toEqual(DEFAULT_BIB_DESIGN);
    expect(bibDesignFromQuery(new URLSearchParams("sample=1&locale=ro&registration=abc"))).toEqual(DEFAULT_BIB_DESIGN);
  });

  it("falls back field by field on garbage, never for the whole design", () => {
    const garbage = new URLSearchParams({
      showName: "yes",
      showDate: "0",
      showLogo: "maybe",
      numberScale: "enormous",
      namePosition: "above",
      headerImageSrc: "https://evil.example/logo.png",
      sponsorImageSrc: LOCAL,
      cutMarks: "1",
      watermark: "1",
      showEmail: "off",
      showWebsite: "1",
      footerText: `  ${"a".repeat(200)}\n`,
    });
    expect(bibDesignFromQuery(garbage)).toEqual({
      ...DEFAULT_BIB_DESIGN,
      showDate: false,
      namePosition: "above",
      // A third party's picture is refused here exactly as a stored one is.
      headerImageSrc: null,
      sponsorImageSrc: LOCAL,
      cutMarks: true,
      showWebsite: true,
      // Trimmed and cut by the schema the save uses, so the preview never draws a line the
      // save would not keep.
      footerText: "a".repeat(120),
    });
  });

  it("says nothing about the club's line when it is empty, and draws the platform's footer", () => {
    const params = bibDesignSearchParams({ ...DEFAULT_BIB_DESIGN, footerText: "   " });
    expect(params.has("footerText")).toBe(false);
    expect(params.get("showEmail")).toBe("1");
    expect(bibDesignFromQuery(params)).toEqual(DEFAULT_BIB_DESIGN);
  });

  it("turns the email off in the address when the switch is off, and nothing else", () => {
    const on = new URL(bibPreviewUrl({ eventId: "evt-1", locale: "ro", number: "1", colour: "", design: DEFAULT_BIB_DESIGN }), "http://localhost");
    const off = new URL(
      bibPreviewUrl({ eventId: "evt-1", locale: "ro", number: "1", colour: "", design: { ...DEFAULT_BIB_DESIGN, showEmail: false } }),
      "http://localhost",
    );
    expect(on.searchParams.get("showEmail")).toBe("1");
    expect(off.searchParams.get("showEmail")).toBe("0");
    off.searchParams.set("showEmail", "1");
    expect(off.toString()).toBe(on.toString());
    expect(bibDesignFromQuery(new URLSearchParams({ showEmail: "0" }))).toEqual({ ...DEFAULT_BIB_DESIGN, showEmail: false });
  });

  it("reads only what means something, so the schema's own fallbacks apply to the rest", () => {
    expect(bibDesignValuesFromQuery(new URLSearchParams("showName=1&showDate=x&numberScale=&headerImageSrc=&footerText="))).toEqual({
      showName: true,
      headerImageSrc: null,
      sponsorImageSrc: null,
    });
  });
});

describe("§249 the form, read the same way for the save and for the preview", () => {
  const posted = (entries: Record<string, string>) => (name: string) => entries[name] ?? null;

  it("reads a checkbox that posted nothing as off, and an empty select as the platform's choice", () => {
    expect(readBibDesignForm(posted({}))).toEqual({
      ...DEFAULT_BIB_DESIGN,
      showName: false,
      showEventTitle: false,
      showDate: false,
      showLogo: false,
      showEmail: false,
      showPartners: false,
    });
  });

  it("reads what the panel posts", () => {
    const form = posted({
      [`${BIB_DESIGN_FORM_PREFIX}showName`]: "on",
      [`${BIB_DESIGN_FORM_PREFIX}showLogo`]: "on",
      [`${BIB_DESIGN_FORM_PREFIX}numberScale`]: "small",
      [`${BIB_DESIGN_FORM_PREFIX}namePosition`]: " above ",
      [`${BIB_DESIGN_FORM_PREFIX}headerImageSrc`]: "",
      [`${BIB_DESIGN_FORM_PREFIX}sponsorImageSrc`]: OURS,
      [`${BIB_DESIGN_FORM_PREFIX}cutMarks`]: "on",
      [`${BIB_DESIGN_FORM_PREFIX}showPartners`]: "on",
      [`${BIB_DESIGN_FORM_PREFIX}showWebsite`]: "on",
      [`${BIB_DESIGN_FORM_PREFIX}footerText`]: " Cronometraj: StartTime ",
    });
    expect(readBibDesignForm(form)).toEqual({
      showName: true,
      showEventTitle: false,
      showDate: false,
      showLogo: true,
      numberScale: "small",
      namePosition: "above",
      headerImageSrc: null,
      sponsorImageSrc: OURS,
      cutMarks: true,
      // The email box was unticked: the footer prints no address (§317).
      showEmail: false,
      showPartners: true,
      showEventInFooter: false,
      showWebsite: true,
      // As typed; the schema trims it, for the save and the preview alike.
      footerText: " Cronometraj: StartTime ",
    });
  });

  it("follows the footer's boxes too", () => {
    expect(isBibDesignInput("event.bibDesign.showEmail")).toBe(true);
    expect(isBibDesignInput("event.bibDesign.footerText")).toBe(true);
  });

  it("follows the panel's boxes, the band's colour and the start number, and nothing else", () => {
    expect(isBibDesignInput("event.bibDesign.showName")).toBe(true);
    expect(isBibDesignInput("event.bibDesign.headerImageSrc")).toBe(true);
    expect(isBibDesignInput("event.bibColour")).toBe(true);
    expect(isBibDesignInput("event.bibStartNumber")).toBe(true);
    // A keystroke in the title changes no bib and must ask for no picture.
    expect(isBibDesignInput("translations.ro.title")).toBe(false);
    expect(isBibDesignInput("event.capacity")).toBe(false);
  });
});

describe("§249 the sample's number", () => {
  it("takes a whole number a bib can carry", () => {
    expect(bibNumberFromQuery("1")).toBe(1);
    expect(bibNumberFromQuery("500")).toBe(500);
    expect(bibNumberFromQuery(" 99999 ")).toBe(99_999);
  });

  it("reads anything else as 'not a number yet', for the route to fall back", () => {
    // The box is being typed into while the preview follows.
    for (const raw of [null, "", "0", "-3", "1e3", "abc", "100000", "12.5"]) {
      expect(bibNumberFromQuery(raw), String(raw)).toBeNull();
    }
  });
});
