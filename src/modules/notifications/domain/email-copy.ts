import { z } from "zod";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { richTextSchema } from "@/modules/content/rich-text/domain/schema";
import type { EmailLocale } from "@/infrastructure/email/adapter";

/**
 * The club's own wording for a message (`DECISIONS.md` §247; Dani's ask: the templates should
 * be editable in the backoffice).
 *
 * ## What is editable, and what is not
 *
 * **The words: the subject and the paragraphs.** Everything else the message is made of stays
 * in code — the greeting, the facts line, the action button and the token behind it, the QR,
 * the attachments, the links under the button, the sign-off and the layout. That line is not
 * timidity: those are the parts that carry trust (`AGENTS.md` §1.5 rule 1). A club that could
 * edit the button's address could send a participant to a link this platform never minted, and
 * a club that could edit the QR could send them to the desk with nothing to scan.
 *
 * **A closed set of placeholders**, written `{participantName}`, and no URL among them. A URL
 * in the words would be a link outside the one the message was built with, which is exactly
 * what the action button exists to be. Anything else between braces is refused at save time,
 * naming itself, rather than reaching a participant as literal text.
 *
 * **Both languages, separately.** A message is bilingual (§96), and a club that edits only the
 * Romanian half keeps the platform's English one — the override is per type *and* locale.
 *
 * ## Why this is a setting and not a table
 *
 * The same shape §100, §164 and §244 already proved: one `platform_settings` row, an
 * Administrator's — here a Redactor's — panel, an audit row naming who changed what. Seventeen
 * message types in two languages is a few kilobytes of JSON, read once per send batch and once
 * per preview; a table would be a migration and a join for the same answer.
 */

/** Written `{likeThis}` in the words, and substituted at send time. */
export const EMAIL_COPY_PLACEHOLDERS = [
  "participantName",
  "eventTitle",
  "eventLocationName",
  "eventStartsAtFormatted",
  "bibNumber",
  "checkinCode",
  "currentStatus",
  "holdExpiresAtFormatted",
  "signedAtFormatted",
  "eventChecklist",
  "staffRole",
  "inviterName",
] as const;

export type EmailCopyPlaceholder = (typeof EMAIL_COPY_PLACEHOLDERS)[number];

/** Enough for any message this platform sends; the longest shipped one has four. */
export const EMAIL_COPY_MAX_PARAGRAPHS = 8;

const PLACEHOLDER = /\{([A-Za-z0-9_]*)\}/g;

/** Every `{name}` in a piece of text, in the order they were written. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/** The ones this platform cannot fill — what the save refuses, naming each one. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(EMAIL_COPY_PLACEHOLDERS);
  return [...new Set(placeholdersIn(text).filter((name) => !known.has(name)))];
}

/**
 * Put the message's own facts into the club's words.
 *
 * A placeholder this message does not carry — `{bibNumber}` on a message sent before a number
 * exists — becomes nothing, and the spaces around it are closed up so the sentence still reads
 * as a sentence. A paragraph whose only fields are facts the message lacks is not sent at all
 * (`onlyMissingFacts`, below).
 *
 * **`edges: "keep"` is what a rich-text run asks for** (§270). A formatted paragraph is not one
 * string but a list of runs — `"Ai început înscrierea la "`, then `"{eventTitle}"` in bold, then
 * `" din data de "` — and trimming each of them separately welds the words to the bold ones:
 * "înscrierea la**Crosul de toamnă**din data de". The run in the middle may even be a single
 * space, which trimming deletes outright. So a whole paragraph is trimmed and a run is not;
 * closing up doubled spaces and the space before a comma stays in both, because both are about
 * what a vanished placeholder left behind rather than about the edges.
 */
