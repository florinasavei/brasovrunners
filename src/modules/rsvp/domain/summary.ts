/**
 * The words on the closed «Confirmă prezența (opțional)» fold's line (§812, amended by the fold: the owner, 2026-10-19, «Asta ar trebui să
 * fie collapsed, ca și condițiile de participare»; named «Vii?» until §825), as pure rules outside the client file so a test reads them
 * without a browser.
 *
 * The line is the heading, then — after a dot — what a reader decides by without opening it: **how many come** («Confirmă prezența
 * (opțional) · 3 vin»), **the sentence that asks to be first** when nobody has answered («… · Fii primul care confirmă») and **that this
 * browser answered** («… · Tu vii ✓ · 3 vin»). The server draws the line from the page's one cached read; the island (`RsvpRemembered`)
 * knows the browser answered and says so through `going-store.ts`. The tick is beside the words «Tu vii», never alone: state is not
 * colour or a glyph by itself.
 */
export type RsvpSummaryWords = {
  /** «3 vin» / «1 vine» (the house's count form, made by the caller), or null when the count is unknown or zero. */
  countText: string | null;
  /** «Fii primul care confirmă»: said only when nobody has answered and this browser has not either. */
  emptyText: string;
  /** «Tu vii»: the tick is added here. */
  goingText: string;
};

/**
 * The count's words with the members' after them, when there are any (§829): «3 vin» and «2 membri» become «3 vin · 2 membri» — the closed fold's line
 * and the facts line say the same two numbers, the second only when it is not nothing (`members` counts every confirmed member answer, named or not).
 */
export function rsvpCountText(count: string, members: string | null): string {
  return members === null ? count : `${count}${SUMMARY_SEPARATOR}${members}`;
}

/** The separator between the heading and each part: a middle dot with a space either side, as the editor's folds write their closed line. */
export const SUMMARY_SEPARATOR = " · ";

/**
 * What follows the heading on the fold's line, or null when nothing does (the count could not be read and this browser has not
 * answered — a count that cannot be asked is not a count of zero, §281).
 *
 * `countKnown` tells «nobody has answered» (zero, say it) from «not read» (say nothing).
 */
export function rsvpSummaryParts(words: RsvpSummaryWords, going: boolean, countKnown: boolean): string[] {
  const parts: string[] = [];
  if (going) parts.push(`${words.goingText} ✓`);
  if (words.countText !== null) parts.push(words.countText);
  else if (countKnown && !going) parts.push(words.emptyText);
  return parts;
}

/** The suffix drawn after the heading: « · Tu vii ✓ · 3 vin», or the empty string when there is nothing to say. */
export function rsvpSummarySuffix(words: RsvpSummaryWords, going: boolean, countKnown: boolean): string {
  const parts = rsvpSummaryParts(words, going, countKnown);
  return parts.length === 0 ? "" : `${SUMMARY_SEPARATOR}${parts.join(SUMMARY_SEPARATOR)}`;
}
