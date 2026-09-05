import { seedSampleLegalDocuments } from "./sample-legal-documents";

/**
 * The sample legal documents alone, without touching anything else.
 *
 * `pilot.ts` also seeds them, but it deletes every event and translation first — which is right
 * for a developer's machine and destructive on a deployed environment where an organizer has
 * been editing races. Until this entry point existed, giving QA its sample privacy notice meant
 * running the seed that would wipe their work, so nobody did, and registration there refused
 * everyone (`DECISIONS.md` §29, §31).
 *
 * Safe to re-run and safe on a live environment: `seedSampleLegalDocuments` never deletes. It
 * inserts version 1 where there is none, does nothing where the same text is already the latest
 * version, and inserts the next version when the text has changed — because a version an
 * acceptance references is immutable (AGENTS.md §12.5).
 *
 * Refused in production by the seed itself: the club's approved wording arrives through a
 * migration, per `docs/RUNBOOKS.md` § Legal document version.
 */
seedSampleLegalDocuments()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
