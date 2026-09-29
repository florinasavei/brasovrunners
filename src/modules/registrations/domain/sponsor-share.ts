/**
 * Which yes to «oferte și beneficii» may reach a partner (§NNN, amending §562). Pure: the caller
 * reads the approved notices once (`legal-documents/repository.ts#findSponsorShareVersions`) and
 * asks this of each row.
 *
 * The owner, 2026-09-29: "export the participants list but filter out just the ones who agreed to
 * receive marketing emails so we can share it with our sponsors". §562's notice said the opposite —
 * «Le trimite numai clubul: partenerii nu primesc adresa ta» — and a consent is a consent to the
 * text it was given under (AGENTS.md §10.8). So a row is shared only when **both** notices that
 * could have been in front of the person describe the sharing (`{{promotionalMaterialsShared}}`):
 *
 * - the one the registration records (`privacy_notice_version`) — what the form showed when the box
 *   was ticked; and
 * - the one in force at `promo_consent_at` — what was in force when the yes was last given, since a
 *   later yes from the person's own page (§562) is given under the notice of that moment.
 *
 * For a tick on the form the two are the same notice. A row that registered under an older notice
 * and said yes later under a sharing one is left out — the safe side: one of the two texts in front
 * of that person said the partners would receive nothing. A yes without its moment is left out too.
 */

export type SponsorShareVersion = { version: number; effectiveAt: Date; shares: boolean };

export type SponsorShareGate = {
  /** The versions that describe the sharing in every language. */
  sharing: ReadonlySet<number>;
  /** Every approved, not withdrawn version with its effective date, for "which was in force at". */
  versions: readonly SponsorShareVersion[];
};

export function sponsorShareGate(versions: readonly SponsorShareVersion[]): SponsorShareGate {
  return { sharing: new Set(versions.filter((entry) => entry.shares).map((entry) => entry.version)), versions };
}

/**
 * The version in force at `at`: the highest approved, not withdrawn version whose effective date
 * has passed — `findCurrentApprovedVersionId`'s rule, asked of a moment in the past. Null before any.
 */
export function noticeVersionInForceAt(versions: readonly SponsorShareVersion[], at: Date): number | null {
  let found: number | null = null;
  for (const entry of versions) {
    if (entry.effectiveAt.getTime() <= at.getTime() && (found === null || entry.version > found)) found = entry.version;
  }
  return found;
}

export type SponsorShareRow = { promoConsent: boolean; promoConsentAt: Date | null; privacyNoticeVersion: number };

/** Whether this registration's yes may be given to a partner (see above). */
export function sharedWithSponsors(row: SponsorShareRow, gate: SponsorShareGate): boolean {
  if (!row.promoConsent || row.promoConsentAt === null) return false;
  if (!gate.sharing.has(row.privacyNoticeVersion)) return false;
  const inForce = noticeVersionInForceAt(gate.versions, row.promoConsentAt);
  return inForce !== null && gate.sharing.has(inForce);
}
