import { prepareImageUpload } from "../browser-shrink";
import type { ImageQuality } from "../ladder";
import { readRemembered } from "./ImageQualityChoice";
import { type ChosenFacts, chosenFactsOf, type StoredFacts } from "./stored-facts";

/** What `/api/admin/media` answers for one stored picture: its id, its master, its size and its facts. */
export type UploadedPicture = { assetId: string; src: string; width: number; height: number; stored?: StoredFacts };

/**
 * One picture up to `/api/admin/media` at the chosen quality (§414): shrunk in the browser only
 * as far as that choice keeps, then the server's answer. The one upload of the backoffice — a
 * picture in the text, a film's poster and a card of «Echipa» (§NNN) all call it, so the three
 * cannot drift apart again.
 *
 * The choice is read from the store unless the caller hands it over: a paste or a drop in the
 * text editor calls the function Tiptap kept from the first render, whose quality is the default
 * whatever was chosen since.
 */
export async function uploadPicture(
  file: File,
  onChosen: (facts: ChosenFacts) => void,
  quality: ImageQuality = readRemembered(),
): Promise<UploadedPicture> {
  const body = new FormData();
  // The file's own pixels and weight as soon as it is decoded, then what is sent (§437).
  const prepared = await prepareImageUpload(file, quality, (chosen) => onChosen({ name: file.name, chosen }));
  onChosen(chosenFactsOf(file.name, prepared));
  body.append("file", prepared.blob, file.name.replace(/\.[^.]+$/, "") + ".webp");
  body.append("originalFilename", file.name);
  body.append("quality", quality);
  const response = await fetch("/api/admin/media", { method: "POST", body });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as UploadedPicture;
}
