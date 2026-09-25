/**
 * The chosen kind and the typed series, as the one string a declaration carries (§283) — for the
 * declarant's document (`idDocument`, `idDocumentType`) or a minor's (`minorIdDocument`,
 * `minorIdDocumentType`, §330): the kind's box is the series box's name with `Type` after it.
 *
 * Composed in the action rather than stored as two columns: `{{idDocument}}` is one merge field in
 * a text the club approved, and the signed PDF has to read as a sentence — "Carte de identitate BV
 * 123456". The kind is translated at this moment, in the language the person is signing in,
 * because that is the language of the document they are signing. Shared by the race's declaration
 * and a group run's self-declaration (§NNN).
 */
export function idDocumentFrom(form: FormData, t: (key: string) => string, field: "idDocument" | "minorIdDocument"): string | undefined {
  const series = String(form.get(field) ?? "").trim();
  if (series === "") return undefined;
  const kind = String(form.get(`${field}Type`) ?? "");
  // An unknown kind is nobody's document: the series alone is what was true before §283, and it
  // is better than a declaration naming a document the person did not choose.
  const known = ["ID_CARD", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"].includes(kind);
  return known ? `${t(`declare.idDocumentTypes.${kind}`)} ${series}` : series;
}
