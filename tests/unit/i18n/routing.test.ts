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

  // BR-REQ-070-02 criterion 1 (§NNN): next-intl's own `Link` response header would advertise
  // the unprefixed path as `x-default` (a 307 to `/ro/…`) and swap this locale's slug onto the
  // other language (a 404 there). The pages declare their own alternates instead, from the
  // database (`modules/seo/alternates.ts`), so this stays off.
  it("declares no alternate-links header of its own — the pages build hreflang from the database", () => {
    expect(routing.alternateLinks).toBe(false);
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
