import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  EVENT_LINK_KINDS,
  type EventLinkKind,
  eventLinkHost,
  eventLinkLabel,
  hasOneLanguageLabel,
  readEventLinks,
} from "@/modules/events/domain/links";
import EventLinks from "@/modules/events/ui/EventLinks";
import { LINK_GLYPH } from "@/modules/events/ui/link-glyphs";

/**
 * BR-REQ-011-01 criterion 20 (`DECISIONS.md` §332) — "Linkuri și fișiere" on the event page.
 *
 * What a stored row means (`readEventLinks`), what the reader is told a link is when the club
 * wrote no label (the kind's own word, in the reader's language, never the other language's
 * label), where it goes (the host, in small text), and the block itself: under `#links`, one
 * 44-pixel link per row opening in a new tab, and nothing at all for an event without links.
 */
const DRIVE = ["https:/", "drive.example.test", "file", "d", "abc123", "view"].join("/");
const PDF = ["https:/", "www.files.example.test", "regulament.pdf"].join("/");

const kindLabels = (locale: "ro" | "en"): Record<EventLinkKind, string> =>
  (locale === "ro" ? ro : en).Event.links.kinds as Record<EventLinkKind, string>;

const render = (links: unknown, locale: "ro" | "en" = "ro") =>
  renderToStaticMarkup(
    createElement(EventLinks, {
      links,
      locale,
      heading: (locale === "ro" ? ro : en).Event.links.heading,
      kindLabels: kindLabels(locale),
    }),
  );

describe("BR-REQ-011-01 criterion 20 reading a stored list of links", () => {
  it("keeps the club's order and at most twelve", () => {
    const stored = Array.from({ length: 14 }, (_, index) => ({ kind: "OTHER", url: `${DRIVE}?n=${index}`, labelRo: null, labelEn: null }));
    const read = readEventLinks(stored);
    expect(read).toHaveLength(12);
    expect(read[0].url).toBe(`${DRIVE}?n=0`);
    expect(read[11].url).toBe(`${DRIVE}?n=11`);
  });

  it("reads anything that is not an array as no links — null is every row from before the column", () => {
    for (const value of [null, undefined, {}, "x", 3]) expect(readEventLinks(value)).toEqual([]);
  });

  it("drops an entry with no https address, and keeps one whose kind or label it cannot read", () => {
    const read = readEventLinks([
      { kind: "GPX", url: "http://drive.example.test/x" },
      { kind: "GPX", url: "javascript:alert(1)" },
      { kind: "GPX" },
      "just a string",
      // A kind a later release added, and a key it added: the link survives as "other" (§169's rule).
      { kind: "VIDEO", url: DRIVE, labelRo: 42, labelEn: "x".repeat(81), logo: "a.png" },
      { kind: "RESULTS", url: PDF, labelRo: "  Rezultate 2026  ", labelEn: "" },
    ]);
    expect(read).toEqual([
      { kind: "OTHER", url: DRIVE, labelRo: null, labelEn: null },
      { kind: "RESULTS", url: PDF, labelRo: "Rezultate 2026", labelEn: null },
    ]);
  });

  it("names where a link goes by its host, without the www", () => {
    expect(eventLinkHost(DRIVE)).toBe("drive.example.test");
    expect(eventLinkHost(PDF)).toBe("files.example.test");
    expect(eventLinkHost("https://DROPBOX.example.test/s/x")).toBe("dropbox.example.test");
    expect(eventLinkHost("not a url")).toBeNull();
  });
});

