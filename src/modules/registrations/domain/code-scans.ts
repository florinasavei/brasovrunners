/**
 * A desk code's scans as the scanned page reads them (§NNN; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari]
 * gen cine a scanat, cine a marcat prezent»), the pure half of `../code-scans.ts`: what a scan is to «Scanat înainte», the two
 * marks of an address that opens the page without a scan, and which earlier scans the line names.
 *
 * The desk's own, beside the verb that writes a scan (`admin-service.ts#recordCodeScan`): the scanned page, which every desk role
 * opens, reads nothing of the organizers' «Jurnal» (`race-day/journal.ts`), which reads the same rows for its lines.
 */

/** One scan of a code as «Scanat înainte» reads it: when, and who — a staff account's name, or none for an account deleted since. */
export type CodeScan = { id: string; at: Date; actorId: string | null; actorName: string | null };

/**
 * The value of `?from=` that says the registration's own page opened the scanned view (its «Deschide la masă»): the backoffice
 * looking at its own row, not a code scanned at the table — so no scan is recorded for it.
 */
export const OPENED_FROM_REGISTRATION = "registration";

/**
 * The value of `?from=` the language switch lands with (`events/locale-switch.ts`): the page already open, in the other language —
 * the same visit, never a second scan. The switch never carries the query of the page it leaves (the switcher knows the path
 * alone), so it says this instead, whatever that query was: a `?from=registration` view or a `?saved=` one switched an hour later
 * records nothing either.
 */
export const OPENED_IN_THE_OTHER_LANGUAGE = "language";

/** How many earlier scans «Scanat înainte» names, the newest. */
export const EARLIER_SCANS_SHOWN = 3;

/**
 * «Scanat înainte» on the scanned page: the newest three scans of the code but the one this visit counts as, oldest first so the
 * line reads in the order they happened. `scans` are the code's newest, newest first. The visit's own scan is the row it wrote or
 * repeated (`ownScanId`); on the page coming back from a desk verb, or switched to the other language — the same visit, a press or
 * a language later (`sameVisit`) — it is the viewer's newest scan.
 */
export function earlierScans(scans: readonly CodeScan[], visit: { ownScanId: string | null; sameVisit: boolean; viewerId: string }): CodeScan[] {
  const own = visit.ownScanId ?? (visit.sameVisit ? (scans.find((scan) => scan.actorId === visit.viewerId)?.id ?? null) : null);
  return scans
    .filter((scan) => scan.id !== own)
    .slice(0, EARLIER_SCANS_SHOWN)
    .reverse();
}
