import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import SubNav from "@/shared/ui/SubNav";

/**
 * BR-REQ-041-01 (§731) — the members' zone's three tabs say a shorter word below `sm`, so the row
 * fits 288 px and the current tab is in view; the full word is drawn from `sm` up. Both are in the
 * markup and the other is hidden by CSS, so nothing needs a script.
 */
describe("SubNav short words (§731)", () => {
  it("draws the full word from sm up and the short one below, both inside the one link", () => {
    const html = renderToStaticMarkup(
      createElement(SubNav, { label: "Zona", items: [{ href: "/a", label: "Coduri de reducere", short: "Coduri", active: true }] }),
    );
    expect(html).toContain("Coduri de reducere");
    expect(html).toContain(">Coduri<");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('aria-current="page"');
  });

  it("draws one plain word when no short one is given", () => {
    const html = renderToStaticMarkup(createElement(SubNav, { label: "Zona", items: [{ href: "/a", label: "Produse" }] }));
    expect(html).toContain(">Produse<");
    expect(html).not.toContain("<span>");
  });

  it("the catalogue has a short word for every tab, in both languages, and each is not longer than the full one", () => {
    for (const m of [ro, en]) {
      for (const tab of ["codes", "shop", "runs"] as const) {
        const short = m.Members.tabsShort[tab];
        expect(short.length).toBeGreaterThan(0);
        expect(short.length).toBeLessThanOrEqual(m.Members.tabs[tab].length);
        expect(short.split(" ")).toHaveLength(1);
      }
    }
  });

  it("carries the island that scrolls a current entry past the edge into view, inside the nav (§731)", () => {
    const html = renderToStaticMarkup(createElement(SubNav, { label: "Zona", items: [{ href: "/a", label: "Produse", active: true }] }));
    expect(html).toMatch(/<nav[^>]*><span hidden/);
  });
});
