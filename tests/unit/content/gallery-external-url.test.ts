import { describe, expect, it } from "vitest";
import { albumFieldsSchema } from "@/modules/content/gallery/fields";

/** «Link Google Photos» (§1047): an album's photos where they live — an `https://` address, or none. */
const base = {
  takenOn: "2026-11-21",
  eventId: "",
  translations: {
    ro: { slug: "crosul", title: "Crosul", description: "" },
    en: { slug: "the-cross", title: "The cross", description: "" },
  },
};

describe("«Link Google Photos» on an album", () => {
  it("takes an https address, trimmed", () => {
    const parsed = albumFieldsSchema.parse({ ...base, externalUrl: "  https://photos.app.goo.gl/gxrYMb2G8we3rFMT7 " });
    expect(parsed.externalUrl).toBe("https://photos.app.goo.gl/gxrYMb2G8we3rFMT7");
  });

  it("reads an empty box, or no box at all, as no link", () => {
    expect(albumFieldsSchema.parse({ ...base, externalUrl: "" }).externalUrl).toBeNull();
    expect(albumFieldsSchema.parse(base).externalUrl).toBeNull();
  });

  it("refuses an address that is not https or not whole", () => {
    expect(albumFieldsSchema.safeParse({ ...base, externalUrl: "http://photos.app.goo.gl/x" }).success).toBe(false);
    expect(albumFieldsSchema.safeParse({ ...base, externalUrl: "photos.app.goo.gl/x" }).success).toBe(false);
    expect(albumFieldsSchema.safeParse({ ...base, externalUrl: "https://a b" }).success).toBe(false);
  });
});
