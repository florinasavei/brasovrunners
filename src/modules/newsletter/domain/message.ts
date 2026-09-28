import { type RichTextDoc, richTextSchema, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { placeholdersIn } from "@/modules/notifications/domain/email-copy";
import { unsupportedNewsletterBlocks } from "@/modules/notifications/domain/email-rich-text";
import { type BilingualText, isWrittenText, type TextLanguage } from "@/shared/forms/both-languages";

/**
 * A newsletter as the club writes it on `/admin/newsletter` (§445): a subject and a body, Romanian and
 * English, both required — every subscriber reads their own language first and the other under it
 * (§96), and "multi-lingual, always" is the owner's standing rule (§352).
 *
 * **The body is rich text since §NNN** (the owner, 2026-09-28: «trebuie să pot scrie cu Rich text
 * editor abonaților!»): the platform's own editor, one per language, posting the document as JSON —
 * bold, italic, the two headings, the lists, a quote, links, and pictures the club stored
 * (`NEWSLETTER_BODY_BLOCKS`). A send written before stays the plain text it was stored as and is
 * rendered as it always was (a blank line a paragraph, nothing read as formatting); a plain string
 * posted without the editor — a script, a browser with the island not loaded — is read the same way.
 *
 * No placeholders: a newsletter goes to an address, not to a registration, so there is no name,
 * event or number to put in one — a `{word}` typed in it is refused by name rather than reaching a
 * subscriber in braces.
 */

/** One line; the subject a subscriber receives joins the two languages with " / " (§96). */
export const NEWSLETTER_SUBJECT_MAX = 150;
/**
 * Room for a real letter — the news, a session's details and its terms — and not for a book. Counted
 * on the words the reader reads (`richTextToPlainText`), never on the JSON that carries them.
 */
export const NEWSLETTER_BODY_MAX = 6000;
/** The posted document's own ceiling: a letter of 6 000 characters with its marks and pictures is far below it. */
export const NEWSLETTER_BODY_JSON_MAX = 400_000;

/** The composer's boxes, by the names the form posts (§NNN: the body's are the rich editors' hidden boxes). */
export type NewsletterBox = "subjectRo" | "subjectEn" | "newsletterBodyRo" | "newsletterBodyEn";

/** A stored body: the editor's document, or the plain text a send written before §NNN carries. */
export type NewsletterBody = RichTextDoc | string;

export type NewsletterWords = { subject: BilingualText; body: { ro: RichTextDoc; en: RichTextDoc } };

/** What a stored send's words read as: its subject and each body as it was stored. */
export type StoredNewsletterWords = { subject: BilingualText; body: { ro: NewsletterBody; en: NewsletterBody } };

export type NewsletterIssue =
  | { box: NewsletterBox; problem: "empty" | "tooLong" }
  | { box: NewsletterBox; problem: "placeholder" | "unsupported"; names: string[] };

const BOX: Record<"subject" | "body", Record<TextLanguage, NewsletterBox>> = {
  subject: { ro: "subjectRo", en: "subjectEn" },
  body: { ro: "newsletterBodyRo", en: "newsletterBodyEn" },
};

const subjectLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Plain text as a document: a blank line starts a paragraph; nothing inside it is read as formatting. */
export function newsletterDocFromText(text: string): RichTextDoc {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return { type: "doc", content: paragraphs.map((paragraph) => ({ type: "paragraph", content: [{ type: "text", text: paragraph }] })) };
}

/**
 * A body as posted, read: the editor's JSON as a document, a plain string as one (above), and
 * `invalid` for JSON that is not a document this site accepts — a picture from somewhere else, a
 * node nobody offers. Never throws: the refusal names the box.
 */
export function readPostedNewsletterBody(value: string | null | undefined): RichTextDoc | "invalid" {
  const raw = (value ?? "").trim();
  if (raw === "") return { type: "doc", content: [] };
  if (!raw.startsWith("{")) return newsletterDocFromText(raw);
  if (raw.length > NEWSLETTER_BODY_JSON_MAX) return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return newsletterDocFromText(raw);
  }
  const doc = richTextSchema.safeParse(parsed);
  return doc.success ? doc.data : "invalid";
}

