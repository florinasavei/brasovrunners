import { type ImageCrop, imageCropSchema, meaningfulCrop } from "@/modules/content/rich-text/domain/schema";

/**
 * A card photo's crop as posted or stored (§541, the shape of §241): four fractions, `null` for
 * none or the whole photo (`meaningfulCrop`), `"invalid"` for anything the save must refuse.
 * Its own file so the upload island need not import the card's form rule.
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

/** A stored crop for the pages: a malformed row reads as no crop, never a broken card. */
export function storedTeamPhotoCrop(value: unknown): ImageCrop | null {
  const crop = readTeamPhotoCrop(value);
  return crop === "invalid" ? null : crop;
}
