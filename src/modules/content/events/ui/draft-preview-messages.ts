/**
 * What the editor's «Previzualizare» card and its frame say to each other (§NNN), over
 * `postMessage`, same origin only — the editor never reads the frame's document, and the frame
 * never reads the editor's form: the editor hands it the form's values as they stood at the press.
 */

export type DraftPreviewView = "card" | "page";

/** The editor → the frame: draw these values (one request), or only show the other view (none). */
export type ToFrame =
  | { type: "br-draft-preview:render"; entries: [string, string][]; view: DraftPreviewView; snapshot: number }
  | { type: "br-draft-preview:view"; view: DraftPreviewView };

/** The frame → the editor: loaded, answered, or grown. */
export type FromFrame =
  | { type: "br-draft-preview:ready" }
  | {
      type: "br-draft-preview:result";
      snapshot: number;
      outcome: "ready" | "refused" | "forbidden" | "notFound" | "failed";
      error?: string;
      fields?: string[];
      missing?: Record<string, string[]>;
    }
  | { type: "br-draft-preview:height"; height: number };

/** A message from the other side, or null: anything else a window may receive is ignored. */
export function readPreviewMessage<T extends { type: string }>(data: unknown): T | null {
  if (typeof data !== "object" || data === null) return null;
  const type = (data as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("br-draft-preview:") ? (data as T) : null;
}

/** The form's values as a press leaves them: strings only — a file box posts nothing here. */
export function formEntries(form: HTMLFormElement): [string, string][] {
  const entries: [string, string][] = [];
  for (const [name, value] of new FormData(form).entries()) if (typeof value === "string") entries.push([name, value]);
  return entries;
}