export function fillPlaceholders(
  text: string,
  data: Record<string, unknown>,
  edges: "trim" | "keep" = "trim",
): string {
  const filled = text
    .replace(PLACEHOLDER, (whole, name: string) => {
      if (!isKnown(name)) return whole;
      const value = data[name];
      return isBlank(value) ? "" : String(value);
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");
  return edges === "trim" ? filled.trim() : filled;
}

/**
 * The facts the platform writes a sentence around **only when the message has them** (§NNN): the
 * number (`...(d.bibNumber ? [...] : [])`), the desk code, what to bring, the hold's deadline, the
 * time of signing, the start and the place (`templates.ts`). The other fields — the runner's name,
 * the event's title, the status, the colleague's role and inviter — are on every message that
 * names them, and where one is somehow missing the platform says a stand-in word ("eveniment",
 * "Un coleg") and keeps its sentence.
 */
export const EMAIL_COPY_CONDITIONAL_FACTS: ReadonlySet<string> = new Set<EmailCopyPlaceholder>([
  "eventLocationName",
  "eventStartsAtFormatted",
  "bibNumber",
  "checkinCode",
  "holdExpiresAtFormatted",
  "signedAtFormatted",
  "eventChecklist",
]);

/**
 * A paragraph of the club's words that this message leaves out (§NNN): it names at least one
 * field, and every field it names is one of the conditional facts above that this message lacks.
 *
 * The platform's own text never writes such a sentence: "Numărul tău de concurs: …" is added only
 * when there is a number, "Ce să aduci: …" only when the event says, "…sau spune codul …" never on
 * the club's copy, which carries no code. A text the club wrote cannot say "only when", so the
 * paragraph is the unit instead: one that would read "Numărul tău de concurs: ." is not sent. A
 * paragraph with a fact left in it, with the runner's name or the event's title, or with no field
 * at all, is sent as written — "{participantName}, locul tău a fost anulat." says what it must even
 * in the one message with no name to put in it. The editor's starting text puts each conditional
 * platform sentence in a paragraph of its own for exactly this (`email-copy-fields.ts`), and the
 * helper line under the box says so to whoever writes one.
 */
export function onlyMissingFacts(text: string, data: Record<string, unknown>): boolean {
  const names = placeholdersIn(text).filter(isKnown);
  return names.length > 0 && names.every((name) => EMAIL_COPY_CONDITIONAL_FACTS.has(name) && isBlank(data[name]));
}

function isKnown(name: string): boolean {
  return (EMAIL_COPY_PLACEHOLDERS as readonly string[]).includes(name);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

const copy = z
  .object({
    subject: z.string().trim().min(1).max(200),
    /**
     * The words as plain paragraphs. Still required, and still what the plain-text half of the
     * message is built from — when a document is present (§270) these are derived from it at
     * save time, so the two halves cannot say different things.
     */
    paragraphs: z.array(z.string().trim().min(1).max(1200)).min(1).max(EMAIL_COPY_MAX_PARAGRAPHS),
    /**
     * The same words with their formatting (§270): bold, italic, links, headings and lists,
     * written in the same editor as a page. Optional, because every entry written before §270
     * has none and because the platform's own text is plain — absent means the paragraphs above
     * are the whole of it.
     *
     * The narrower allowlist an email may carry — no picture, no film, no table — is checked in
     * `email-rich-text.ts` and by the save, not here: this schema is the shape of the setting,
     * and the reason those three are refused belongs with the renderer that would have to draw
     * them in a mail client.
     */
    body: richTextSchema.nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const text of [value.subject, ...value.paragraphs]) {
      for (const name of unknownPlaceholders(text)) {
        ctx.addIssue({
          code: "custom",
          message: `{${name}} is not a field this platform can fill`,
          path: [text === value.subject ? "subject" : "paragraphs"],
        });
      }
    }
  });

export type EmailCopyEntry = z.infer<typeof copy>;

/** `TYPE:locale` — one key, so the stored object is flat and a diff reads as one line. */
export function emailCopyKey(messageType: EmailMessageType, locale: EmailLocale): string {
  return `${messageType}:${locale}`;
}

const KEY = new RegExp(`^(${emailMessageType.enumValues.join("|")}):(ro|en)$`);

export const emailCopySchema = z.record(z.string().regex(KEY, "not a message type and language"), copy);

export type EmailCopy = z.infer<typeof emailCopySchema>;

export const DEFAULT_EMAIL_COPY: EmailCopy = {};

/** The club's words for this message and language, or `null` for the platform's own. */
export function copyFor(
  stored: EmailCopy | null | undefined,
  messageType: EmailMessageType,
  locale: EmailLocale,
): EmailCopyEntry | null {
  return stored?.[emailCopyKey(messageType, locale)] ?? null;
}
