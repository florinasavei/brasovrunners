import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-050-03, `DECISIONS.md` §NNN — «Din galerie» wherever the backoffice takes a picture, the
 * same shapes and crop box as an upload, and a film's poster the club can replace from the gallery
 * and crop to the part its 16∶9 box shows.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
  };
});

const { parseRichText } = await import("@/modules/content/rich-text/domain/schema");
const { presetCrop } = await import("@/modules/content/rich-text/domain/picture-frame");
const { cardFrameGeometry } = await import("@/modules/content/rich-text/ui/image-layout");
const { default: RichTextVideo } = await import("@/modules/content/rich-text/ui/RichTextVideo");
const { default: ImageCropBox } = await import("@/modules/content/rich-text/ui/ImageCropBox");

const source = (...where: string[]) => readFileSync(path.join(process.cwd(), ...where), "utf8");

const LADDER_POSTER = "/api/media/local/3f2a1b4c-0000-8abc-8def-000000000001/web.webp";
const YOUTUBE_POSTER = "/api/media/local/yt-dQw4w9WgXcQ/web.webp";

const film = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "", ...attrs } }],
});

const render = async (props: Parameters<typeof RichTextVideo>[0]) =>
  renderToStaticMarkup((await RichTextVideo(props)) as Parameters<typeof renderToStaticMarkup>[0]);

describe("§NNN the film's poster crop, stored on the node", () => {
  it("keeps a film stored before exactly as it was: no posterCrop key appears", () => {
    const doc = parseRichText(film({ poster: YOUTUBE_POSTER, posterSource: "youtube" }));
    expect("posterCrop" in (doc.content![0] as { attrs: object }).attrs).toBe(false);
  });

  it("keeps a crop over YouTube's own thumbnail and over a club poster", () => {
    for (const poster of [YOUTUBE_POSTER, LADDER_POSTER]) {
      const crop = { x: 0, y: 0.125, w: 1, h: 0.75 };
      const doc = parseRichText(film({ poster, posterWidth: 480, posterHeight: 360, posterCrop: crop }));
      expect((doc.content![0] as { attrs: { posterCrop: unknown } }).attrs.posterCrop).toEqual(crop);
    }
  });

  it("refuses a crop that ends outside the poster, and a stray key beside it", () => {
    expect(() => parseRichText(film({ poster: LADDER_POSTER, posterCrop: { x: 0.5, y: 0, w: 0.8, h: 1 } }))).toThrow(/end inside/);
    expect(() => parseRichText(film({ poster: LADDER_POSTER, posterCrop: { x: 0, y: 0, w: 1, h: 1, z: 1 } }))).toThrow();
  });
});

describe("§NNN the page draws the part the club chose", () => {
  it("draws a cropped poster in the card frame's own window, not covered", async () => {
    // YouTube's 4∶3 thumbnail with its letterbox bars: the club keeps the middle band.
    const crop = presetCrop("16:9", { width: 480, height: 360 })!;
    const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", poster: YOUTUBE_POSTER, posterWidth: 480, posterHeight: 360, posterCrop: crop });
    const geometry = cardFrameGeometry({ crop, width: 480, height: 360 })!.geometry;
    expect(html).toContain(`src="${YOUTUBE_POSTER}"`);
    expect(html).not.toContain("object-fit:cover");
    expect(html).toContain(`width:${geometry.width}`);
    expect(html).toContain(`top:${geometry.top}`);
    expect(html).toContain("max-width:none");
  });

  it("pulls an off-centre crop to its corner, and a club poster's sizes grow with the magnification", async () => {
    const crop = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", poster: LADDER_POSTER, posterWidth: 1920, posterHeight: 1080, posterCrop: crop });
    // Half the poster fills the box: drawn twice as wide, pulled left and up by a whole box.
    expect(html).toContain("width:200%");
    expect(html).toContain("left:-100%");
    expect(html).toContain("top:-100%");
    // The widths offered are what a box twice the column's width needs.
    expect(html).toContain('sizes="(min-width: 1536px) 2976px');
  });

  it("covers the box, centred, without a crop — or without the poster's size to shape one from", async () => {
    for (const props of [
      { poster: YOUTUBE_POSTER, posterWidth: 480, posterHeight: 360 },
      { poster: YOUTUBE_POSTER, posterCrop: { x: 0, y: 0.125, w: 1, h: 0.75 } },
    ]) {
      const html = await render({ videoId: "dQw4w9WgXcQ", caption: "", ...props });
      expect(html).toContain("object-fit:cover");
      expect(html).not.toContain("max-width:none");
    }
  });

  it("hands the crop from the stored body to the film", () => {
    expect(source("src", "modules", "content", "rich-text", "ui", "RichText.tsx")).toContain("posterCrop={block.attrs.posterCrop ?? null}");
  });
});

