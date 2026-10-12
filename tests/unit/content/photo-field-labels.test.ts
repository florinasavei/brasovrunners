import { describe, expect, it } from "vitest";
import { coverPhotoLabels } from "@/modules/content/events/ui/cover-labels";
import { shopPhotoLabels } from "@/modules/content/shop/ui/photo-labels";
import { photoFieldLabels } from "@/modules/content/team/ui/photo-field-labels";

/** §541: every picture field gets the house's one set of words; only four captions are the caller's. */
const t = ((key: string, values?: Record<string, string>) => (values ? `${key}${JSON.stringify(values)}` : key)) as never;
const rich = {
  imageCropReset: "reset",
  imageCropPosition: "position",
  imageShapes: { shapeLegend: "shape" },
  imageChosen: { chosen: "chosen" },
  imageStored: { stored: "stored" },
  imageFromGalleryPicked: "picked",
} as never;

const own = { legend: "L", help: "H", cropTitle: "CT", cropHelp: "CH" };

/** Everything but the four captions a caller owns. */
function common(labels: ReturnType<typeof photoFieldLabels>) {
  return { ...labels, legend: "", help: "", crop: { ...labels.crop, title: "", help: "" } };
}

describe("photoFieldLabels (§541)", () => {
  const built = photoFieldLabels(t, rich, own);

  it("reads the house's words from the one catalogue", () => {
    expect(built.choose).toBe("team.photoChoose");
    expect(built.replace).toBe("team.photoReplace");
    expect(built.remove).toBe("team.photoRemove");
    expect(built.uploading).toBe("team.photoUploading");
    expect(built.failed).toBe("team.photoFailed");
    expect(built.none).toBe("team.photoNone");
    expect(built.fromGallery).toBe("team.photoFromGallery");
    expect(built.gallery.close).toBe("richText.linkCancel");
    expect(built.gallery.sources.team).toBe("richText.imageGallerySourceTeam");
    expect(built.quality.legend).toBe("gallery.qualityLegend");
    expect(built.quality.help).toContain("gallery.qualityHelp");
    expect(built.crop).toMatchObject({ reset: "reset", position: "position", shapeLegend: "shape" });
    expect(built.picked).toBe("picked");
  });

  it("takes the four captions from the caller", () => {
    expect([built.legend, built.help, built.crop.title, built.crop.help]).toEqual(["L", "H", "CT", "CH"]);
  });

  it("gives the cover and the shop the same common words, each its own captions", () => {
    const cover = coverPhotoLabels(t, rich);
    const shop = shopPhotoLabels(t, rich, "shop legend");
    const guide = shopPhotoLabels(t, rich, "guide", { help: "gh", cropHelp: "gch" });
    expect(common(cover)).toEqual(common(built));
    expect(common(shop)).toEqual(common(built));
    expect(common(guide)).toEqual(common(built));
    expect([cover.legend, cover.help, cover.crop.title, cover.crop.help]).toEqual([
      "editor.cover.legend",
      "editor.cover.help",
      "editor.cover.cropTitle",
      "editor.cover.cropHelp",
    ]);
    expect([shop.legend, shop.help, shop.crop.title, shop.crop.help]).toEqual([
      "shop legend",
      "members.shop.photoHelp",
      "members.shop.photoCrop",
      "members.shop.photoCropHelp",
    ]);
    expect([guide.help, guide.crop.help]).toEqual(["gh", "gch"]);
  });
});
