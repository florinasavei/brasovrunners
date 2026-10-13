import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The logo stays the club's blue under «Tema v2» too (the owner, 2026-10-11, amending §708):
 * the header draws the supplied lockup with no filter and no look-scoped rule on it.
 */
describe("BR-REQ-070-02 criterion: the header's logo under the new look", () => {
  const source = readFileSync("src/shared/ui/SiteHeader.tsx", "utf8");

  it("draws the lockup unfiltered", () => {
    expect(source).not.toMatch(/filter\s*:/);
    expect(source).not.toContain("grayscale");
  });

  it("scopes no rule under the look", () => {
    expect(source).not.toContain("UNDER_LOOK");
  });
});