/** A body's words, as the reader reads them: what the ceiling, the emptiness and the braces are counted on. */
export function newsletterBodyText(body: NewsletterBody): string {
  return typeof body === "string" ? body : richTextToPlainText(body);
}

/** The first line of a body's words, for the sends' history (§NNN): at most `max` characters. */
export function newsletterFirstLine(body: NewsletterBody, max = 120): string {
  const line = newsletterBodyText(body).split("\n").map((part) => part.trim()).find((part) => part !== "") ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The words as posted, checked: every problem at once, one per box, so the refusal names every box
 * to fix (§47) and the rest comes back as typed (§315); `words` is the normalized subject and the
 * two documents when there is none.
 */
export function checkNewsletterWords(input: {
  subject: Readonly<Partial<Record<TextLanguage, string | null>>>;
  body: Readonly<Partial<Record<TextLanguage, string | null>>>;
}): { words: NewsletterWords | null; issues: NewsletterIssue[] } {
  const subject = { ro: subjectLine(input.subject.ro ?? ""), en: subjectLine(input.subject.en ?? "") };
  const issues: NewsletterIssue[] = [];
  const checkText = (box: NewsletterBox, value: string, max: number): boolean => {
    if (!isWrittenText(value)) {
      issues.push({ box, problem: "empty" });
      return false;
    }
    if (value.length > max) {
      issues.push({ box, problem: "tooLong" });
      return false;
    }
    const names = [...new Set(placeholdersIn(value))];
    if (names.length > 0) {
      issues.push({ box, problem: "placeholder", names });
      return false;
    }
    return true;
  };
  for (const language of ["ro", "en"] as const) checkText(BOX.subject[language], subject[language], NEWSLETTER_SUBJECT_MAX);

  const body: Partial<Record<TextLanguage, RichTextDoc>> = {};
  for (const language of ["ro", "en"] as const) {
    const box = BOX.body[language];
    const doc = readPostedNewsletterBody(input.body[language]);
    if (doc === "invalid") {
      issues.push({ box, problem: "unsupported", names: [] });
      continue;
    }
    const unsupported = unsupportedNewsletterBlocks(doc);
    if (unsupported.length > 0) {
      issues.push({ box, problem: "unsupported", names: unsupported });
      continue;
    }
    if (checkText(box, richTextToPlainText(doc).trim(), NEWSLETTER_BODY_MAX)) body[language] = doc;
  }
  const words = issues.length === 0 && body.ro && body.en ? { subject, body: { ro: body.ro, en: body.en } } : null;
  return { words, issues };
}

/**
 * The stored words of a send (`newsletter_sends.subject`/`body`), or `null` when a row does not
 * carry both languages. A body is a document (since §NNN) or the plain text an older send stored.
 */
export function readNewsletterWords(subject: unknown, body: unknown): StoredNewsletterWords | null {
  const pair = (value: unknown): BilingualText | null => {
    if (!value || typeof value !== "object") return null;
    const { ro, en } = value as { ro?: unknown; en?: unknown };
    return typeof ro === "string" && typeof en === "string" && isWrittenText(ro) && isWrittenText(en) ? { ro, en } : null;
  };
  const one = (value: unknown): NewsletterBody | null => {
    if (typeof value === "string") return isWrittenText(value) ? value : null;
    const doc = richTextSchema.safeParse(value);
    return doc.success && isWrittenText(richTextToPlainText(doc.data)) ? doc.data : null;
  };
  const subjects = pair(subject);
  if (!subjects || !body || typeof body !== "object") return null;
  const { ro, en } = body as { ro?: unknown; en?: unknown };
  const bodyRo = one(ro);
  const bodyEn = one(en);
  return bodyRo !== null && bodyEn !== null ? { subject: subjects, body: { ro: bodyRo, en: bodyEn } } : null;
}
