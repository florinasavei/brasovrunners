import { IntlMessageFormat } from "intl-messageformat";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { rsvpMemberClause } from "@/modules/rsvp/notice-words";
import fork from "../fixtures/fork-club/club.json";
import overlayRo from "../fixtures/fork-club/messages/ro.json";
import { UPSTREAM_IDENTITY } from "./upstream-identity";

/**
 * BR-REQ-101-01 (§887): the platform's catalogues are neutral. Under `yarn test:fork` (`vitest.fork.config.mts`) `@club` is
 * the made-up club, whose overlay is its stamp alone — so the merged catalogue is the platform's, every word of it. Each
 * leaf, formatted with the made-up club's values for the arguments that carry a club's words and a dummy for every other,
 * must say none of this club's words: a sentence of Brașov's left in `messages/` is a sentence a fork would ship.
 */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const upstreamWordsIn = (text: string) =>
  UPSTREAM_IDENTITY.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(word))}(?![\\p{L}\\p{N}])`, "u").test(fold(text)));

/** The arguments that carry a club's words (§369, §887), as the made-up club gives them. */
function clubValues(locale: "ro" | "en"): Record<string, string> {
  return {
    club: fork.name,
    short: fork.shortName,
    idExample: fork.place.idExample,
    safetyName: fork.safetyProgramme[locale],
    slug: fork.slug,
    bucket: `${fork.slug}-media`,
    timeZone: fork.place.timeZone,
    zoneWords: fork.place.zoneWords[locale],
  };
}

/** Every leaf, an array's items one by one. */
function leaves(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${prefix}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
  return [];
}

/** A message formatted: the club's values where it asks for them, `1` for any other argument, each tag's inside kept. */
function formatted(message: string, locale: "ro" | "en"): string {
  const values: Record<string, unknown> = {};
  for (const [, name] of message.matchAll(/\{(\w+)/g)) values[name] = 1;
  for (const [, tag] of message.matchAll(/<(\w+)>/g)) values[tag] = (chunks: unknown[]) => chunks.join("");
  Object.assign(values, clubValues(locale));
  try {
    const out = new IntlMessageFormat(message, locale).format(values);
    return Array.isArray(out) ? out.join("") : String(out);
  } catch {
    // A step read raw and filled by its page (`/admin/tasks`): the same values, by name.
    return message.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  }
}

describe("BR-REQ-101-01: a fork with an empty overlay reads a neutral catalogue (§887)", () => {
  it("has an overlay that is the made-up club's stamp and nothing else", () => {
    expect(overlayRo).toEqual({ $club: fork.slug });
  });

  for (const locale of ["ro", "en"] as const) {
    it(`says none of this club's words in any ${locale} message, formatted with the fork's values`, () => {
      const said = leaves(catalogueOf(locale)).flatMap(([key, message]) => upstreamWordsIn(formatted(message, locale)).map((word) => `${key}: ${word}`));
      expect(said).toEqual([]);
    });
  }

  it("draws the member mark with the fork's short mark, on the chip and in the notice's sentence", () => {
    for (const locale of ["ro", "en"] as const) {
      const t = createTranslator({ locale, messages: catalogueOf(locale), namespace: "Event" });
      expect(t("rsvp.memberMark", { short: fork.shortName })).toBe(fork.shortName);
      expect(rsvpMemberClause(locale)).toContain(fork.shortName);
      expect(upstreamWordsIn(rsvpMemberClause(locale))).toEqual([]);
    }
  });
});
