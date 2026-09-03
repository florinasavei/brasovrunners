import { hasLocale } from "next-intl";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

/**
 * BR-REQ-040-01 — locale-prefixed public routes.
 * BR-REQ-040-02 — no cross-locale content fallback.
 */
describe("BR-REQ-040-01 locale routing", () => {
  it("supports exactly ro and en, with ro as the default", () => {
    expect(routing.locales).toEqual(["ro", "en"]);
    expect(routing.defaultLocale).toBe("ro");
  });

  it("always prefixes the locale, so an unprefixed path never silently means Romanian", () => {
    expect(routing.localePrefix).toBe("always");
  });
});

describe("BR-REQ-040-02 unknown locales do not fall back", () => {
  it.each(["ro", "en"])("accepts the supported locale %s", (locale) => {
    expect(hasLocale(routing.locales, locale)).toBe(true);
  });

  it.each(["de", "fr", "RO", "ro-RO", "", "../ro", "en-GB"])(
    "rejects %j, so the layout returns 404 rather than serving another language",
    (candidate) => {
      expect(hasLocale(routing.locales, candidate)).toBe(false);
    },
  );
});
