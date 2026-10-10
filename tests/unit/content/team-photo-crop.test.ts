import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { presetOf } from "@/modules/content/rich-text/domain/picture-frame";
import { teamMemberFieldsSchema } from "@/modules/content/team/fields";
import { readTeamPhotoCrop, storedTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { COVER_SX, teamPhotoFrame } from "@/modules/content/team/ui/team-photo-frame";
import TeamPhotoField, { initialTeamCrop, TEAM_PHOTO_SHAPE, type TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * §541 (amending §474 and §454) — a card of «Echipa» takes its photograph through the upload every
 * other picture has, with the crop box: 1∶1 first, any of the five shapes after, the crop saved with
 * the person as §241's four fractions and drawn by one rule on the page, the list and the preview.
 * A card saved before this has no crop and draws exactly the square it always drew.
 */

const base = { name: "Ana Popescu", roleRo: "", roleEn: "", bioRo: "", bioEn: "", photoAssetId: "" };
const PHOTO_ID = "0f6c4a36-5d1a-4b8e-9c3d-2a1b0c9d8e7f";
const PORTRAIT_CROP = { x: 0.1, y: 0.05, w: 0.6, h: 0.5 };

const issuesOf = (input: Record<string, unknown>) => {
  const result = teamMemberFieldsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("§541 the saved crop's shape", () => {
  it("reads the crop box's JSON, an object, or nothing — and the whole photograph is no crop", () => {
    expect(readTeamPhotoCrop(JSON.stringify(PORTRAIT_CROP))).toEqual(PORTRAIT_CROP);
    expect(readTeamPhotoCrop(PORTRAIT_CROP)).toEqual(PORTRAIT_CROP);
    for (const none of [undefined, null, "", "null", JSON.stringify({ x: 0, y: 0, w: 1, h: 1 })]) {
      expect(readTeamPhotoCrop(none)).toBeNull();
    }
  });

  it("calls anything the box could not draw invalid — outside the picture, a stray key, not JSON", () => {
    for (const bad of ["{", JSON.stringify({ x: 0.5, y: 0, w: 0.8, h: 0.5 }), JSON.stringify({ ...PORTRAIT_CROP, z: 1 }), "[1,2]", 7]) {
      expect(readTeamPhotoCrop(bad)).toBe("invalid");
    }
    // A stored row written wrong by hand reads as no crop, never a broken card.
    expect(storedTeamPhotoCrop({ x: 2 })).toBeNull();
    expect(storedTeamPhotoCrop(PORTRAIT_CROP)).toEqual(PORTRAIT_CROP);
  });

  it("keeps the crop with a photograph, drops it without one, and refuses a bad one on the photo box", () => {
    const withPhoto = teamMemberFieldsSchema.parse({ ...base, photoAssetId: PHOTO_ID, photoCrop: JSON.stringify(PORTRAIT_CROP) });
    expect(withPhoto.photoCrop).toEqual(PORTRAIT_CROP);
    expect(teamMemberFieldsSchema.parse({ ...base, photoCrop: JSON.stringify(PORTRAIT_CROP) }).photoCrop).toBeNull();
    // A caller that posts no crop at all — §459's form, a fixture, the seed — keeps the whole photograph.
    expect(teamMemberFieldsSchema.parse({ ...base, photoAssetId: PHOTO_ID }).photoCrop).toBeNull();
    expect(issuesOf({ ...base, photoAssetId: PHOTO_ID, photoCrop: "{" })).toEqual(["photoAssetId"]);
  });
});

describe("§541 the card draws the crop, or the square it always drew", () => {
  const LANDSCAPE = { width: 4000, height: 3000 };

  it("without a crop: the old square, covered, the face near the top", () => {
    const frame = teamPhotoFrame({ ...LANDSCAPE, crop: null });
    expect(frame).toEqual({ kind: "cover", image: COVER_SX, magnify: 4 / 3 });
    expect(COVER_SX).toMatchObject({ aspectRatio: "1 / 1", objectFit: "cover", objectPosition: "50% 25%" });
  });

  it("with a crop: §241's window in the crop's own shape, magnified by 1 / w for `sizes`", () => {
    const square = initialTeamCrop(LANDSCAPE);
    expect(square).not.toBeNull();
    const frame = teamPhotoFrame({ ...LANDSCAPE, crop: square });
    expect(frame.kind).toBe("crop");
    if (frame.kind !== "crop" || !square) return;
    expect(Number(frame.window.aspectRatio)).toBeCloseTo(1, 3);
    expect(frame.magnify).toBeCloseTo(1 / square.w, 6);
    expect(frame.image).toMatchObject({ position: "absolute", maxWidth: "none" });
  });

  it("starts a new photograph square — 1∶1, a portrait — in the middle, and a square photograph needs none", () => {
    expect(TEAM_PHOTO_SHAPE).toBe("1:1");
    const crop = initialTeamCrop(LANDSCAPE);
    expect(crop && presetOf(crop, LANDSCAPE)).toBe("1:1");
    expect(crop?.x).toBeCloseTo((1 - 0.75) / 2, 3);
    expect(initialTeamCrop({ width: 800, height: 800 })).toBeNull();
  });

  it("renders one component on the page, the list and the preview: a window with a crop, a plain square without", () => {
    const cropped = renderToStaticMarkup(
      createElement(TeamPhotoImage, { src: "/thumb.webp", photo: { ...LANDSCAPE, crop: PORTRAIT_CROP }, testId: "team-photo" }),
    );
    expect(cropped).toContain('data-crop="set"');
    expect(cropped).toContain('alt=""');
    const plain = renderToStaticMarkup(createElement(TeamPhotoImage, { src: "/thumb.webp", photo: { ...LANDSCAPE, crop: null } }));
    expect(plain).toContain('data-crop="none"');
  });
});

describe("§541 the photo field's wiring", () => {
  const labels: TeamPhotoLabels = {
    legend: "Fotografia",
    choose: "Alege o fotografie",
    // One word wherever a picture is replaced (§673).
    replace: "Înlocuiește",
    remove: "Scoate fotografia",
    uploading: "Se încarcă…",
    failed: "Nu s-a încărcat.",
    none: "Fără fotografie",
    help: "Ajutor",
    quality: { legend: "Calitate", low: "Minimă", normal: "Medie", high: "Mare", original: "Originală", help: "" },
    fromGallery: "Din galerie",
    gallery: {
      loading: "",
      empty: "",
      close: "",
      filter: "",
      noMatch: "",
      sourceLegend: "",
      sources: { all: "", event: "", album: "", page: "", team: "" },
    },
    crop: {
      title: "Decupaj — ce se vede pe card",
      help: "",
      reset: "Fără decupaj",
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
    },
    chosen: { chosen: "", sent: "", lighter: "" },
    stored: { template: "", topRung: "", low: "", normal: "", high: "", original: "", nearLossless: "" },
    picked: "",
  };
  const photo = { id: PHOTO_ID, src: "/web.webp", preview: "/thumb.webp", width: 4000, height: 3000 };
  const render = (props: Partial<Parameters<typeof TeamPhotoField>[0]>, recalled?: Record<string, string>) =>
    renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(RecallProvider, {
        value: {
          values: recalled ? Object.fromEntries(Object.entries(recalled).map(([key, value]) => [key, [value]])) : null,
          fields: [],
          generation: 0,
          fieldError: "",
        },
        children: createElement(TeamPhotoField, { photo: null, crop: null, labels, inputId: "team-photo-t", ...props }),
      }),
    );
  const hidden = (markup: string, name: string) => {
    const match = new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`).exec(markup);
    return match ? match[1].replaceAll("&quot;", '"') : undefined;
  };

  it("posts the picture's id and its crop, and shows the crop box with the five shapes, 1∶1 pressed", () => {
    const markup = render({ photo, crop: initialTeamCrop(photo) });
    expect(hidden(markup, "photoAssetId")).toBe(PHOTO_ID);
    expect(JSON.parse(hidden(markup, "photoCrop") ?? "null")).toEqual(initialTeamCrop(photo));
    expect(markup).toContain('data-testid="team-photo-t-crop"');
    expect(markup).toContain("Decupaj — ce se vede pe card");
    for (const shape of ["Liber", "16:9", "4:3", "1:1", "4:5"]) expect(markup).toContain(`>${shape}</button>`);
    expect(markup).toMatch(/aria-pressed="true"[^>]*value="1:1"|value="1:1"[^>]*aria-pressed="true"/);
    // «Din galerie» beside the upload, and the quality choice (§485, §414).
    expect(markup).toContain("Din galerie");
    expect(markup).toContain("Calitate");
  });

  it("the upload button is a type=button that opens the hidden file input, which keeps the form's id", () => {
    const markup = render({});
    // The visible control must not submit the form, and the input the click opens keeps `inputId`.
    expect(/<button[^>]*type="button"[^>]*id="field-photoAssetId"/.test(markup)).toBe(true);
    expect(/<input[^>]*id="team-photo-t"[^>]*type="file"/.test(markup)).toBe(true);
    const source = readFileSync(path.join(process.cwd(), "src/modules/content/team/ui/TeamPhotoField.tsx"), "utf8");
    expect(source).toContain("fileInput.current?.click()");
  });

  it("a card without a photograph posts neither, and has no crop box", () => {
    const markup = render({});
    expect(hidden(markup, "photoAssetId")).toBe("");
    expect(hidden(markup, "photoCrop")).toBe("");
    expect(markup).not.toContain('data-testid="team-photo-t-crop"');
  });

  it("an old card with no crop keeps posting none until the club draws one", () => {
    expect(hidden(render({ photo, crop: null }), "photoCrop")).toBe("");
  });

  it("comes back after a refused save with the picture and the crop that were chosen (§315)", () => {
    const markup = render(
      {},
      {
        photoAssetId: PHOTO_ID,
        photoCrop: JSON.stringify(PORTRAIT_CROP),
        photoPicture: JSON.stringify({ src: "/web.webp", preview: "/thumb.webp", width: 4000, height: 3000 }),
      },
    );
    expect(hidden(markup, "photoAssetId")).toBe(PHOTO_ID);
    expect(JSON.parse(hidden(markup, "photoCrop") ?? "null")).toEqual(PORTRAIT_CROP);
    expect(markup).toContain('data-testid="team-photo-t-crop"');
  });

  it("uploads through the one shared upload, never a second one", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/content/team/ui/TeamPhotoField.tsx"), "utf8");
    expect(source).toContain('from "@/modules/media/ui/upload-picture"');
    expect(source).not.toContain("/api/admin/media");
    const editor = readFileSync(path.join(process.cwd(), "src/modules/content/rich-text/ui/RichTextEditor.tsx"), "utf8");
    expect(editor).toContain('from "@/modules/media/ui/upload-picture"');
    expect(editor).not.toContain('fetch("/api/admin/media"');
  });
});
