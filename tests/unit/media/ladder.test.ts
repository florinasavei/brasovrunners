import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RichText from "@/modules/content/rich-text/ui/RichText";
import {
  coverMagnification,
  isLadderKeyPrefix,
  LADDER_WIDTHS,
  ladderKeyPrefixOf,
  ladderWidths,
  parseImageQuality,
  pictureSizes,
  pictureSrcSet,
} from "@/modules/media/ladder";
import { describeStoredImage, formatBytes } from "@/modules/media/ui/stored-facts";

/**
 * BR-REQ-054-01 criterion 12, BR-REQ-050-03 criterion 22 (`DECISIONS.md` §NNN) — a picture is
 * stored at the widths the site draws it at, and every public `<img>` lets the browser choose.
 *
 * The owner, 2026-09-25: "I wanna choose the quality of the image when uploading it — cuz it's
 * super pixelated." What was wrong was one file for every screen: the master for a 320-pixel phone
 * (bytes nobody needed) and the 640-pixel thumbnail for a gallery cover across a 3× phone (an
 * enlargement everybody saw). These are the rules that decide which file a page may ask for.
 */
const LADDER_PREFIX = ladderKeyPrefixOf("3f2a1b4c-0000-4abc-8def-000000000001");
const OLD_PREFIX = "3f2a1b4c-0000-4abc-8def-000000000002";
const r2 = (prefix: string) => `https://pub-example.r2.dev/production/${prefix}/web.webp`;

describe("§NNN the quality a request may ask for", () => {
  it("is normal when nothing is asked, one of the two words otherwise, and refused for anything else", () => {
    expect(parseImageQuality(null)).toBe("normal");
    expect(parseImageQuality(undefined)).toBe("normal");
    expect(parseImageQuality("")).toBe("normal");
    expect(parseImageQuality("normal")).toBe("normal");
    expect(parseImageQuality("high")).toBe("high");
    for (const refused of ["HIGH", "hd", "max", "100", 92, {}]) expect(parseImageQuality(refused), String(refused)).toBeNull();
  });
});

describe("§NNN the ladder", () => {
  it("stores every rung narrower than 0.9 of the master, and never one wider", () => {
    expect(ladderWidths(2400)).toEqual([...LADDER_WIDTHS]);
    // A 1725-pixel portrait: 1600 would be the master again for 7% fewer bytes.
    expect(ladderWidths(1725)).toEqual([480, 640, 960, 1280]);
    expect(ladderWidths(1080)).toEqual([480, 640, 960]);
    expect(ladderWidths(500)).toEqual([]);
    for (const master of [300, 700, 1300, 2400]) for (const width of ladderWidths(master)) expect(width).toBeLessThan(master);
  });

  it("covers a phone at 3×, a card, a tile and a laptop at 2× with at most half again what is drawn", () => {
    const all = [...LADDER_WIDTHS, 2400];
    for (let index = 1; index < all.length; index += 1) expect(all[index] / all[index - 1]).toBeLessThanOrEqual(1.5);
    // A 390-pixel phone's column at 3× is 1074 physical pixels: the 1280 rung, not the master.
    expect(all.find((width) => width >= (390 - 32) * 3)).toBe(1280);
  });

  it("marks a new asset's prefix as version 8, and reads every older prefix as having no ladder", () => {
    expect(isLadderKeyPrefix(LADDER_PREFIX)).toBe(true);
    expect(LADDER_PREFIX).toMatch(/^[0-9a-f-]{36}$/);
    expect(isLadderKeyPrefix(OLD_PREFIX)).toBe(false);
    expect(isLadderKeyPrefix(crypto.randomUUID())).toBe(false);
    expect(isLadderKeyPrefix(ladderKeyPrefixOf(crypto.randomUUID()))).toBe(true);
  });
});

describe("§NNN srcset", () => {
  it("names every rung and then the master for a picture with a ladder", () => {
    const srcSet = pictureSrcSet(r2(LADDER_PREFIX), 1725, 2400);
    expect(srcSet).toBe(
      [480, 640, 960, 1280].map((w) => `https://pub-example.r2.dev/production/${LADDER_PREFIX}/${w}w.webp ${w}w`).join(", ") +
        `, ${r2(LADDER_PREFIX)} 1725w`,
    );
    // The local store's relative address works the same way.
    expect(pictureSrcSet(`/api/media/local/${LADDER_PREFIX}/web.webp`, 1080, 1350)).toContain(`/api/media/local/${LADDER_PREFIX}/960w.webp 960w`);
  });

  it("offers an older picture its thumbnail and its master, and nothing it does not have", () => {
    // Every stored picture has had a thumbnail beside it; no older one has a rung.
    expect(pictureSrcSet(r2(OLD_PREFIX), 2400, 1600)).toBe(
      `https://pub-example.r2.dev/production/${OLD_PREFIX}/thumb.webp 640w, ${r2(OLD_PREFIX)} 2400w`,
    );
    // A portrait's thumbnail is 640 tall, so narrower.
    expect(pictureSrcSet(r2(OLD_PREFIX), 1600, 2400)).toContain("thumb.webp 427w");
    // Small enough that the thumbnail is the picture: nothing to choose.
    expect(pictureSrcSet(r2(OLD_PREFIX), 600, 400)).toBeUndefined();
    // No size recorded (a body from before the upload route stored one), or not our address.
    expect(pictureSrcSet(r2(OLD_PREFIX), null, null)).toBeUndefined();
    expect(pictureSrcSet(r2(LADDER_PREFIX), undefined)).toBeUndefined();
    expect(pictureSrcSet("https://example.test/picture.jpg", 2400, 1600)).toBeUndefined();
  });
});

