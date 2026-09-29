import { isMinorOn } from "./age";

/**
 * Which yes to «oferte și beneficii» may reach a partner (§570, amending §562). Pure: the caller
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
 *
 * **Never a minor** (review finding): a child's name goes to no third party's marketing, whatever
 * the guardian ticked — the box stays for the club's own sending, which reaches the guardian's
 * address. The participant must be 18 on the day the list is made (`isMinorOn` against `now`, the
 * guardian rule's calendar); a registration without a readable birth date is left out, the safe side.
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

/** Whether the participant is an adult on `now` for the partners' list: a readable birth date, 18 or more. */
export function adultForPartners(birthDate: string | null, now: Date): boolean {
  return birthDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && !Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`)) && !isMinorOn(birthDate, now);
}

/** Whether this registration's yes, given under a sharing notice, may reach a partner today: that, and an adult. */
export function reachesPartner(row: SponsorShareRow & { birthDate: string | null }, gate: SponsorShareGate, now: Date): boolean {
  return adultForPartners(row.birthDate, now) && sharedWithSponsors(row, gate);
}

/** Whether this registration's yes was given under texts that describe the sharing (see above). */
export function sharedWithSponsors(row: SponsorShareRow, gate: SponsorShareGate): boolean {
  if (!row.promoConsent || row.promoConsentAt === null) return false;
  if (!gate.sharing.has(row.privacyNoticeVersion)) return false;
  const inForce = noticeVersionInForceAt(gate.versions, row.promoConsentAt);
  return inForce !== null && gate.sharing.has(inForce);
}
