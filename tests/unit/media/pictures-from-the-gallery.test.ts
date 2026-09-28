import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-050-03, `DECISIONS.md` §485 — «Din galerie» wherever the backoffice takes a picture, the
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
const { foldForSearch, parsePickerScope, parsePictureSource, pickerScopeParam, pictureUses, usedHere, visiblePictures } = await import(
  "@/modules/media/picker"
);

const source = (...where: string[]) => readFileSync(path.join(process.cwd(), ...where), "utf8");

const LADDER_POSTER = "/api/media/local/3f2a1b4c-0000-8abc-8def-000000000001/web.webp";
const YOUTUBE_POSTER = "/api/media/local/yt-dQw4w9WgXcQ/web.webp";

const film = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "", ...attrs } }],
});

const render = async (props: Parameters<typeof RichTextVideo>[0]) =>
  renderToStaticMarkup((await RichTextVideo(props)) as Parameters<typeof renderToStaticMarkup>[0]);

describe("§485 the film's poster crop, stored on the node", () => {
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

describe("§485 the page draws the part the club chose", () => {
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

describe("§485 the crop box offers a poster every shape, its box's first", () => {
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

  it("offers all five shapes for a poster, 16:9 pressed while nothing is stored", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCropBox, {
        src: YOUTUBE_POSTER,
        intrinsic: { width: 480, height: 360 },
        crop: presetCrop("16:9", { width: 480, height: 360 }),
        onChange: () => undefined,
        resting: "16:9",
        testId: "rich-text-poster-crop",
        labels,
      }),
    );
    expect(html).toContain('data-testid="rich-text-poster-crop"');
    for (const name of ["Liber", "16:9", "4:3", "1:1", "4:5"]) expect(html).toContain(`>${name}<`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>16:9</);
    expect(html).not.toMatch(/aria-pressed="true"[^>]*>Liber</);
  });

  it("holds the shape a stored poster crop was drawn with, 1:1 included", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCropBox, {
        src: YOUTUBE_POSTER,
        intrinsic: { width: 480, height: 360 },
        crop: presetCrop("1:1", { width: 480, height: 360 }),
        onChange: () => undefined,
        resting: "16:9",
        labels,
      }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>1:1</);
  });

  it("gives the editor's poster box the default shapes and 16:9 at rest", () => {
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    expect(editor).not.toContain("POSTER_PRESETS");
    expect(editor).toContain('resting="16:9"');
  });

  it("still offers all five shapes to a picture in a text", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCropBox, { src: LADDER_POSTER, intrinsic: { width: 1600, height: 900 }, crop: null, onChange: () => undefined, labels }),
    );
    for (const name of ["Liber", "16:9", "4:3", "1:1", "4:5"]) expect(html).toContain(`>${name}<`);
    expect(html).toContain('data-testid="rich-text-crop"');
  });
});

describe("§485 «Din galerie» wherever the backoffice takes a picture", () => {
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

  it("asks for a film's automatic poster only from the film's own poster picker", () => {
    const pickerSource = source("src", "modules", "media", "ui", "GalleryPicker.tsx");
    expect(pickerSource).toContain("withPosters = false");
    expect(pickerSource).toContain('query.set("posters", "1")');
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    expect(editor.match(/\bwithPosters\b/g)).toHaveLength(1);
    expect(source("src", "modules", "content", "team", "ui", "TeamPhotoField.tsx")).not.toContain("withPosters");
    expect(source("src", "modules", "content", "gallery", "ui", "PhotoUploader.tsx")).not.toContain("withPosters");
  });
});