describe("§NNN sizes", () => {
  it("says the event column's width, the share from sm up, and the full phone below it", () => {
    expect(pictureSizes("page")).toBe("(min-width: 1536px) 1488px, (min-width: 600px) calc(100vw - 48px), calc(100vw - 32px)");
    expect(pictureSizes("page", 50)).toBe("(min-width: 1536px) 744px, (min-width: 600px) calc(50vw - 24px), calc(100vw - 32px)");
    expect(pictureSizes("prose", 33)).toBe("(min-width: 1008px) 317px, (min-width: 600px) calc(33vw - 16px), calc(100vw - 32px)");
  });

  it("magnifies a cropped picture everywhere, a phone included", () => {
    // Half the photograph's width is shown, so the photograph is drawn twice its window.
    expect(pictureSizes("page", 100, 2)).toBe("(min-width: 1536px) 2976px, (min-width: 600px) calc(200vw - 96px), calc(200vw - 64px)");
  });

  it("measures a card, a tile and a cover from their grids", () => {
    expect(pictureSizes("card")).toBe("(min-width: 1536px) 448px, (min-width: 900px) calc(50vw - 68px), calc(100vw - 64px)");
    expect(pictureSizes("tile")).toContain("calc(50vw - 20px)");
    expect(pictureSizes("cover")).toMatch(/calc\(100vw - 32px\)$/);
  });

  it("widens a tile for a photograph wider than 4:3, and never for a taller one", () => {
    expect(coverMagnification(1500, 1000, 4 / 3)).toBeCloseTo(1.125);
    expect(coverMagnification(1000, 1500, 4 / 3)).toBe(1);
    expect(coverMagnification(0, 0, 4 / 3)).toBe(1);
  });
});

describe("§NNN the body renderer", () => {
  const doc = (src: string, attrs: Record<string, unknown> = {}) => ({
    type: "doc",
    content: [{ type: "image", attrs: { src, alt: "Startul", width: 2400, height: 1600, ...attrs } }],
  });
  const render = (body: unknown, pictures?: "page" | "prose" | "card") =>
    renderToStaticMarkup(createElement(RichText, { body, pictures }));

  it("gives a picture with a ladder its srcset and the column's sizes", () => {
    const html = render(doc(r2(LADDER_PREFIX)));
    expect(html).toContain(`src="${r2(LADDER_PREFIX)}"`);
    expect(html).toContain(`${LADDER_PREFIX}/1920w.webp 1920w`);
    expect(html).toContain('sizes="(min-width: 1536px) 1488px');
  });

  it("uses the standing page's measure, a card's width and the organizer's share", () => {
    expect(render(doc(r2(LADDER_PREFIX), { widthPercent: 50 }), "prose")).toContain('sizes="(min-width: 1008px) 480px');
    // A card's picture is the card's width whatever share the page gives it.
    expect(render(doc(r2(LADDER_PREFIX), { widthPercent: 33 }), "card")).toContain('sizes="(min-width: 1536px) 448px');
  });

  it("asks a cropped picture for the magnified width", () => {
    const html = render(doc(r2(LADDER_PREFIX), { crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }));
    expect(html).toContain("(min-width: 1536px) 2976px");
  });

  it("renders a picture written before the upload stored its size exactly as before", () => {
    const html = render({ type: "doc", content: [{ type: "image", attrs: { src: r2(OLD_PREFIX), alt: "" } }] });
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("sizes");
  });
});

describe("§NNN what the person is told after an upload", () => {
  const labels = {
    template: "{width} × {height}, {quality}: {size}; {files} files, {total}",
    normal: "normal",
    high: "high",
    nearLossless: "high, near-lossless",
  };
  const facts = { width: 2400, height: 1857, quality: "normal" as const, encoding: "lossy" as const, bytes: 390_000, files: 8, totalBytes: 1_090_000 };

  it("states the size, the choice, the bytes and the files", () => {
    expect(describeStoredImage(facts, labels, "en")).toBe("2400 × 1857, normal: 381 KB; 8 files, 1 MB");
    expect(describeStoredImage({ ...facts, quality: "high", encoding: "nearLossless" }, labels, "en")).toContain("high, near-lossless");
    expect(describeStoredImage({ ...facts, quality: "high" }, labels, "en")).toContain(", high:");
  });

  it("writes a megabyte with the page's decimal separator", () => {
    expect(formatBytes(1.5 * 1024 * 1024, "ro")).toBe("1,5 MB");
    expect(formatBytes(1.5 * 1024 * 1024, "en")).toBe("1.5 MB");
    expect(formatBytes(100, "ro")).toBe("1 KB");
  });
});
