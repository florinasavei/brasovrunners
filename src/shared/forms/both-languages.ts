import type { z } from "zod";

/**
 * Both languages or neither (§352; the owner, 2026-09-24: "I want multi-lingual, always").
 *
 * Every text the club types for a page is Romanian **and** English. A text that is optional is
 * optional in both at once: written in both, or left empty in both. One side written and the
 * other empty is refused at the save — a draft's too — naming the empty box, so the refusal
 * summary links straight to the language still owed and the rest of the form comes back as typed
 * (§315). The site then never has to decide what an English page shows where only Romanian was
 * written: there is nothing to fall back from, so nothing falls back.
 *
 * One rule, read in two places and nowhere else: `refuseOneLanguage` for a pair inside a Zod
 * schema (a partner's description, a link's label — `content/events/fields.ts`), and
 * `missingLanguage` for a pair the service can only see once both languages are parsed (the event
 * texts, `content/events/service.ts`). No list of pairs lives here; each schema names its own.
 */

/** The two languages a club text is written in, as the form's own suffixes spell them. */
export type TextLanguage = "ro" | "en";

/** A plain box says something when it holds more than whitespace. */
export const isWrittenText = (value: string | null | undefined): boolean => (value ?? "").trim() !== "";

/**
 * The language whose side of the pair is empty while the other is written, or null when both or
 * neither are. `isWritten` says what "written" means for this pair — a plain box by default; a
 * rich text passes its own test, where a document with no words may still carry a picture.
 */
export function missingLanguage<T>(pair: Readonly<Record<TextLanguage, T>>, isWritten: (value: T) => boolean): TextLanguage | null {
  const ro = isWritten(pair.ro);
  const en = isWritten(pair.en);
  if (ro === en) return null;
  return ro ? "en" : "ro";
}

const LANGUAGE_NAME: Record<TextLanguage, string> = { ro: "Romanian", en: "English" };

/**
 * A Zod refinement for one pair of plain boxes: one issue, on the empty side's path, when only
 * the other side is written. `what` starts the developer-facing message ("partner 2: the
 * description"); the organizer reads the box's own label from `field-labels.ts`, never this.
 */
export function refuseOneLanguage(
  ctx: z.RefinementCtx,
  pair: Readonly<Record<TextLanguage, string | null | undefined>>,
  paths: Readonly<Record<TextLanguage, (string | number)[]>>,
  what: string,
): void {
  const missing = missingLanguage(pair, isWrittenText);
  if (!missing) return;
  const written = missing === "ro" ? "en" : "ro";
  ctx.addIssue({
    code: "custom",
    path: paths[missing],
    message: `${what} is written in ${LANGUAGE_NAME[written]} only; write it in ${LANGUAGE_NAME[missing]} too, or in neither`,
  });
}
