/**
 * The allowlist of English boxes «Tradu din română» may fill, and their Romanian twins
 * (`DECISIONS.md` §464). The browser finds boxes by it; the server refuses any other name, so a
 * crafted request cannot translate a participant's answer or a legal text (BR-REQ-060-01, §418).
 * Deliberately absent: `slug`, anything under `/admin/legal`, every registration, participant
 * and staff field.
 */

const TRANSLATION_FIELDS = [
  "title",
  "excerptBody",
  "body",
  "rules",
  "schedule",
  "routeDescription",
  "checklist",
  "seoTitle",
  "seoDescription",
  "discountNote",
  "description",
] as const;

/** The translation fields that hold a rich text (Tiptap JSON in a hidden box), not a plain box. */
export const RICH_TEXT_FIELDS: ReadonlySet<string> = new Set(["excerptBody", "body", "rules", "schedule", "routeDescription"]);

const ENGLISH_FIELD_PATTERNS: readonly RegExp[] = [
  new RegExp(`^translations\\.en\\.(${TRANSLATION_FIELDS.join("|")})$`),
  /^event\.locationNameEn$/,
  /^event\.coHosts\[\d{1,2}\]\.descriptionEn$/,
  /^event\.coHosts\[\d{1,2}\]\.links\[\d{1,2}\]\.labelEn$/,
  /^event\.links\[\d{1,2}\]\.labelEn$/,
  /^event\.schedule\[\d{1,3}\]\.en$/,
  /^notice\.noteEn$/,
  /^cancel\.reasonEn$/,
  /^(subject|body)En$/,
  // «Echipa» (§474, §482).
  /^roleEn$/,
  /^links\[\d{1,2}\]\.labelEn$/,
  /^(bio|intro)EnBody$/,
  // «Întrebări frecvente» (§525).
  /^faq\[\d{1,3}\]\.(question|category)En$/,
  /^faq\[\d{1,3}\]\.answerEnBody$/,
];

/** Rich texts named `…RoBody` / `…EnBody` (§474, §525). */
const TEAM_RICH_TEXT = /^(?:bio|intro|faq\[\d{1,3}\]\.answer)EnBody$/;

export function isTranslatableEnglishField(name: string): boolean {
  return ENGLISH_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

export function isRichTextField(name: string): boolean {
  if (TEAM_RICH_TEXT.test(name)) return true;
  const translation = /^translations\.en\.(\w+)$/.exec(name);
  return translation !== null && RICH_TEXT_FIELDS.has(translation[1] ?? "");
}

/** The Romanian box's candidate names, in order; `event.locationName` has no suffix (§362). */
export function romanianTwinCandidates(englishName: string): string[] {
  if (englishName.startsWith("translations.en.")) return [`translations.ro.${englishName.slice("translations.en.".length)}`];
  if (englishName.endsWith("EnBody")) return [`${englishName.slice(0, -"EnBody".length)}RoBody`];
  if (englishName.endsWith(".en")) return [`${englishName.slice(0, -3)}.ro`];
  if (englishName.endsWith("En")) {
    const stem = englishName.slice(0, -2);
    return [`${stem}Ro`, stem];
  }
  return [];
}
