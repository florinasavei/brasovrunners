import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import type { TestDatabase } from "./db";

/**
 * What the declaration page posts (BR-REQ-033-02 criterion 6): the checkbox, the typed name, and
 * the id and hash of the version it rendered. Resolved the way the page resolves it, so a test
 * signs exactly what a participant would have read at `now`.
 */
export async function signingInput(
  db: TestDatabase,
  now: Date,
  typedName = "Ana Pop",
  locale: "ro" | "en" = "ro",
) {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, now);
  if (!document) throw new Error("no approved declaration to sign in this test database");
  return {
    accepted: true as const,
    typedName,
    documentId: document.id,
    contentSha256: document.contentSha256,
  };
}
