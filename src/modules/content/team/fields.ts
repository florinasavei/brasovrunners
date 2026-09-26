import { z } from "zod";
import {
  EMPTY_DOC,
  hasRichTextContent,
  parseRichText,
  type RichTextBlock,
  type RichTextDoc,
  richTextToPlainText,
} from "@/modules/content/rich-text/domain/schema";
import { missingLanguage, refuseOneLanguage, type TextLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
import {
  DEFAULT_TEAM_LINK_KIND,
  guessTeamLinkKind,
  isTeamLinkKind,
  isTeamLinkUrl,
  MAX_TEAM_LINK_LABEL,
  MAX_TEAM_LINK_URL,
  MAX_TEAM_LINKS,
  normalizeTeamLinkUrl,
  type TeamLink,
} from "./links";

/**
 * What the club types for one card of «Echipa» (§459, grown by §474).
 *
 * A name, required. What the person does for the club — Romanian **and** English, or neither
 * (§352). The words about them, written in the rich-text editor since §474 (paragraphs, a list, a
 * link in the text, a picture), the same pair rule, read as "written" by `hasRichTextContent` — a
 * picture with no words is something written. Up to six links, each a kind, an https address and
 * a label in both languages or neither (§332's shape). A photograph, by the id of the picture the
 * upload stored (`/api/admin/media`), or none.
 *
 * One side written and the other empty is refused on the empty box, every other box kept (§315).
 */

export const TEAM_NAME_MAX = 80;
export const TEAM_ROLE_MAX = 80;
/** The words about a person, counted as the page reads them (`richTextToPlainText`). */
export const TEAM_BIO_MAX = 1500;
/** A rich-text document as the editor posts it — the ceiling every editorial body has. */
export const TEAM_RICH_TEXT_JSON_MAX = 200_000;

/**
 * A box's text as the card keeps it: trimmed, Windows line breaks made one, and never more than
 * one empty line in a row — a short paragraph or two, not a layout. Done before the limit is
 * counted, so a textarea the browser allowed at `maxLength` (it counts a line break as one
 * character, and posts two) is never refused over the difference (§352's reasoning).
 */
export function normalizeTeamText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Plain words as a document: one paragraph per line. How a text written before the editor
 * (§459's textarea, the sample seed) reads on the page and opens in the editor (§474).
 */
export function teamDocFromPlain(text: string | null | undefined): RichTextDoc {
  const lines = normalizeTeamText(text ?? "")
    .split("\n")
    .filter((line) => line !== "");
  if (lines.length === 0) return EMPTY_DOC;
  return { type: "doc", content: lines.map((line) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: line }] })) };
}

/** A stored document or its plain words from before the editor, or null when neither says anything. */
export function storedTeamDoc(json: unknown, plain: string | null): RichTextDoc | null {
  const parsed = json === null || json === undefined ? null : parseRichTextLeniently(json);
  const doc = parsed ?? teamDocFromPlain(plain);
  return hasRichTextContent(doc) ? doc : null;
}

function parseRichTextLeniently(value: unknown): RichTextDoc | null {
  try {
    return parseRichText(value);
  } catch {
    return null;
  }
}

/** Whether a document holds a table anywhere — refused in a card, two to a row on a phone (§474). */
export function hasTable(doc: RichTextDoc): boolean {
  // A table is a top-level block: a list item and a quote hold paragraphs only (`schema.ts`).
  return (doc.content ?? []).some((block: RichTextBlock) => block.type === "table");
}

/**
 * A JSON string from `RichTextEditor`, parsed against the allowlist so a bad body is a field
 * error; empty is the empty document; absent is "this caller posted the plain box instead".
 */
export const richTextBox = z
  .string()
  .max(TEAM_RICH_TEXT_JSON_MAX)
  .optional()
  .transform((value, ctx): RichTextDoc | undefined => {
    if (value === undefined) return undefined;
    if (value.trim() === "") return EMPTY_DOC;
    try {
      return parseRichText(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "the text is not a valid document" });
      return z.NEVER;
    }
  });

/** One language of a rich pair as the save keeps it: the document and its plain words, or nulls. */
export type TeamRichText = { doc: RichTextDoc | null; plain: string | null };

/**
 * One language of a rich pair: the posted document when the editor posted one, else the plain
 * box read as paragraphs. `fromBody` says which, so a refusal names the box that was posted.
 */
