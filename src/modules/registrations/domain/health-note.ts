/**
 * The health note only when the event asks it (§NNN; the owner, 2026-09-29: «trebuie să am o bifă
 * și pentru acele informații medicale, pentru că nu știu ce să fac cu ele»).
 *
 * The note (BR-REQ-031-05) is GDPR art. 9 data, so the club collects it only where it decided to:
 * the editor's «Condiții de participare» → «Informații medicale» tick (`events.ask_health_note`,
 * false by default). The same pattern as the T-shirt (§554, `kit.ts`): the form draws the field only
 * then, the server keeps a posted note only then — decided off the locked event row — and every
 * backoffice surface shows it only then.
 */

/** The health-note fields a submission posts, as the form maps them (`form-mapping.ts`). */
type PostedHealth = { healthNotes?: unknown; healthConsent?: unknown };

/**
 * A submission without its health note, for an event that does not ask one: the note and its tick
 * are dropped before the schema reads them, so a stale form (rendered while the event asked) or a
 * script is never refused for a note without its consent — it is ignored, and the row stores null.
 * Anything that is not an object is handed back as it is, for the schema to refuse.
 */
export function withoutHealthNote<T>(raw: T): T {
  if (raw === null || typeof raw !== "object") return raw;
  return { ...(raw as PostedHealth), healthNotes: undefined, healthConsent: false } as T;
}

/** The health-note columns a registration stores. */
export type StoredHealth = {
  healthNotes: string | null;
  healthConsentVersion: number | null;
  healthConsentAt: Date | null;
};

/**
 * What a registration stores for its health note, under the event's lock (`service.ts`): the note
 * and its consent as the submission gave them when the event asks, and nothing otherwise.
 */
export function healthNoteKept<T extends Partial<StoredHealth>>(asks: boolean, details: T): T {
  return asks ? details : { ...details, healthNotes: null, healthConsentVersion: null, healthConsentAt: null };
}

/**
 * The note a backoffice screen shows: only for an event that asks it. A note stored before the tick
 * came off stays on the row until the seven-day purge, as it always did, but no screen shows it.
 */
export function healthNoteShown(asks: boolean, note: string | null | undefined): string | null {
  return asks && note ? note : null;
}