describe("§NNN the crop box holds a poster to its box's one shape", () => {
  const labels = {
    title: "Decupaj",
    help: "",
    reset: "Mijlocul",
    position: "{w} {h} {x} {y}",
    presets: "Format",
    preset: { free: "Liber", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", "4:5": "4:5" },
    target: "",
    targetCrop: "",
    targetFocus: "",
    focusHelp: "",
    focusReset: "",
    focusPosition: "",
    cardPreview: "",
  };

  it("offers only 16:9, pressed, for a poster", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCropBox, {
        src: YOUTUBE_POSTER,
        intrinsic: { width: 480, height: 360 },
        crop: presetCrop("16:9", { width: 480, height: 360 }),
        onChange: () => undefined,
        presets: ["16:9"],
        testId: "rich-text-poster-crop",
        labels,
      }),
    );
    expect(html).toContain('data-testid="rich-text-poster-crop"');
    expect(html).not.toContain(">Liber<");
    expect(html).not.toContain(">4:3<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>16:9</);
  });

  it("still offers all five shapes to a picture in a text", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCropBox, { src: LADDER_POSTER, intrinsic: { width: 1600, height: 900 }, crop: null, onChange: () => undefined, labels }),
    );
    for (const name of ["Liber", "16:9", "4:3", "1:1", "4:5"]) expect(html).toContain(`>${name}<`);
    expect(html).toContain('data-testid="rich-text-crop"');
  });
});

describe("§NNN «Din galerie» wherever the backoffice takes a picture", () => {
  const picker = "@/modules/media/ui/GalleryPicker";
  const places = {
    "a picture in a text, and a film's poster": ["src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx"],
    "a card of «Echipa»": ["src", "modules", "content", "team", "ui", "TeamPhotoField.tsx"],
    "an album": ["src", "modules", "content", "gallery", "ui", "PhotoUploader.tsx"],
  } as const;

  for (const [place, file] of Object.entries(places)) {
    it(`offers the one picker in ${place}`, () => {
      const text = source(...file);
      expect(text).toContain(`from "${picker}"`);
      expect(text).toContain("<GalleryPicker");
    });
  }

  it("puts a picture from the gallery into a text in the shape chosen, as an upload goes in", () => {
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    const insertStored = editor.slice(editor.indexOf("const insertStored"), editor.indexOf("const insertStored") + 900);
    expect(insertStored).toContain("uploadShapeRef.current");
    expect(insertStored).toContain("presetCrop(shape");
    // The same shape choice beside the gallery as beside the upload.
    expect(editor).toContain('testId="rich-text-gallery-shape"');
    expect(editor).toContain('testId="rich-text-upload-shape"');
  });

  it("gives a film a poster from the gallery as the club's own, uncropped, which the automatic fetch leaves alone", () => {
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    const pick = editor.slice(editor.indexOf("const pickPosterFromGallery"), editor.indexOf("const pickPosterFromGallery") + 700);
    expect(pick).toContain('posterSource: "club"');
    expect(pick).toContain("posterCrop: null");
    // Falling back to YouTube's own thumbnail clears the crop drawn over the club's.
    expect(editor).toMatch(/posterSource: null, posterWidth: null, posterHeight: null, posterCrop: null/);
  });

  it("leaves a film's automatic poster out of a text and an album by default, and offers it to a poster", () => {
    const pickerSource = source("src", "modules", "media", "ui", "GalleryPicker.tsx");
    expect(pickerSource).toContain("accept = (picture) => !picture.poster");
    expect(source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx")).toContain("accept={() => true}");
    expect(source("src", "app", "api", "admin", "media", "route.ts")).toContain('poster: asset.keyPrefix.startsWith("yt-")');
  });
});
