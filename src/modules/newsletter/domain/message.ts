import { placeholdersIn } from "@/modules/notifications/domain/email-copy";
import { type BilingualText, isWrittenText, type TextLanguage } from "@/shared/forms/both-languages";

/**
 * A newsletter as the club writes it on `/admin/newsletter` (§NNN): a subject and a body, Romanian and
 * English, both required — every subscriber reads their own language first and the other under it
 * (§96), and "multi-lingual, always" is the owner's standing rule (§352).
 *
 * Plain text, like the organizer's message (§364): a blank line starts a paragraph, a single break
 * stays a line, nothing is read as formatting. No placeholders: a newsletter goes to an address,
 * not to a registration, so there is no name, event or number to put in one — a `{word}` typed in
 * it is refused by name rather than reaching a subscriber in braces.
 */

/** One line; the subject a subscriber receives joins the two languages with " / " (§96). */
export const NEWSLETTER_SUBJECT_MAX = 150;
/** Room for a real letter — the news, a discount code and its terms — and not for a book. */
export const NEWSLETTER_BODY_MAX = 6000;

export type NewsletterBox = "subjectRo" | "subjectEn" | "bodyRo" | "bodyEn";

export type NewsletterWords = { subject: BilingualText; body: BilingualText };

export type NewsletterIssue =
  | { box: NewsletterBox; problem: "empty" | "tooLong" }
  | { box: NewsletterBox; problem: "placeholder"; names: string[] };

const BOX: Record<"subject" | "body", Record<TextLanguage, NewsletterBox>> = {
  subject: { ro: "subjectRo", en: "subjectEn" },
  body: { ro: "bodyRo", en: "bodyEn" },
};

const subjectLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim();
const bodyText = (value: string) => value.replace(/\r\n?/g, "\n").trim();

/**
 * The words as posted, checked: every problem at once, one per box, so the refusal names every box
 * to fix (§47) and the rest comes back as typed (§315); `words` is the normalized text when there
 * is none.
 */
export function checkNewsletterWords(input: {
  subject: Readonly<Partial<Record<TextLanguage, string | null>>>;
  body: Readonly<Partial<Record<TextLanguage, string | null>>>;
}): { words: NewsletterWords | null; issues: NewsletterIssue[] } {
  const subject = { ro: subjectLine(input.subject.ro ?? ""), en: subjectLine(input.subject.en ?? "") };
  const body = { ro: bodyText(input.body.ro ?? ""), en: bodyText(input.body.en ?? "") };
  const issues: NewsletterIssue[] = [];
  const check = (part: "subject" | "body", value: string, language: TextLanguage, max: number) => {
    const box = BOX[part][language];
    if (!isWrittenText(value)) return issues.push({ box, problem: "empty" });
    if (value.length > max) return issues.push({ box, problem: "tooLong" });
    const names = [...new Set(placeholdersIn(value))];
    if (names.length > 0) issues.push({ box, problem: "placeholder", names });
  };
  for (const language of ["ro", "en"] as const) check("subject", subject[language], language, NEWSLETTER_SUBJECT_MAX);
  for (const language of ["ro", "en"] as const) check("body", body[language], language, NEWSLETTER_BODY_MAX);
  return { words: issues.length === 0 ? { subject, body } : null, issues };
}

/** The stored words of a send (`newsletter_sends.subject`/`body`), or `null` when a row does not carry both languages. */
export function readNewsletterWords(subject: unknown, body: unknown): NewsletterWords | null {
  const pair = (value: unknown): BilingualText | null => {
    if (!value || typeof value !== "object") return null;
    const { ro, en } = value as { ro?: unknown; en?: unknown };
    return typeof ro === "string" && typeof en === "string" && isWrittenText(ro) && isWrittenText(en) ? { ro, en } : null;
  };
  const subjects = pair(subject);
  const bodies = pair(body);
  return subjects && bodies ? { subject: subjects, body: bodies } : null;
}
