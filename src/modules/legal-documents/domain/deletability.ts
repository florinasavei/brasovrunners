import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * What stands between an approved legal version and its deletion, as pure functions every caller
 * asks — the service before it destroys anything, the delete screen before it offers the form, and
 * the list before it offers the link (`DECISIONS.md` §203, §290, §NNN).
 *
 * **One rule, three callers.** Twice now a screen and the service have disagreed about this: §290
 * found the delete screen promising "nimic nu depinde de ea" about a version the service refused,
 * and the list kept offering "Șterge definitiv" beside "Nefolosit încă" for a terms version the
 * same service would refuse — the owner pressed it three times ("Still can't delete these
 * docs..."). A screen that carries a *copy* of the obstacle list is a screen that drifts, so the
 * list is here, once, and the screens render whatever it answers.
 */

/**
 * How many things stand on a version's words (`DECISIONS.md` §53).
 *
 * Deliberately wider than the two foreign keys. A privacy notice is referenced by *number* from
 * `registrations` — `privacy_notice_version`, `results_consent_version` and
 * `health_consent_version` are plain integers with no foreign key — so a notice hundreds of people
 * acknowledged is invisible to the acceptance and event counts alike, and the database would raise
 * nothing at all if it were removed.
 */
export type VersionReliance = {
  acceptances: number;
  events: number;
  privacyAcknowledgements: number;
};

export function isReliedOn(reliance: VersionReliance): boolean {
  return reliance.acceptances > 0 || reliance.events > 0 || reliance.privacyAcknowledgements > 0;
}

/** The facts about one version that decide when it was in force — a backoffice row carries them. */
export type VersionTimeline = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  withdrawnAt: Date | null;
};

/**
 * When a version was the one in force: from `from` up to, not including, `until`. `until` is null
 * while it still is.
 */
export type InForceWindow = { from: Date; until: Date | null };

/**
 * The stretch of time during which `version` was the text in force for its key, as of `now`, or
 * null if it never was.
 *
 * "In force at *t*" is `findCurrentApprovedVersionId`'s rule asked of the past: the highest
 * approved version whose `effective_at` has arrived and which had not been withdrawn by *t*. So
 * a version is in force from its `effective_at` until the first of: its own withdrawal, or a
 * *higher* approved version taking effect — minus any stretch in which such a higher version was
 * itself in force and later withdrawn (a sweep rather than a single successor, so an odd history
 * cannot fool it).
 *
 * What cannot be seen is a higher version that has since been **deleted**: its row is gone, so it
 * cannot shorten this one's window. That errs the right way — the window comes out longer, more
 * registrations fall inside it, and the verdict can only move towards refusing.
 *
 * Returned as one span, first moment to last. In any history this platform can produce the
 * version in force only ever moves upwards — the text in force can be neither withdrawn nor
 * deleted — so the span has no gaps; if seeded data ever gave it one, counting across the gap
 * again errs towards refusing.
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
    // Withdrawn before its own date: it never covered a single instant.
    if (coveredFrom >= coveredUntil) continue;
    pieces = pieces.flatMap(([from, until]): Array<[number, number]> => {
      if (coveredUntil <= from || coveredFrom >= until) return [[from, until]];
      const left: Array<[number, number]> = coveredFrom > from ? [[from, coveredFrom]] : [];
      const right: Array<[number, number]> = coveredUntil < until ? [[coveredUntil, until]] : [];
      return [...left, ...right];
    });
  }

  // Only what has already happened: a stretch that begins after `now` is a promise, and nobody
  // can have accepted a text that has not taken effect.
  const moment = now.getTime();
  const happened = pieces.filter(([from, until]) => from < until && from <= moment);
  if (happened.length === 0) return null;

  const from = Math.min(...happened.map(([start]) => start));
  const until = Math.max(...happened.map(([, end]) => end));
  return { from: new Date(from), until: until > moment ? null : new Date(until) };
}

/**
 * What a terms version's window shows: how many registrations agreed to "the terms" while it was
 * the text in force — submitted the form, or signed the declaration, inside the window
 * (`countRegistrationsAgreeingWithin`). Null for the other two keys, and for a terms version that
 * was never in force.
 */
export type TermsReliance = { window: InForceWindow; registrations: number };

/** Everything the deletion rule reads about one version, gathered by `readDeletionFacts`. */
export type DeletionFacts = {
  isApproved: boolean;
  acceptanceCount: number;
  eventCount: number;
  privacyAcknowledgementCount: number;
  /** The version the site serves right now — `findCurrentApprovedVersionId`. */
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
 * Something stands on these words, or the site is serving them (`DECISIONS.md` §46, §53, §151).
 *
 * The question withdrawal and deletion share, asked in one place so the two verbs cannot come to
 * disagree about what "unused" means. Zero signatures is not "unused" for a notice; it is what the
 * notice of a quiet week looks like, while every visitor to the public page is reading it — which
 * is why the version in force is refused whatever the counts say.
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
 * The first reason an approved version may not be deleted, in the order the reader should hear
 * them — or null, and then the service deletes it.
 *
 * 1. **A draft** is answered by naming its own verb, which needs no typed confirmation and retires
 *    no number.
 * 2. **The shared question** — a signature, an event, a registration that recorded the number, or
 *    the text in force — before anything narrower, because withdrawing is the step that moves.
 * 3. **A terms version somebody accepted.** A registration records `privacy_notice_version` and
 *    never a terms version, so the three counts are vacuous for this key. What *can* be shown is
 *    when it was accepted: the terms are agreed to at the instant the form is submitted, and again
 *    when the declaration — "sunt de acord cu termenii, condițiile și regulamentul evenimentului"
 *    — is signed, and whatever was in force at that instant is what was agreed to. So the question
 *    is whether any registration did either inside its window (`TermsReliance`). None, and nobody
 *    ever agreed to anything under those words — it may go like any other unused version. One,
 *    and deletion would destroy text somebody may have accepted, leaving only a hash.
 *
 * §203 refused every terms version that had *ever* been in force, because it had no evidence at
 * all; this replaces that refusal with the evidence, without a migration.
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
