import { seedSampleLegalDocuments } from "./sample-legal-documents";

/**
 * The sample legal documents alone (§29, §31): unlike `pilot.ts`, deletes no events, so it is safe
 * on a deployed environment. Re-runnable — it never deletes and inserts a next version only when
 * the text changed (AGENTS.md §12.5). Refused in production by the seed itself.
 */
seedSampleLegalDocuments()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
