import { checkpointBox, type PostedCheckpoint } from "./domain/checkpoint";

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
      cutoff: text(checkpointBox(index, "cutoff")),
      noteRo: text(checkpointBox(index, "noteRo")),
      noteEn: text(checkpointBox(index, "noteEn")),
      remove: text(checkpointBox(index, "remove")) === "on",
    }));
}
