/**
 * Whose identity document is whose (§95, §108, §330).
 *
 * `declaration_acceptances.id_document` has always been the **declarant's**: the adult's own, or
 * — for a minor — the parent's or guardian's, because the parent signed and typed theirs (§108).
 * Since a minor's declaration is signed by the minor as well (§330; the owner: "I wanna have the ID
 * document of the minor and the parent, and also 2 signatures!"), the minor's own document is
 * `minor_id_document`. The column meanings did not move, so every acceptance recorded before
 * reads as it always did.
 *
 * Every screen and file that prints a document asks this one function which is the
 * participant's and which the guardian's — the desk row, the export, the registration's page —
 * so none of them can pair a document with the wrong person.
 *
 * "A minor" is `guardianName` set: the truthiness `expectedSignatures` and `declarantValues` use,
 * so the page that asked for the documents and the screens that show them never disagree. A
 * minor's acceptance recorded before two signatures were asked carries only the parent's
 * document: it is the guardian's, and the participant's is null — never the parent's document
 * passed off as the child's.
 *
 * Pure, with no imports: the desk row, the export route and the tests all call it as it is.
 */
export function identityDocumentsOf(row: {
  guardianName: string | null | undefined;
  idDocument: string | null | undefined;
  minorIdDocument: string | null | undefined;
}): { participant: string | null; guardian: string | null } {
  return row.guardianName
    ? { participant: row.minorIdDocument ?? null, guardian: row.idDocument ?? null }
    : { participant: row.idDocument ?? null, guardian: null };
}