describe("BR-REQ-011-01 criterion 20 the label when the club wrote none", () => {
  it("is the club's own label in the reader's language, and never the other language's", () => {
    const link = { labelRo: "Traseul de 21 km", labelEn: "The 21 km route" };
    expect(eventLinkLabel(link, "ro")).toBe("Traseul de 21 km");
    expect(eventLinkLabel(link, "en")).toBe("The 21 km route");
    expect(hasOneLanguageLabel(link)).toBe(false);
  });

  it("is null in both languages for a label stored in one language only — both or neither (§NNN)", () => {
    // Saved before the rule: neither page shows the club's label, both show the kind's own word,
    // so the Romanian page never says something the English one does not.
    const romanianOnly = { labelRo: "Traseul de 21 km", labelEn: null };
    expect(eventLinkLabel(romanianOnly, "ro")).toBeNull();
    expect(eventLinkLabel(romanianOnly, "en")).toBeNull();
    const englishOnly = { labelRo: null, labelEn: "Extended rules" };
    expect(eventLinkLabel(englishOnly, "en")).toBeNull();
    expect(eventLinkLabel(englishOnly, "ro")).toBeNull();
    expect(hasOneLanguageLabel(romanianOnly)).toBe(true);
    expect(hasOneLanguageLabel(englishOnly)).toBe(true);
    expect(hasOneLanguageLabel({ labelRo: null, labelEn: null })).toBe(false);
  });

  it("renders the kind's word on both pages for a row whose label is in one language only (§NNN)", () => {
    const stored = [{ kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: null }];
    expect(render(stored, "ro")).toContain("Traseul (GPX)");
    expect(render(stored, "ro")).not.toContain("Traseul de 21 km");
    expect(render(stored, "en")).toContain("Route (GPX)");
    expect(render(stored, "en")).not.toContain("Traseul de 21 km");
  });

  it("has a word for every kind in both catalogues, and a glyph for every kind", () => {
    for (const kind of EVENT_LINK_KINDS) {
      expect(kindLabels("ro")[kind], `ro ${kind}`).toBeTruthy();
      expect(kindLabels("en")[kind], `en ${kind}`).toBeTruthy();
      expect(LINK_GLYPH[kind], `glyph ${kind}`).toBeDefined();
    }
    expect(Object.keys(kindLabels("ro")).sort()).toEqual([...EVENT_LINK_KINDS].sort());
    expect(Object.keys(kindLabels("en")).sort()).toEqual([...EVENT_LINK_KINDS].sort());
    // The GPX one, in the words the owner's example asks for.
    expect(kindLabels("ro").GPX).toBe("Traseul (GPX)");
    expect(kindLabels("en").GPX).toBe("Route (GPX)");
  });

  it("renders the kind's word in each language when the label is empty", () => {
    const stored = [{ kind: "GPX", url: DRIVE, labelRo: null, labelEn: null }];
    expect(render(stored, "ro")).toContain("Traseul (GPX)");
    expect(render(stored, "en")).toContain("Route (GPX)");
    expect(render(stored, "en")).not.toContain("Traseul");
  });
});

describe("BR-REQ-011-01 criterion 20 the block on the event page", () => {
  it("lists each link under #links with its label and host, opening in a new tab", () => {
    const html = render([
      { kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "The 21 km route" },
      { kind: "DOCUMENT", url: PDF, labelRo: null, labelEn: null },
    ]);
    expect(html).toContain('id="links"');
    expect(html).toContain("Linkuri și fișiere");
    expect(html).toContain("Traseul de 21 km");
    expect(html).toContain("Document");
    // Where each goes, in small text under the label.
    expect(html).toContain("drive.example.test");
    expect(html).toContain("files.example.test");
    // In the club's order.
    expect(html.indexOf("Traseul de 21 km")).toBeLessThan(html.indexOf(">Document<"));
    // The addresses as pasted, each opening in a new tab that cannot reach back.
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    expect(anchors[0]).toContain(`href="${DRIVE}"`);
    expect(anchors[1]).toContain(`href="${PDF}"`);
  });

  it("renders nothing at all for an event without links — no heading and no anchor", () => {
    expect(render(null)).toBe("");
    expect(render([])).toBe("");
    // Nor for a column holding only entries that are not links.
    expect(render([{ kind: "GPX", url: "http://drive.example.test/x" }])).toBe("");
  });

  it("gives every link a 44-pixel tap target and a decorative glyph", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/events/ui/EventLinks.tsx"), "utf8");
    expect(source).toMatch(/minHeight: 44/);
    const html = render([{ kind: "PHOTOS", url: DRIVE, labelRo: null, labelEn: null }]);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("sits on the public page after the map and before the programme, and in the preview before the programme", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/page.tsx"), "utf8");
    const links = page.indexOf("<EventLinks");
    expect(links).toBeGreaterThan(page.indexOf("event.locationAddress && ("));
    expect(links).toBeLessThan(page.indexOf("<EventProgramme"));
    const preview = readFileSync(path.join(process.cwd(), "src/app/[locale]/preview/events/[id]/page.tsx"), "utf8");
    expect(preview.indexOf("<EventLinks")).toBeGreaterThan(-1);
    expect(preview.indexOf("<EventLinks")).toBeLessThan(preview.indexOf("<EventProgramme"));
  });
});
