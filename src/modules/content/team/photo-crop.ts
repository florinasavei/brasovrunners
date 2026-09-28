import { type ImageCrop, imageCropSchema, meaningfulCrop } from "@/modules/content/rich-text/domain/schema";

/**
 * A card photograph's crop as posted or stored (§NNN): the four fractions inside the picture that
 * `ImageCropBox` draws — the JSON a picture in a text keeps as its `crop` (§241) — or `null` for
 * none: absent, empty, or the whole photograph, which is not a crop (`meaningfulCrop`).
 * `"invalid"` for anything else, which the save refuses. Its own file, because the upload's
 * island reads a recalled crop with it and should not carry the card's whole form rule.
 */
export function readTeamPhotoCrop(value: unknown): ImageCrop | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return "invalid";
    }
    if (candidate === null) return null;
  }
  const parsed = imageCropSchema.safeParse(candidate);
  return parsed.success ? meaningfulCrop(parsed.data) : "invalid";
}

/** A stored crop as the pages read it: a row a hand wrote wrong reads as no crop, never a broken card. */
export function storedTeamPhotoCrop(value: unknown): ImageCrop | null {
  const crop = readTeamPhotoCrop(value);
  return crop === "invalid" ? null : crop;
}
