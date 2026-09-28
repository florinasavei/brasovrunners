/**
 * The team page's meta description from its introduction (§459, §483): about 160 characters, the
 * first sentence when it fills at least half of that, else whole words with an ellipsis.
 * Whitespace is folded first.
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