function resolveRich(plain: string, body: RichTextDoc | undefined): { doc: RichTextDoc; plainWords: string; fromBody: boolean } {
  if (body !== undefined) return { doc: body, plainWords: richTextToPlainText(body).trim(), fromBody: true };
  return { doc: teamDocFromPlain(plain), plainWords: plain, fromBody: false };
}

/**
 * Both languages of a rich text, checked and resolved: each side's document within `max` words
 * and without a table where `tables` is false, then both or neither (§352) — refused on the box
 * that was posted for the empty side. Returns what the save writes.
 */
export function resolveRichPair(
  ctx: z.RefinementCtx,
  input: Readonly<Record<TextLanguage, { plain: string; body: RichTextDoc | undefined }>>,
  names: Readonly<Record<TextLanguage, { plain: string; body: string }>>,
  options: { max: number; tables: boolean; what: string },
): Record<TextLanguage, TeamRichText> {
  const sides = {
    ro: resolveRich(input.ro.plain, input.ro.body),
    en: resolveRich(input.en.plain, input.en.body),
  };
  const nameOf = (language: TextLanguage) => (sides[language].fromBody ? names[language].body : names[language].plain);
  for (const language of ["ro", "en"] as const) {
    const side = sides[language];
    if (side.fromBody && side.plainWords.length > options.max) {
      ctx.addIssue({ code: "custom", path: [nameOf(language)], message: `${options.what} is longer than ${options.max} characters` });
    }
    if (!options.tables && hasTable(side.doc)) {
      ctx.addIssue({ code: "custom", path: [nameOf(language)], message: `${options.what} may not hold a table` });
    }
  }
  const missing = missingLanguage({ ro: sides.ro.doc, en: sides.en.doc }, hasRichTextContent);
  if (missing) {
    ctx.addIssue({
      code: "custom",
      path: [nameOf(missing)],
      message: `${options.what} is written in one language only; write it in both, or in neither`,
    });
  }
  const kept = (language: TextLanguage): TeamRichText => {
    const side = sides[language];
    if (!hasRichTextContent(side.doc)) return { doc: null, plain: null };
    return { doc: side.doc, plain: side.plainWords === "" ? null : side.plainWords };
  };
  return { ro: kept("ro"), en: kept("en") };
}

const optionalText = (max: number) =>
  z
    .string()
    .transform(normalizeTeamText)
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/** A plain box of the older form, absent reading as empty. */
const plainBox = (max: number) => z.string().optional().default("").transform(normalizeTeamText).pipe(z.string().max(max));

/** One row of the links' editor, as posted: four boxes, every one optional (the spare line). */
export const teamLinkRowSchema = z
  .object({
    kind: z.string().trim().max(20).optional().default(DEFAULT_TEAM_LINK_KIND),
    url: z.string().trim().max(MAX_TEAM_LINK_URL).optional().default(""),
    labelRo: z.string().trim().max(MAX_TEAM_LINK_LABEL).optional().default(""),
    labelEn: z.string().trim().max(MAX_TEAM_LINK_LABEL).optional().default(""),
  })
  .strict();

type TeamLinkRowInput = z.infer<typeof teamLinkRowSchema>;

/** The editor's spare line: nothing typed. The kind alone is not an answer — the select always posts one. */
const isBlankRow = (row: TeamLinkRowInput) => row.url === "" && row.labelRo === "" && row.labelEn === "";

/**
 * The links as the editor posts them. Every refusal names the row as the editor numbered it —
 * the posted index, before the spare lines are dropped — so "link 2" is the second row on the
 * screen and the summary's link lands on its box. A row with a label and no address is refused
 * rather than dropped: somebody meant a link there. §332's rules, for a person.
 */
