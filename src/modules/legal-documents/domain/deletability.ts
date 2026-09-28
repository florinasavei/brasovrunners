import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * What stands between an approved legal version and its deletion (§203, §290, §316). One rule for
 * the service, the delete screen and the list, so the screens never carry a drifting copy.
 */

/**
 * How many things stand on a version's words (§53). Wider than the foreign keys: `registrations`
 * refers to notice and terms versions by plain integer with no foreign key (§421), so the database
 * would not stop their deletion.
 */
export type VersionReliance = {
  acceptances: number;
  events: number;
  privacyAcknowledgements: number;
};

export function isReliedOn(reliance: VersionReliance): boolean {
  return reliance.acceptances > 0 || reliance.events > 0 || reliance.privacyAcknowledgements > 0;
}

/** The facts that decide when a version was in force. */
export type VersionTimeline = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  withdrawnAt: Date | null;
};

/** `[from, until)`; `until` is null while still in force. */
export type InForceWindow = { from: Date; until: Date | null };

/**
 * When `version` was in force for its key, as of `now`, or null: `findCurrentApprovedVersionId`'s
 * rule asked of the past — from its `effective_at`, minus every stretch a higher approved version
 * covered, until its own withdrawal. A deleted higher version cannot shorten the window, and the
 * result is one span even across a gap; both err towards refusing deletion.
 */
export function inForceWindow(
  version: VersionTimeline,
  versions: readonly VersionTimeline[],
  now: Date,
): InForceWindow | null {
  if (!version.isApproved) return null;

  const active = (row: VersionTimeline): [number, number] => [
    row.effectiveAt.getTime(),
    row.withdrawnAt ? row.withdrawnAt.getTime() : Number.POSITIVE_INFINITY,
  ];

  let pieces: Array<[number, number]> = [active(version)];
  for (const later of versions) {
    if (
      later.id === version.id ||
      later.key !== version.key ||
      !later.isApproved ||
      later.version <= version.version
    ) {
      continue;
    }
    const [coveredFrom, coveredUntil] = active(later);
    if (coveredFrom >= coveredUntil) continue;
    pieces = pieces.flatMap(([from, until]): Array<[number, number]> => {
      if (coveredUntil <= from || coveredFrom >= until) return [[from, until]];
      const left: Array<[number, number]> = coveredFrom > from ? [[from, coveredFrom]] : [];
      const right: Array<[number, number]> = coveredUntil < until ? [[coveredUntil, until]] : [];
      return [...left, ...right];
    });
  }

  // Nobody can have accepted a text that has not taken effect yet.
  const moment = now.getTime();
  const happened = pieces.filter(([from, until]) => from < until && from <= moment);
  if (happened.length === 0) return null;

  const from = Math.min(...happened.map(([start]) => start));
  const until = Math.max(...happened.map(([, end]) => end));
  return { from: new Date(from), until: until > moment ? null : new Date(until) };
}

/**
 * Registrations that submitted or signed while a terms version was in force
 * (`countRegistrationsAgreeingWithin`); null for other keys or a version never in force.
 */
export type TermsReliance = { window: InForceWindow; registrations: number };

/** Gathered by `readDeletionFacts`. */
export type DeletionFacts = {
  isApproved: boolean;
  acceptanceCount: number;
  eventCount: number;
  privacyAcknowledgementCount: number;
  /** `findCurrentApprovedVersionId`. */
  inForce: boolean;
  terms: TermsReliance | null;
};

export type DependantObstacle =
  | { kind: "referenced"; signatures: number; events: number; acknowledgements: number }
  | { kind: "inForce" };

export type DeletionObstacle =
  | { kind: "draft" }
  | DependantObstacle
  | { kind: "termsAccepted"; registrations: number; window: InForceWindow };

/**
 * Something stands on these words, or the site serves them (§46, §53, §151). Shared by withdrawal
 * and deletion; the version in force is refused whatever the counts, since visitors read it.
 */
export function dependantObstacle(
  facts: Pick<
    DeletionFacts,
    "acceptanceCount" | "eventCount" | "privacyAcknowledgementCount" | "inForce"
  >,
): DependantObstacle | null {
  if (
    isReliedOn({
      acceptances: facts.acceptanceCount,
      events: facts.eventCount,
      privacyAcknowledgements: facts.privacyAcknowledgementCount,
    })
  ) {
    return {
      kind: "referenced",
      signatures: facts.acceptanceCount,
      events: facts.eventCount,
      acknowledgements: facts.privacyAcknowledgementCount,
    };
  }
  return facts.inForce ? { kind: "inForce" } : null;
}

/**
 * The first reason an approved version may not be deleted, or null:
 *
 * 1. a draft — it has its own verb;
 * 2. the shared `dependantObstacle`;
 * 3. a terms version accepted inside its window in force (`TermsReliance`): rows before §421's
 *    `terms_version`, and the declaration's own terms clause, record no number, so the window
 *    answers for them. Replaces §203's blanket refusal.
 */
export function deletionObstacle(facts: DeletionFacts): DeletionObstacle | null {
  if (!facts.isApproved) return { kind: "draft" };

  const dependant = dependantObstacle(facts);
  if (dependant) return dependant;

  if (facts.terms && facts.terms.registrations > 0) {
    return {
      kind: "termsAccepted",
      registrations: facts.terms.registrations,
      window: facts.terms.window,
    };
  }
  return null;
}
