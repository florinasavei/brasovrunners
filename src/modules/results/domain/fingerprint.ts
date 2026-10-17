import { createHash } from "node:crypto";

/**
 * What a race's stored results were when the page was drawn (§NNN): a short fingerprint of every row's own columns, posted back in
 * the form's hidden box. «Salvează tot clasamentul» writes the list as the boxes show it — rows left out are deleted — so a form
 * opened before another session saved would otherwise put the old rows back over the new ones, or delete the ones the other
 * session added. The save compares this with the rows as they are stored by then and, when they differ, refuses with CONFLICT
 * (the §36 rule the event editor's version box and §791's role baseline keep) — nothing is written, and the boxes keep what was typed.
 *
 * Only what a person typed or imported is in it — never the positions, which every save rewrites, nor a registration's name — and
 * it is a hash, so the box carries no name, no birth date and no time a reader of the page source could not read anyway.
 */
export type FingerprintedResult = {
  bibNumber: number;
  registrationId: string | null;
  displayName: string | null;
  sex: string | null;
  birthDate: string | null;
  status: string;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  note: string | null;
  /** When the staff recorded that a typed runner agreed to appear by name (§NNN); absent or null for none. */
  nameAgreedAt?: Date | null;
};

export function resultsFingerprint(rows: readonly FingerprintedResult[]): string {
  const lines = [...rows]
    .sort((a, b) => a.bibNumber - b.bibNumber)
    .map((row) => [row.bibNumber, row.registrationId ?? "", row.displayName ?? "", row.sex ?? "", row.birthDate ?? "", row.status, row.gunTimeMs ?? "", row.chipTimeMs ?? "", row.note ?? "", row.nameAgreedAt?.getTime() ?? ""].join("\u001f"));
  return createHash("sha256").update(lines.join("\u001e")).digest("hex").slice(0, 16);
}