const teamLinksField = z
  .array(teamLinkRowSchema)
  .max(50)
  .superRefine((rows, ctx) => {
    let filled = 0;
    rows.forEach((row, index) => {
      if (isBlankRow(row)) return;
      filled += 1;
      const n = index + 1;
      if (!isTeamLinkKind(row.kind)) {
        ctx.addIssue({ code: "custom", path: [index, "kind"], message: `link ${n}: the kind must be one of the list` });
      }
      if (row.url === "") {
        ctx.addIssue({ code: "custom", path: [index, "url"], message: `link ${n}: a link needs its address, starting with https://` });
      } else if (!isTeamLinkUrl(row.url)) {
        ctx.addIssue({ code: "custom", path: [index, "url"], message: `link ${n}: the address must start with https://` });
      }
      refuseOneLanguage(ctx, { ro: row.labelRo, en: row.labelEn }, { ro: [index, "labelRo"], en: [index, "labelEn"] }, `link ${n}: the label`);
    });
    if (filled > MAX_TEAM_LINKS) {
      ctx.addIssue({ code: "custom", path: [], message: `at most ${MAX_TEAM_LINKS} links` });
    }
  })
  .transform((rows): TeamLink[] =>
    rows
      .filter((row) => !isBlankRow(row))
      .map((row) => ({
        kind: isTeamLinkKind(row.kind) ? row.kind : DEFAULT_TEAM_LINK_KIND,
        url: normalizeTeamLinkUrl(row.url),
        labelRo: row.labelRo === "" ? null : row.labelRo,
        labelEn: row.labelEn === "" ? null : row.labelEn,
      })),
  );

export const teamMemberFieldsSchema = z
  .object({
    name: z.string().transform(normalizeTeamText).pipe(z.string().min(1).max(TEAM_NAME_MAX).regex(/^[^\n]*$/)),
    roleRo: optionalText(TEAM_ROLE_MAX),
    roleEn: optionalText(TEAM_ROLE_MAX),
    /** The words about them as a plain box — §459's form, a fixture, the seed. */
    bioRo: plainBox(TEAM_BIO_MAX),
    bioEn: plainBox(TEAM_BIO_MAX),
    /** The words about them as the rich-text editor posts them (§474); wins over the plain box. */
    bioRoBody: richTextBox,
    bioEnBody: richTextBox,
    /**
     * §459's one link, for a caller that posts no list: read as a row of its guessed kind. The
     * editor posts `links` instead, which wins.
     */
    link: z
      .string()
      // Absent reads as empty: a form that predates the box, or a test, posts no link at all.
      .default("")
      .transform((value) => value.trim())
      .pipe(z.string().max(MAX_TEAM_LINK_URL).refine((value) => value === "" || isTeamLinkUrl(value), "not an https link")),
    /** The links' rows (§474), or absent for a caller that posts only `link`. */
    links: teamLinksField.optional(),
    /** The stored picture's id, or empty for a card without a photo. */
    photoAssetId: z
      .string()
      .trim()
      .refine((value) => value === "" || isUuid(value), "not a picture id")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
  })
  .transform((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.roleRo, en: fields.roleEn }, { ro: ["roleRo"], en: ["roleEn"] }, "the role");
    const bio = resolveRichPair(
      ctx,
      { ro: { plain: fields.bioRo, body: fields.bioRoBody }, en: { plain: fields.bioEn, body: fields.bioEnBody } },
      { ro: { plain: "bioRo", body: "bioRoBody" }, en: { plain: "bioEn", body: "bioEnBody" } },
      { max: TEAM_BIO_MAX, tables: false, what: "the description" },
    );
    const links =
      fields.links ?? (fields.link === "" ? [] : [{ kind: guessTeamLinkKind(fields.link), url: normalizeTeamLinkUrl(fields.link), labelRo: null, labelEn: null }]);
    return {
      name: fields.name,
      roleRo: fields.roleRo,
      roleEn: fields.roleEn,
      bioRo: bio.ro.plain,
      bioEn: bio.en.plain,
      bioRoJson: bio.ro.doc,
      bioEnJson: bio.en.doc,
      links,
      /** The first link, written to §459's column for the code still serving during a rollout. */
      link: links[0]?.url ?? null,
      photoAssetId: fields.photoAssetId,
    };
  });

export type TeamMemberFields = z.output<typeof teamMemberFieldsSchema>;

/**
 * A refusal's path as the form's box name: `links.1.url` is the box `links[1].url` the editor
 * posted, every other path its own name.
 */
export function teamFieldName(path: readonly PropertyKey[]): string {
  if (path[0] === "links" && typeof path[1] === "number" && typeof path[2] === "string") return `links[${path[1]}].${path[2]}`;
  if (path[0] === "links") return "links";
  return path.map(String).join(".");
}