describe("§485 the picker's query: order, rule, search and source", () => {
  type P = { id: string; name: string; uses: ("event" | "album" | "page" | "team")[]; poster?: boolean };
  // Newest first, as the route reads them.
  const list: P[] = [
    { id: "5", name: "Hartă traseu Tâmpa.png", uses: ["event"] },
    { id: "4", name: "yt-dQw4w9WgXcQ", uses: ["event"], poster: true },
    { id: "3", name: "afis-CROSUL.jpg", uses: ["album", "page"] },
    { id: "2", name: "Ioana.jpg", uses: ["team"] },
    { id: "1", name: "harta-veche.jpg", uses: [] },
  ];
  const ids = (pictures: readonly P[]) => pictures.map((picture) => picture.id);

  it("keeps the list's own order, newest first, and every picture when nothing narrows it", () => {
    expect(ids(visiblePictures(list))).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("finds a name whatever its case and its diacritics", () => {
    expect(ids(visiblePictures(list, { needle: "harta" }))).toEqual(["5", "1"]);
    expect(ids(visiblePictures(list, { needle: "HARTĂ" }))).toEqual(["5", "1"]);
    expect(ids(visiblePictures(list, { needle: "  tampa " }))).toEqual(["5"]);
    expect(ids(visiblePictures(list, { needle: "crosul" }))).toEqual(["3"]);
    expect(ids(visiblePictures(list, { needle: "nimic" }))).toEqual([]);
    expect(foldForSearch("Șoseaua Țării")).toBe("soseaua tarii");
  });

  it("holds the place's rule: a film's automatic poster only where it is asked for", () => {
    expect(ids(visiblePictures(list, { accept: (picture) => !picture.poster }))).toEqual(["5", "3", "2", "1"]);
    expect(ids(visiblePictures(list, { accept: () => true }))).toContain("4");
  });

  it("narrows by where a picture is used, «toate» being no narrowing", () => {
    expect(ids(visiblePictures(list, { source: "event" }))).toEqual(["5", "4"]);
    expect(ids(visiblePictures(list, { source: "album" }))).toEqual(["3"]);
    expect(ids(visiblePictures(list, { source: "page" }))).toEqual(["3"]);
    expect(ids(visiblePictures(list, { source: "team" }))).toEqual(["2"]);
    expect(ids(visiblePictures(list, { source: "all" }))).toHaveLength(5);
    expect(ids(visiblePictures(list, { source: "event", needle: "harta", accept: (p) => !p.poster }))).toEqual(["5"]);
  });

  it("reads the source strictly and folds the team page's introduction into «Echipa»", () => {
    expect(parsePictureSource("album")).toBe("album");
    expect(parsePictureSource("ALBUM")).toBe("all");
    expect(parsePictureSource("teamIntro")).toBe("all");
    expect(parsePictureSource(null)).toBe("all");
    expect(pictureUses(["teamIntro", "page", "team", "album", "page"])).toEqual(["album", "page", "team"]);
    expect(pictureUses([])).toEqual([]);
  });

  it("has a word for every chip in both catalogues", async () => {
    for (const locale of ["ro", "en"] as const) {
      const messages = (await import(`../../../messages/${locale}.json`)).default as { Admin: { richText: Record<string, string> } };
      for (const key of ["SourceLegend", "SourceAll", "SourceEvent", "SourceAlbum", "SourcePage", "SourceTeam"]) {
        expect(messages.Admin.richText[`imageGallery${key}`], `${locale} imageGallery${key}`).toBeTruthy();
      }
    }
  });
});

describe("§485 «Acest eveniment»: the picker opens on the place it was opened from", () => {
  const EVENT = "3f2a1b4c-0000-4abc-8def-000000000001";

  it("reads the place strictly: three kinds and a UUID, else none", () => {
    expect(parsePickerScope(`event:${EVENT}`)).toEqual({ kind: "event", id: EVENT });
    expect(parsePickerScope(`album:${EVENT}`)).toEqual({ kind: "album", id: EVENT });
    expect(parsePickerScope(`page:${EVENT}`)).toEqual({ kind: "page", id: EVENT });
    expect(parsePickerScope(`team:${EVENT}`)).toBeNull();
    expect(parsePickerScope("event:1; DROP TABLE")).toBeNull();
    expect(parsePickerScope(null)).toBeNull();
    expect(pickerScopeParam({ kind: "event", id: EVENT })).toBe(`event:${EVENT}`);
  });

  it("«here» is a source only with a place", () => {
    expect(parsePictureSource("here", true)).toBe("here");
    expect(parsePictureSource("here")).toBe("all");
    expect(parsePictureSource("event", true)).toBe("event");
  });

  it("says a picture is used here by kind AND id, never by kind alone", () => {
    const refs = [{ kind: "event", id: EVENT }, { kind: "album", id: "a" }];
    expect(usedHere(refs, { kind: "event", id: EVENT })).toBe(true);
    expect(usedHere(refs, { kind: "event", id: "another" })).toBe(false);
    expect(usedHere(refs, { kind: "page", id: EVENT })).toBe(false);
    expect(usedHere([], { kind: "event", id: EVENT })).toBe(false);
  });

  it("narrows to the place's own pictures by the server's flag, never by the kind chip", () => {
    const list = [
      { id: "1", name: "a.jpg", uses: ["event" as const], here: true },
      { id: "2", name: "b.jpg", uses: ["event" as const], here: false },
      { id: "3", name: "c.jpg", uses: [] },
    ];
    expect(visiblePictures(list, { source: "here" }).map((p) => p.id)).toEqual(["1"]);
    expect(visiblePictures(list, { source: "event" }).map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("hands every event text its event, a page's text its page and an album's picker its album", () => {
    const fields = source("src", "modules", "content", "events", "ui", "TranslationFields.tsx");
    expect(fields.match(/pictureScope=\{pictureScopeOf\(translation\)\}/g)).toHaveLength(5);
    expect(fields).toContain('{ kind: "event", id: translation.eventId }');
    expect(source("src", "modules", "content", "pages", "ui", "PageFieldsForm.tsx")).toContain('{ kind: "page", id: pageId }');
    expect(source("src", "app", "[locale]", "admin", "pages", "[id]", "page.tsx")).toContain("pageId={page.id}");
    const album = source("src", "modules", "content", "gallery", "ui", "PhotoUploader.tsx");
    expect(album).toContain('scope={{ kind: "album", id: albumId }}');
  });

  it("the picker asks the server for its place and starts on it; both pickers in a text pass it", () => {
    const picker = source("src", "modules", "media", "ui", "GalleryPicker.tsx");
    expect(picker).toContain('query.set("for", scopeParam)');
    expect(picker).toContain('scoped && opensHere ? "here" : "all"');
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    expect(editor.match(/scope=\{pictureScope\}/g)).toHaveLength(2);
  });

  it("has the three chip words in both catalogues", async () => {
    for (const locale of ["ro", "en"] as const) {
      const messages = (await import(`../../../messages/${locale}.json`)).default as { Admin: { richText: Record<string, string> } };
      for (const key of ["Event", "Album", "Page"]) expect(messages.Admin.richText[`imageGalleryHere${key}`], `${locale} ${key}`).toBeTruthy();
    }
  });
});

describe("§485 the event's card picture (§454) takes «Din galerie» like an upload", () => {
  const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
  const fields = source("src", "modules", "content", "events", "ui", "TranslationFields.tsx");

  it("the summary — the card's picture slot — is the editor with card pictures and the whole toolbar", () => {
    const summary = fields.slice(fields.indexOf('name={name("excerptBody")}'), fields.indexOf('translateButton(translation, name("excerptBody"))'));
    expect(summary).toContain("cardPictures");
    expect(summary).not.toContain("features=");
  });

  it("offers «Din galerie» with every picture control, not only outside the card", () => {
    const gallery = editor.indexOf("label={labels.imageFromGallery}");
    const mediaGate = editor.lastIndexOf("features.media !== false", gallery);
    expect(gallery).toBeGreaterThan(0);
    expect(mediaGate).toBeGreaterThan(0);
    expect(editor.slice(mediaGate, gallery)).not.toContain("cardPictures");
  });

  it("a chosen picture carries its size, so the crop box with the card's frame and «Centrul pe card» opens on it", () => {
    const insertStored = editor.slice(editor.indexOf("const insertStored"), editor.indexOf("const insertStored") + 900);
    expect(insertStored).toContain("width: picture.width, height: picture.height");
    expect(editor).toContain("card={cardPictures}");
  });
});

describe("§485 the same action looks the same everywhere", () => {
  it("the team card's «Din galerie» wears the gallery glyph through GlyphButton", () => {
    const team = source("src", "modules", "content", "team", "ui", "TeamPhotoField.tsx");
    expect(team).toContain('from "@/shared/ui/GlyphButton"');
    expect(team).toMatch(/<GlyphButton\s+icon="gallery"/);
    expect(source("src", "modules", "content", "gallery", "ui", "PhotoUploader.tsx")).toContain("ACTION_ICONS.gallery");
  });
});
