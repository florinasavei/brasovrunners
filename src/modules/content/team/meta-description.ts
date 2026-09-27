/**
 * The team page's meta description, from its introduction (§459, §474; the V2.06 review's nit,
 * §483): the whole introduction went into `<meta name="description">`, and a club that writes a
 * page of words about itself would hand a search engine a page of words it cuts anyway, at a
 * place of its own choosing.
 *
 * About 160 characters, the length a search result shows: the first sentence when it fits and
 * says enough — at least half the room, so «Bun venit!» never stands for a page that had 160
 * characters to say what it is (the V2.07 review, §483) — else the words up to the last whole
 * word that fits, with an ellipsis. Whitespace is folded first —
 * the introduction is a rich text's plain words, line breaks included.
 */
export const TEAM_META_DESCRIPTION_MAX = 160;

export function teamMetaDescription(text: string, max = TEAM_META_DESCRIPTION_MAX): string {
  const folded = text.replace(/\s+/g, " ").trim();
  if (folded.length <= max) return folded;
  const sentence = /^.+?[.!?](?=\s)/.exec(folded)?.[0];
  if (sentence && sentence.length <= max && sentence.length >= max / 2) return sentence;
  const room = folded.slice(0, max - 1);
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > max / 2 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:–—-]+$/, "")}…`;
}
