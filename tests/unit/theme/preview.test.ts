import { describe, expect, it } from "vitest";
import { DEFAULT_PREVIEW, parseThemePreview, serializeThemePreview } from "@/theme/preview";

/** BR-REQ-090-06: the cookie is an allowlist, and the default is "no preview". */
describe("BR-REQ-090-06 the theme lab's preview", () => {
  it("round-trips a preview", () => {
    const preview = { scale: 125 as const, display: "inter" as const, body: "nunito" as const, radius: 16 as const };
    expect(parseThemePreview(serializeThemePreview(preview))).toEqual(preview);
  });

  it("ignores anything outside the allowlist, so a cookie can never name a font or a size the site did not offer", () => {
    expect(parseThemePreview("scale=125;display=comic;body=roboto;radius=10")).toBeNull();
    expect(parseThemePreview("scale=999;display=roboto;body=roboto;radius=10")).toBeNull();
    expect(parseThemePreview("scale=125;display=roboto;body=roboto;radius=7")).toBeNull();
    expect(parseThemePreview("garbage")).toBeNull();
    expect(parseThemePreview("")).toBeNull();
    expect(parseThemePreview(undefined)).toBeNull();
  });

  it("treats the defaults as no preview at all", () => {
    expect(parseThemePreview(serializeThemePreview(DEFAULT_PREVIEW))).toBeNull();
  });
});
