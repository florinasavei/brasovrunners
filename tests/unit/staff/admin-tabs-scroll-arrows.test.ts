import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-041-01 criterion 6, `DECISIONS.md` §NNN: a backoffice tab bar that can overflow shows
 * scroll arrows (`auto`: only while it does), on a phone too, and each arrow is a 44-pixel target.
 * Read as source: the arrows are drawn after the browser measures, which a static render cannot.
 */
describe.each(["src/modules/staff-identity/ui/AdminTabs.tsx", "src/shared/ui/LocaleTabPanels.tsx"])("%s", (file) => {
  const source = readFileSync(file, "utf8");
  it("draws arrows when the tabs overflow, also on a phone, at 44 px", () => {
    expect(source).toContain('scrollButtons="auto"');
    expect(source).toContain("allowScrollButtonsMobile");
    expect(source).not.toContain("scrollButtons={false}");
    expect(source).toMatch(/"& \.MuiTabs-scrollButtons": \{ width: 44/);
  });
});
