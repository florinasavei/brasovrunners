import type { PickedProposal } from "./checkpoints";
import { checkpointBox, gpxProposalBox, type PostedCheckpoint } from "./domain/checkpoint";

/**
 * The rows the editor's card posted, from the boxes' own names (`cp[3].km`, §757): every row number
 * that has any box, in the order of the numbers. Strings as typed — the service holds them to the
 * rules. Not in the actions' file: a `"use server"` file exports only actions.
 */
export function postedCheckpoints(form: FormData): PostedCheckpoint[] {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const indexes = new Set<number>();
  for (const name of form.keys()) {
    const match = /^cp\[(\d{1,3})\]\./.exec(name);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      id: text(checkpointBox(index, "id")),
      nameRo: text(checkpointBox(index, "nameRo")),
      nameEn: text(checkpointBox(index, "nameEn")),
      km: text(checkpointBox(index, "km")),
      kinds: form.getAll(checkpointBox(index, "kinds")).filter((kind): kind is string => typeof kind === "string"),
      cutoffHours: text(checkpointBox(index, "cutoffHours")),
      cutoffMinutesPart: text(checkpointBox(index, "cutoffMinutesPart")),
      noteRo: text(checkpointBox(index, "noteRo")),
      noteEn: text(checkpointBox(index, "noteEn")),
      // A ticked box posts «on»; an unticked one posts nothing at all — so the marker says the form drew the box, and without it the answer is «not asked».
      onProfile: text(checkpointBox(index, "onProfileShown")) === "" ? null : text(checkpointBox(index, "onProfile")) === "on",
      remove: text(checkpointBox(index, "remove")) === "on",
    }));
}

/**
 * The proposals ticked in the GPX's preview (§757), each with the two names its boxes hold (`gp[<at>].nameRo`, `gp[<at>].nameEn`):
 * the number is the proposal's place in the offered list, posted by its «pick» tick. A tick that is not a small whole number is no
 * pick; a name left out is empty, and the service refuses a point without one in each language.
 */
export function postedGpxPicks(form: FormData): PickedProposal[] {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return form
    .getAll("pick")
    .filter((value): value is string => typeof value === "string" && /^\d{1,3}$/.test(value))
    .map(Number)
    .map((at) => ({ at, nameRo: text(gpxProposalBox(at, "nameRo")), nameEn: text(gpxProposalBox(at, "nameEn")) }));
}

/**
 * The boxes a refusal of the GPX preview names, as the preview draws them: the service names a point's boxes `cp[<at>].…` (the list's
 * spelling), the preview's are `gp[<at>].…`, so the summary's links find them. Other names pass unchanged.
 */
export function gpxPreviewFields(fields: readonly string[]): string[] {
  return fields.map((name) => name.replace(/^cp\[/, "gp["));
}
