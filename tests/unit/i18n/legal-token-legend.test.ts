import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { CLUB_SHORT_NAME, SAFETY_PROGRAMME } from "@/theme/brand";

const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * `/admin/legal`'s token legend calls `t()` on every `Admin.legal.tokens.*` message: a bare
 * `{{event}}` is malformed ICU and would throw on the page. Every entry must parse and format
 * through the formatter next-intl uses, with the literal token text quoted as `'{{…}}'` (§523) — and with the club's
 * words `TokenLegend` hands every entry (§887): its short mark and its safety form's name.
 */
describe("Admin.legal.tokens — every legend entry is well-formed ICU", () => {
  for (const [locale, catalogue] of [
    ["ro", ro],
    ["en", en],
  ] as const) {
    const tokens = (catalogue as unknown as { Admin: { legal: { tokens: Record<string, unknown> } } }).Admin.legal.tokens;
    for (const [key, message] of Object.entries(tokens)) {
      if (typeof message !== "string") continue;
      it(`${locale}: ${key}`, () => {
        const formatted = new IntlMessageFormat(message, locale).format({ short: CLUB_SHORT_NAME, safetyName: SAFETY_PROGRAMME[locale] });
        expect(typeof formatted).toBe("string");
      });
    }
  }

  it("the series entry prints its tokens with their double braces", () => {
    const ro1 = new IntlMessageFormat((ro as never as { Admin: { legal: { tokens: { series: string } } } }).Admin.legal.tokens.series, "ro").format({});
    expect(ro1).toContain("{{event}}");
    expect(ro1).toContain("{{eventDate}}");
  });
});
