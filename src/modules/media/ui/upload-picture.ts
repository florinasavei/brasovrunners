import { prepareImageUpload } from "../browser-shrink";
import type { ImageQuality } from "../ladder";
import { readRemembered } from "./ImageQualityChoice";
import { type ChosenFacts, chosenFactsOf, type StoredFacts } from "./stored-facts";

/** What `/api/admin/media` answers for one stored picture. */
export type UploadedPicture = { assetId: string; src: string; width: number; height: number; stored?: StoredFacts };

/**
 * The backoffice's one picture upload (§414, §541). The quality defaults to the remembered one
 * at call time: Tiptap's paste handler keeps the function from the first render.
 */
export async function uploadPicture(
  file: File,
  onChosen: (facts: ChosenFacts) => void,
  quality: ImageQuality = readRemembered(),
): Promise<UploadedPicture> {
  const body = new FormData();
  const prepared = await prepareImageUpload(file, quality, (chosen) => onChosen({ name: file.name, chosen }));
  onChosen(chosenFactsOf(file.name, prepared));
  body.append("file", prepared.blob, file.name.replace(/\.[^.]+$/, "") + ".webp");
  body.append("originalFilename", file.name);
  body.append("quality", quality);
  const response = await fetch("/api/admin/media", { method: "POST", body });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as UploadedPicture;
}
