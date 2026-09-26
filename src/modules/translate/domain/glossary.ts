/**
 * The club's words, for the provider (`DECISIONS.md` §NNN).
 *
 * A running club's Romanian has a handful of terms a general engine gets wrong: «Alergare de grup»
 * is a group run, not a "group race"; «masa» at a race is the registration desk, not a table or a
 * meal; «Cros» is a cross-country race. DeepL takes this as its `context` — read to choose words,
 * never translated, never returned and not billed — so the glossary costs nothing per press. Names
 * (the club's, a partner's, a place's, a trail's) and every number, time, date and distance are
 * to be kept exactly as written.
 *
 * Written once here, so a future provider that takes a system prompt instead reads the same list.
 */
export const CLUB_GLOSSARY: readonly (readonly [ro: string, en: string])[] = [
  ["Alergare de grup", "group run"],
  ["Concurs", "race"],
  ["Cros", "cross-country race"],
  ["masa (de înscrieri)", "the desk"],
  ["număr de concurs", "race number"],
  ["declarație", "declaration"],
  ["înscriere", "registration"],
  ["listă de așteptare", "waiting list"],
  ["traseu", "route"],
  ["diferență de nivel", "elevation gain"],
  ["frontală", "head torch"],
];

export function glossaryContext(): string {
  const terms = CLUB_GLOSSARY.map(([ro, en]) => `«${ro}» = "${en}"`).join("; ");
  return [
    "Texts written by a small amateur running club in Brașov, Romania, for its event pages and messages to runners.",
    `Use these terms: ${terms}.`,
    "Keep names of people, places, trails, partners and the club exactly as written, and keep every number, time, date and distance unchanged.",
  ].join(" ");
}
