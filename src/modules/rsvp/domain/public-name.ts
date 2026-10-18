/**
 * Which names «Vin (N)» shows (§811, «Vin!» part 1) — **a public name is a disclosure** (§143, §396, the unbreakable
 * row of CLAUDE.md), and this is its whole rule, as `results/domain/public-name.ts` is for the ranking:
 *
 *   - the row is confirmed (a person who has not used the link is not counted, let alone named);
 *   - the person ticked «Vreau să apar cu numele» (`showName`) and gave a name;
 *   - the notice they answered under (`privacyNoticeVersion`) is the first one that described «Vin!», or a later one
 *     (`firstRsvpNoticeVersion`, §421's line): a tick given under an older notice agreed to nothing this describes;
 *   - and the notice in force describes «Vin!» now (`firstRsvpNoticeVersion` is not null).
 *
 * Everyone else is only counted. Pure.
 */
export type RsvpNameInput = {
  confirmed: boolean;
  showName: boolean;
  displayName: string | null;
  privacyNoticeVersion: number;
  /** `findFirstRsvpNoticeVersion`: the first approved notice that described «Vin!», or null when none did. */
  firstRsvpNoticeVersion: number | null;
};

export function publicRsvpName(row: RsvpNameInput): string | null {
  if (!row.confirmed || !row.showName) return null;
  if (row.firstRsvpNoticeVersion === null || row.privacyNoticeVersion < row.firstRsvpNoticeVersion) return null;
  const name = (row.displayName ?? "").trim();
  return name === "" ? null : name;
}
