import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLS_PAGE, parseToolsPageSettings, shownTools, TOOLS, toolsPageOnSite } from "@/modules/tools/page-settings";

describe("§926 «Unelte» is a standard page: on by default, off by its switch or with no tool shown", () => {
  it("no row, or an unreadable one, reads as published with every tool shown — the page has been on the site since §922", () => {
    expect(DEFAULT_TOOLS_PAGE).toEqual({ status: "PUBLISHED", hiddenTools: [] });
    expect(parseToolsPageSettings(null)).toEqual(DEFAULT_TOOLS_PAGE);
    expect(parseToolsPageSettings({ status: "MAYBE" })).toEqual(DEFAULT_TOOLS_PAGE);
    expect(toolsPageOnSite(DEFAULT_TOOLS_PAGE)).toBe(true);
    expect(shownTools(DEFAULT_TOOLS_PAGE)).toEqual([...TOOLS]);
  });

  it("a tool the platform no longer has is dropped on read; the draft is off the site", () => {
    expect(parseToolsPageSettings({ status: "PUBLISHED", hiddenTools: ["gone", "pace"] })).toEqual({ status: "PUBLISHED", hiddenTools: ["pace"] });
    expect(parseToolsPageSettings({ status: "DRAFT" })).toEqual({ status: "DRAFT", hiddenTools: [] });
    expect(toolsPageOnSite({ status: "DRAFT", hiddenTools: [] })).toBe(false);
  });

  it("published with every tool hidden is off the site, as an FAQ page with no question is (§525)", () => {
    const none = { status: "PUBLISHED" as const, hiddenTools: [...TOOLS] };
    expect(shownTools(none)).toEqual([]);
    expect(toolsPageOnSite(none)).toBe(false);
  });
});
