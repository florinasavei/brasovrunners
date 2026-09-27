/**
 * Which boxes «Tradu din română» may fill, and where each one's Romanian twin is
 * (`DECISIONS.md` §464).
 *
 * **An allowlist of the club's own words, read by both halves.** The browser uses it to find the
 * English boxes of a form ("Tradu tot din română") and the Romanian box beside each; the server
 * refuses any name that is not on it, so the action cannot be pointed at anything else — a
 * participant's answer, a legal text — by a crafted request (BR-REQ-060-01). Every name here is
 * a text the club types for a page or a message:
 *
 * - an event's and a standing page's translation (`translations.en.*`): the title, the summary,
 *   the description, the rules, the programme's notes, the route description, what to bring, the
 *   discount note, the two search-engine texts, an album's description;
 * - an event's meeting place in English, a partner's description and its links' labels, a
 *   "Linkuri și fișiere" row's label, a programme row's words;
 * - the organizer's note on an update, the cancellation's reason, a message to the participants;
 * - «Echipa» (§474, §482): a card's role, its words about the person and its links' labels, and
 *   the page's introduction — one form per card, each posting the same names;
 * - «Întrebări frecvente» (§525): each card's question, «Categorie» and answer (`faq[<n>].…`), and
 *   the page's introduction — the whole page one form.
 *
 * **Deliberately not on it:** a page's address (`slug` — an address, not words); anything under
 * `/admin/legal` (counsel-reviewed, §418, and the legal editor posts other names anyway); and
 * every registration, participant and staff field. None of those has a button, and a request
 * naming one is refused whole.
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
  // «Echipa»: the role, a link row's label, the words about the person and the page's introduction.
  /^roleEn$/,
  /^links\[\d{1,2}\]\.labelEn$/,
  /^(bio|intro)EnBody$/,
  // «Întrebări frecvente» (§525): a card's question, its category and its answer.
  /^faq\[\d{1,3}\]\.(question|category)En$/,
  /^faq\[\d{1,3}\]\.answerEnBody$/,
];

/**
 * The rich texts that spell their pair `…RoBody` / `…EnBody`: «Echipa»'s bio and introduction
 * (§474), and a question's answer on «Întrebări frecvente» (§525).
 */
const TEAM_RICH_TEXT = /^(?:bio|intro|faq\[\d{1,3}\]\.answer)EnBody$/;

/** Whether `name` is an English box the club types words into — the whole of what may be translated. */
export function isTranslatableEnglishField(name: string): boolean {
  return ENGLISH_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

/** Whether the box holds a rich text (a Tiptap document) rather than plain words. */
export function isRichTextField(name: string): boolean {
  if (TEAM_RICH_TEXT.test(name)) return true;
  const translation = /^translations\.en\.(\w+)$/.exec(name);
  return translation !== null && RICH_TEXT_FIELDS.has(translation[1] ?? "");
}

/**
 * The Romanian box's name, in the order to try: the forms spell the pair four ways —
 * `translations.ro.x` / `translations.en.x`, `…Ro` / `…En`, a programme row's `.ro` / `.en`, and
 * «Echipa»'s `…RoBody` / `…EnBody` — and the meeting place's Romanian box has no suffix at all
 * (`event.locationName`, §362).
 */
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
