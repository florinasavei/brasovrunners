import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EventTabs, { type EventTabLinks, EventTabPanel } from "@/modules/events/ui/EventTabs";
import { showTabsAround, type TabNode } from "@/shared/ui/fold";

/**
 * §NNN — the event page's tabs «Descriere | Clasament | Galerie foto» (the owner, 2026-11-22: «aici vreau așa: tab-uri: Descriere,
 * Clasament și Galerie Foto»; «Descriere» opens the page, «Galerie foto» is the album's card). Server-rendered links, each panel its own
 * anchor with the row of tabs at its top; which panel shows is CSS — `:target` before any script — and the page's one fragment island
 * once it ran (`showTabsAround`). With the description alone there is no row of tabs at all.
 */
const ALL: EventTabLinks = [
  { key: "descriere", label: "Descriere" },
  { key: "clasament", label: "Clasament" },
  { key: "galerie", label: "Galerie foto" },
];

function render(tabs: EventTabLinks): string {
  return renderToStaticMarkup(
    createElement(
      EventTabs,
      { tabs },
      tabs.map((tab) => createElement(EventTabPanel, { key: tab.key, tab: tab.key, tabs, label: "Secțiunile paginii" }, createElement("p", null, `conținut ${tab.key}`))),
    ),
  );
}

describe("§NNN the event page's tabs", () => {
  it("draws no row of tabs with the description alone: the page is as it was", () => {
    const html = render([ALL[0]]);
    expect(html).toBe("<p>conținut descriere</p>");
  });

  it("gives each panel its anchor and its own row of tabs, the panel's own tab current, every tab a 44-pixel link to its panel", () => {
    const html = render(ALL);
    expect(html).toContain('data-tabs=""');
    for (const key of ["descriere", "clasament", "galerie"]) {
      expect(html).toMatch(new RegExp(`<section[^>]*id="${key}"[^>]*data-tab-panel="${key}"`));
      expect(html).toContain(`conținut ${key}`);
    }
    // Three rows, three links each; in each row the panel's own tab is the current one.
    expect(html.match(/<nav[^>]*aria-label="Secțiunile paginii"/g)).toHaveLength(3);
    expect(html.match(/data-testid="event-tab"/g)).toHaveLength(9);
    expect(html.match(/aria-current="true"/g)).toHaveLength(3);
    for (const key of ["descriere", "clasament", "galerie"]) {
      const panel = html.slice(html.indexOf(`data-tab-panel="${key}"`));
      expect(panel).toMatch(new RegExp(`<a[^>]*href="#${key}"[^>]*aria-current="true"`));
    }
    expect(html).toContain("min-height:44px");
    expect(html).toContain(">Galerie foto<");
  });

  it("shows «Descriere» first, a panel the fragment names or holds instead, and the island's choice once it ran", () => {
    const css = render(ALL).match(/<style[^>]*>([\s\S]*?)<\/style>/g)?.join("") ?? "";
    expect(css).toMatch(/>\[data-tab-panel\]:not\(\[data-tab-panel='descriere'\]\)\{display:none;\}/);
    expect(css).toMatch(/>\[data-tab-panel\]:target\{display:block;\}/);
    expect(css).toMatch(/>\[data-tab-panel\]:has\(:target\)\{display:block;\}/);
    expect(css).toMatch(/\[data-tab-active='clasament'\]>\[data-tab-panel='clasament'\]\{display:block;\}/);
    // «Descriere» steps aside when the fragment names another panel, or something inside one.
    expect(css).toContain(":has([data-tab-panel]:not([data-tab-panel='descriere']):target)>[data-tab-panel='descriere']{display:none;}");
    expect(css).toContain(":has([data-tab-panel]:not([data-tab-panel='descriere']) :target)>[data-tab-panel='descriere']{display:none;}");
  });
});

/** A plain element: its attributes, its parent. */
function node(attributes: Record<string, string>, parentElement: TabNode | null = null): TabNode & { attributes: Record<string, string> } {
  return {
    attributes,
    parentElement,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
  };
}

describe("§NNN showTabsAround: the tab that holds the fragment's target comes forward", () => {
  it("marks the box with the panel that holds the target, and says it changed something once", () => {
    const box = node({ "data-tabs": "" });
    const panel = node({ "data-tab-panel": "clasament", id: "clasament" }, box);
    const row = node({}, panel);
    expect(showTabsAround(row)).toBe(1);
    expect(box.attributes["data-tab-active"]).toBe("clasament");
    expect(showTabsAround(panel)).toBe(0);
  });

  it("changes nothing for a target outside every tab box", () => {
    const page = node({});
    expect(showTabsAround(node({ id: "rules" }, page))).toBe(0);
    expect(showTabsAround(null)).toBe(0);
  });
});

describe("§NNN the event page decides its tabs", () => {
  const page = readFileSync("src/modules/events/ui/EventPageView.tsx", "utf8").replace(/\r\n/g, "\n");

  it("draws «Clasament» only once the published results have a row, and «Galerie foto» only with a published album of this event", () => {
    expect(page).toContain("((await readOrWhileAway(() => readEventResultsForPage(dated, now), null))?.rows.length ?? 0) > 0");
    expect(page).toContain(".filter((album) => album.eventId === event.id)");
    expect(page).toContain('<EventTabPanel tab="clasament" tabs={tabs} label={t("tabs.label")}>\n            <ResultsSection event={dated} inTab />');
    expect(page).toContain("<AlbumGrid albums={Promise.resolve(albums)} />");
    // Not on a members' event, not in the preview before saving: a visit's page alone.
    expect(page).toMatch(/const resultsTab =\s*dated && !membersOnly && visit \?/);
    expect(page).toMatch(/const albums = visit && !membersOnly \?/);
  });
});
