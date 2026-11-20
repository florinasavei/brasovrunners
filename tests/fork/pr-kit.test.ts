import { describe, expect, it } from "vitest";
import { LOGO_FORMATS, LOGO_INK_GROUND, LOGO_INK_HEX, logoFileName, logoVariants, posterFileName, STICKER_SHEET_KEYS, stickerFileName } from "@/modules/pr-kit/domain/kit";
import { CLUB_HASHTAGS, PR_KIT_COLOURS } from "@/theme/brand";
import fork from "../fixtures/fork-club/club.json";
import { UPSTREAM_IDENTITY } from "./upstream-identity";

/**
 * BR-REQ-101-01 (§882, §NNN): the «PR Kit» is the club's whose folder the platform is built from. Under `yarn test:fork` every
 * file the kit hands out is named from the made-up club's slug, its logo is painted in that club's primary, its poster carries
 * that club's hashtags — and none of Brașov Runners' words is in any of it.
 */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const upstreamWordsIn = (text: string) =>
  UPSTREAM_IDENTITY.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(word))}(?![\\p{L}\\p{N}])`, "u").test(fold(text)));

describe("BR-REQ-101-01: a fork's PR kit is its own (§NNN)", () => {
  const names = [
    ...logoVariants().flatMap(({ shape, ink }) => LOGO_FORMATS.map((format) => logoFileName(shape, ink, format))),
    ...STICKER_SHEET_KEYS.map((sheet) => stickerFileName(sheet)),
    posterFileName("ro"),
    posterFileName("en"),
  ];

  it("names every file from the fork's slug", () => {
    for (const name of names) expect(name.startsWith(`${fork.slug}-`), name).toBe(true);
    expect(names.flatMap(upstreamWordsIn)).toEqual([]);
  });

  it("paints the logo in the fork's primary, on the fork's primary for the white one, and prints the fork's hashtags", () => {
    expect(LOGO_INK_HEX.primary).toBe(fork.palette.primary);
    expect(PR_KIT_COLOURS.ink.primary).toBe(fork.palette.primary);
    expect(LOGO_INK_GROUND.white).toBe(fork.palette.primary);
    expect(CLUB_HASHTAGS).toEqual(fork.hashtags);
    expect(upstreamWordsIn(CLUB_HASHTAGS.join(" · "))).toEqual([]);
  });
});
