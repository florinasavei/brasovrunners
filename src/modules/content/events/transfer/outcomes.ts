import type { Locale } from "@/i18n/routing";
import type { ConfigChange } from "./diff";
import type { EventFileRefusal, FileNote } from "./file-format";
import type { DiffEventImportResult, ImportNote, MediaOutcome } from "./import";

/**
 * What the import page's Server Actions answer (§751): plain, serializable data, no words — the page
 * says them in the reader's language from the words it was rendered with. A refusal is a code the page
 * knows (`file` for a file that is not an event file, the editor's own domain codes for a refused
 * import) and, where it helps, the names of the boxes it is about and the service's one sentence.
 */
export type ImportRefusal =
  | { ok: false; kind: "file"; refusal: EventFileRefusal; detail?: string }
  | { ok: false; kind: "domain"; code: string; fields: string[]; detail: string };

/** One event the file can be written over, as the picker lists it. */
export type ImportTarget = {
  id: string;
  /** The title in the reader's language, else the other's. */
  title: string;
  /** The day, in words, in the event's own zone — empty for a date still to be announced. */
  day: string;
  editorialStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  registrations: number;
};

export type PreviewOutcome =
  | ImportRefusal
  | {
      ok: true;
      summary: {
        titles: Record<Locale, string>;
        type: string;
        day: string;
        timezone: string;
        exportedAt: string;
        environment: string;
        baseline: string;
        media: number;
        seriesNotApplied: boolean;
        /** The file's volunteers: an import as a new event writes them, one over an existing event does not (§774). */
        volunteers: boolean;
        /** What reading the file left out of its checkpoints (§770), for the summary to say before anything is imported. */
        fileNotes: FileNote[];
      };
      /** The page addresses a new event would get, and whether either had to be suffixed because the file's was taken. */
      newEvent: { slugs: Record<Locale, string>; suffixed: boolean };
      targets: ImportTarget[];
    };

export type DiffOutcome =
  | ImportRefusal
  | {
      ok: true;
      changes: ConfigChange[];
      media: DiffEventImportResult["media"];
      target: {
        id: string;
        version: number;
        translationVersions: Record<Locale, number>;
        titles: Record<Locale, string>;
        published: boolean;
        registrations: number;
      };
      refusal: string | null;
      seriesNotApplied: boolean;
      volunteersNotApplied: boolean;
      slugsKept: boolean;
      /** What reading the file left out of its checkpoints (§770): the diff shows the file as it will be written. */
      fileNotes: FileNote[];
    };

export type AsNewOutcome = ImportRefusal | { ok: true; eventId: string; path: string; slugs: Record<Locale, string>; media: MediaOutcome; notes: ImportNote[] };

export type OverOutcome = ImportRefusal | { ok: true; eventId: string; path: string; changed: string[]; media: MediaOutcome; offered: number };
