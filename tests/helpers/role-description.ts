/**
 * A volunteer role's «Descrierea rolului» as the database keeps it (§NNN): the editor's document per language and
 * its plain words — one paragraph per line — for a test that seeds the table directly instead of through the
 * service (`changeVolunteerRole`, which writes the same four columns from what the form posts).
 */
export function roleDescription(ro: string | null, en: string | null) {
  const doc = (text: string | null) =>
    text === null
      ? null
      : {
          type: "doc" as const,
          content: text
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: line }] })),
        };
  const words = (text: string | null) => (text === null ? null : text.split("\n").filter((line) => line.trim() !== "").join("\n"));
  return {
    descriptionRoJson: doc(ro),
    descriptionEnJson: doc(en),
    descriptionWordsRo: words(ro),
    descriptionWordsEn: words(en),
  };
}
