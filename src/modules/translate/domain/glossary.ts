/**
 * Running-club terms a general engine gets wrong (`DECISIONS.md` §464), sent as the provider's
 * unbilled `context`.
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
