import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-041-01 criterion 6, `DECISIONS.md` §NNN (amends §79): the backoffice section bar shows scroll
 * arrows only while it overflows (`auto`), not on a phone, each a 44-pixel target. Read as source:
 * the arrows are drawn after the browser measures, which a static render cannot; the behaviour is
 * walked in `tests/e2e/config-panels.spec.ts`.
 */
describe("AdminTabs", () => {
  const source = readFileSync("src/modules/staff-identity/ui/AdminTabs.tsx", "utf8");
  it("draws 44 px arrows when the tabs overflow, and none on a phone", () => {
    expect(source).toContain('scrollButtons="auto"');
    expect(source).not.toMatch(/^\s*allowScrollButtonsMobile\s*$/m);
    expect(source).not.toContain("scrollButtons={false}");
    expect(source).toMatch(/"& \.MuiTabs-scrollButtons": \{ width: 44, flexShrink: 0/);
  });
  it("centres the selected tab again when the arrows change the scroller's width", () => {
    expect(source).toContain("new ResizeObserver(");
  });
});
