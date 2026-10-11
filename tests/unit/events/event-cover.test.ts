import { describe, expect, it } from "vitest";
import { coverSources } from "@/modules/events/cover";
import { readPublicCover } from "@/modules/events/domain/cover";
import { pictureSizes } from "@/modules/media/ladder";

/**
 * §NNN — the facelift's phase 2: an event's cover as the public row carries it (`cover`, read in SQL
 * beside every public column, so it travels through the public cache) and the sources an `<img>`
 * draws it from — the ladder's `srcset` for a picture stored with one (§414), none for an older
 * picture, `sizes` asking for the crop's magnification (§241). Never a film's poster (§485), and a
 * value that is not a cover reads as none rather than breaking a card.
 */
const LADDER = "0b6f3f9e-2a41-8c3d-9e5f-1a2b3c4d5e6f"; // version 8: stored with its ladder (§414)
const OLDER = "0b6f3f9e-2a41-4c3d-9e5f-1a2b3c4d5e6f"; // version 4: one file, drawn as it always was

describe("§NNN the cover on the public row", () => {
  it("reads the stored picture's prefix, size and crop, the whole picture when the crop is none or malformed", () => {
    expect(readPublicCover({ keyPrefix: LADDER, width: 2400, height: 1600, crop: null })).toEqual({ keyPrefix: LADDER, width: 2400, height: 1600, crop: null });
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.5 };
    expect(readPublicCover({ keyPrefix: LADDER, width: 2400, height: 1600, crop })?.crop).toEqual(crop);
    expect(readPublicCover({ keyPrefix: LADDER, width: 2400, height: 1600, crop: { x: 3 } })?.crop).toBeNull();
    // A crop of the whole picture is no crop (`meaningfulCrop`).
    expect(readPublicCover({ keyPrefix: LADDER, width: 2400, height: 1600, crop: { x: 0, y: 0, w: 1, h: 1 } })?.crop).toBeNull();
  });

  it("is no cover for nothing, a film's poster or a value that is not one", () => {
    for (const value of [null, undefined, "", 42, {}, { keyPrefix: LADDER }, { keyPrefix: LADDER, width: 0, height: 10 }, { keyPrefix: "yt-abc_123", width: 480, height: 360 }]) {
      expect(readPublicCover(value), JSON.stringify(value)).toBeNull();
      expect(coverSources(value)).toBeNull();
    }
  });

  it("gives a laddered picture every rung under its master, and an older one its single file", () => {
    const laddered = coverSources({ keyPrefix: LADDER, width: 2400, height: 1350, crop: null });
    expect(laddered?.src).toMatch(new RegExp(`/${LADDER}/web\\.webp$`));
    expect(laddered?.thumb).toMatch(new RegExp(`/${LADDER}/thumb\\.webp$`));
    expect(laddered?.srcSet).toContain(`/${LADDER}/480w.webp 480w`);
    expect(laddered?.srcSet).toContain(`/${LADDER}/1920w.webp 1920w`);
    expect(laddered?.srcSet?.endsWith(`/${LADDER}/web.webp 2400w`)).toBe(true);
    expect(laddered?.sizes).toBe(pictureSizes("card"));
    expect({ width: laddered?.width, height: laddered?.height }).toEqual({ width: 2400, height: 1350 });

    const older = coverSources({ keyPrefix: OLDER, width: 2400, height: 1350, crop: null });
    expect(older?.src).toMatch(new RegExp(`/${OLDER}/web\\.webp$`));
    expect(older?.srcSet).toBeUndefined();
  });

  it("asks for the crop's magnification in the column it is drawn in", () => {
    const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const sources = coverSources({ keyPrefix: LADDER, width: 2400, height: 1350, crop }, "page");
    expect(sources?.crop).toEqual(crop);
    expect(sources?.sizes).toBe(pictureSizes("page", 100, 2));
  });
});
