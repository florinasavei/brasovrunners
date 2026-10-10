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
import { readTeamPhotoCrop } from "./photo-crop";

/**
 * One card of «Echipa» (§459, §474): a name; role and rich-text bio in both languages or neither
 * (§352); up to twelve links (§491); an optional photo and its crop (§541). A one-sided pair is
 * refused on the empty box (§315).
 */

export const TEAM_NAME_MAX = 80;
export const TEAM_ROLE_MAX = 80;
/** The words about a person, counted as the page reads them (`richTextToPlainText`). */
export const TEAM_BIO_MAX = 1500;
/** A rich-text document as the editor posts it — the ceiling every editorial body has. */
export const TEAM_RICH_TEXT_JSON_MAX = 200_000;
/** The one-line sub-role under the role title (§691): «Parteneriate sportive și echipamente». */
export const TEAM_SUBTITLE_MAX = 120;
/** «Responsabilități» (§691): one per line, at most this many lines of this many characters. */
export const TEAM_RESPONSIBILITIES_MAX_LINES = 12;
export const TEAM_RESPONSIBILITY_LINE_MAX = 160;
/** Where a card sat against the card it answered to (§691): kept for the column, drawn by nobody since §NNN. */
export const TEAM_PLACEMENTS = ["below", "beside"] as const;
export type TeamPlacement = (typeof TEAM_PLACEMENTS)[number];
/**
 * The canvas's levels (§NNN; the owner: «the president is top level 1, then the advisor level 1.5
 * and the rest are level 2»): whole and half steps from the top row to the ninth. The whole number
 * is the row; a `.0` card leads it, a `.5` card is a small one beside the leads. Nothing else — a
 * quarter step would be a third kind of card nobody drew — and null is "not on the canvas".
 */
export const TEAM_LEVEL_MIN = 1;
export const TEAM_LEVEL_MAX = 9;
export const TEAM_LEVELS: readonly number[] = Array.from({ length: (TEAM_LEVEL_MAX - TEAM_LEVEL_MIN) * 2 + 1 }, (_, index) => TEAM_LEVEL_MIN + index / 2);

export function isTeamLevel(value: number): boolean {
  return Number.isFinite(value) && value >= TEAM_LEVEL_MIN && value <= TEAM_LEVEL_MAX && Number.isInteger(value * 2);
}
/** A box's title under the chart (§691), and its words counted as the page reads them. */
export const TEAM_BOX_TITLE_MAX = 120;
export const TEAM_BOX_BODY_MAX = 3000;

/** One line: every run of whitespace, a line break included, made one space, then trimmed. */
export function normalizeTeamLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** «Responsabilități» as the page draws them: one per line, blank lines dropped (§691). */
export function responsibilityLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * Trimmed, CRLF made LF, at most one empty line in a row. Runs before the length check, since a
 * textarea's `maxLength` counts a line break as one character but posts two (§352).
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

/** Plain words as a document, one paragraph per line — for text from before the editor (§474). */
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

/** The posted document, else the plain box as paragraphs; `fromBody` names the box for a refusal. */
function resolveRich(plain: string, body: RichTextDoc | undefined): { doc: RichTextDoc; plainWords: string; fromBody: boolean } {
  if (body !== undefined) return { doc: body, plainWords: richTextToPlainText(body).trim(), fromBody: true };
  return { doc: teamDocFromPlain(plain), plainWords: plain, fromBody: false };
}

/** Both languages of a rich text checked (length, tables, both or neither §352) and resolved for the save. */
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

/** An optional one-line text (the sub-role, §691): absent reads as empty. */
const optionalLine = (max: number) =>
  z
    .string()
    .optional()
    .default("")
    .transform(normalizeTeamLine)
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/**
 * «Responsabilități» as typed, one per line (§691): blank lines dropped, at most
 * `TEAM_RESPONSIBILITIES_MAX_LINES` lines of `TEAM_RESPONSIBILITY_LINE_MAX` characters, kept
 * joined by one line break; nothing typed is null.
 */
const optionalResponsibilities = z
  .string()
  .optional()
  .default("")
  .transform(responsibilityLines)
  .superRefine((lines, ctx) => {
    if (lines.length > TEAM_RESPONSIBILITIES_MAX_LINES) {
      ctx.addIssue({ code: "custom", message: `at most ${TEAM_RESPONSIBILITIES_MAX_LINES} responsibilities, one per line` });
    }
    const long = lines.findIndex((line) => line.length > TEAM_RESPONSIBILITY_LINE_MAX);
    if (long !== -1) {
      ctx.addIssue({ code: "custom", message: `responsibility ${long + 1} is longer than ${TEAM_RESPONSIBILITY_LINE_MAX} characters` });
    }
  })
  .transform((lines) => (lines.length === 0 ? null : lines.join("\n")));

/** The card this one answers to (§691): a uuid or nothing; whether it exists is the service's to check. */
const reportsToField = z
  .string()
  .optional()
  .default("")
  .transform((value) => value.trim())
  .refine((value) => value === "" || isUuid(value), "not a card id")
  .transform((value) => (value === "" ? null : value.toLowerCase()));

/**
 * «Nivel» as the editor posts it (§NNN): the select's value (`"1.5"`), a fixture's number, or nothing.
 * A comma decimal is read too, for a value typed by hand; anything off the scale is refused on the box.
 */
const levelField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value, ctx): number | null => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().replace(",", ".");
    if (text === "") return null;
    const parsed = Number(text);
    if (!isTeamLevel(parsed)) {
      ctx.addIssue({ code: "custom", message: `a level is a whole or half step from ${TEAM_LEVEL_MIN} to ${TEAM_LEVEL_MAX}` });
      return z.NEVER;
    }
    return parsed;
  });

/** Whether a card is asked to answer to itself — refused on the `reportsToId` box (§691). */
export function teamReportsToSelf(fields: { reportsToId: string | null }, selfId: string | null | undefined): boolean {
  return fields.reportsToId !== null && selfId !== null && selfId !== undefined && fields.reportsToId === selfId.toLowerCase();
}

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
 * The links as posted (§332's rules). Refusals use the posted index, before blanks are dropped,
 * so "link 2" is the second row on screen. A label without an address is refused, not dropped.
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
    /** Plain-box bio (§459's form, fixtures, the seed). */
    bioRo: plainBox(TEAM_BIO_MAX),
    bioEn: plainBox(TEAM_BIO_MAX),
    /** Rich-text bio (§474); wins over the plain box. */
    bioRoBody: richTextBox,
    bioEnBody: richTextBox,
    /** §459's single link, read as a row of its guessed kind; `links` wins. */
    link: z
      .string()
      .default("")
      .transform((value) => value.trim())
      .pipe(z.string().max(MAX_TEAM_LINK_URL).refine((value) => value === "" || isTeamLinkUrl(value), "not an https link")),
    links: teamLinksField.optional(),
    photoAssetId: z
      .string()
      .trim()
      .refine((value) => value === "" || isUuid(value), "not a picture id")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
    /** The crop's four fractions (§541): JSON from the field, or an object from a fixture. */
    photoCrop: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
    /** The organisational chart (§691): the sub-role line and the responsibilities, both or neither. */
    subtitleRo: optionalLine(TEAM_SUBTITLE_MAX),
    subtitleEn: optionalLine(TEAM_SUBTITLE_MAX),
    responsibilitiesRo: optionalResponsibilities,
    responsibilitiesEn: optionalResponsibilities,
    /** Whom the card answers to, and where it sits against that card (§691): columns kept, posted by no form since §NNN. */
    reportsToId: reportsToField,
    placement: z.enum(TEAM_PLACEMENTS).optional().default("below"),
    /** The card's level on the canvas (§NNN), or nothing: the grid. */
    level: levelField,
  })
  .transform((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.roleRo, en: fields.roleEn }, { ro: ["roleRo"], en: ["roleEn"] }, "the role");
    refuseOneLanguage(ctx, { ro: fields.subtitleRo, en: fields.subtitleEn }, { ro: ["subtitleRo"], en: ["subtitleEn"] }, "the subtitle");
    refuseOneLanguage(
      ctx,
      { ro: fields.responsibilitiesRo, en: fields.responsibilitiesEn },
      { ro: ["responsibilitiesRo"], en: ["responsibilitiesEn"] },
      "the responsibilities",
    );
    const bio = resolveRichPair(
      ctx,
      { ro: { plain: fields.bioRo, body: fields.bioRoBody }, en: { plain: fields.bioEn, body: fields.bioEnBody } },
      { ro: { plain: "bioRo", body: "bioRoBody" }, en: { plain: "bioEn", body: "bioEnBody" } },
      { max: TEAM_BIO_MAX, tables: false, what: "the description" },
    );
    const crop = readTeamPhotoCrop(fields.photoCrop);
    // A crop the box could not have drawn is a hand-made post: refused on the photo, the rest kept.
    if (crop === "invalid") ctx.addIssue({ code: "custom", path: ["photoAssetId"], message: "not a crop of the photo" });
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
      /** The first link, kept in §459's column for code still serving during a rollout. */
      link: links[0]?.url ?? null,
      photoAssetId: fields.photoAssetId,
      photoCrop: fields.photoAssetId && crop !== "invalid" ? crop : null,
      subtitleRo: fields.subtitleRo,
      subtitleEn: fields.subtitleEn,
      responsibilitiesRo: fields.responsibilitiesRo,
      responsibilitiesEn: fields.responsibilitiesEn,
      reportsToId: fields.reportsToId,
      /** `beside` means something only against a parent; a root is always `below` (§691). */
      placement: (fields.reportsToId === null ? "below" : fields.placement) as TeamPlacement,
      level: fields.level,
    };
  });

export type TeamMemberFields = z.output<typeof teamMemberFieldsSchema>;

/** A required one-line title in one language (a box's, §691). */
const requiredLine = (max: number) => z.string().optional().default("").transform(normalizeTeamLine).pipe(z.string().min(1).max(max));

/**
 * One box under the chart (§691): a title in both languages, always, and a rich text in both or
 * neither (§352) with a bio's allowlist — no table, the box is read on a phone. The plain boxes are
 * for a caller without the editor (fixtures); the posted document wins.
 */
export const teamBoxFieldsSchema = z
  .object({
    titleRo: requiredLine(TEAM_BOX_TITLE_MAX),
    titleEn: requiredLine(TEAM_BOX_TITLE_MAX),
    bodyRo: plainBox(TEAM_BOX_BODY_MAX),
    bodyEn: plainBox(TEAM_BOX_BODY_MAX),
    bodyRoBody: richTextBox,
    bodyEnBody: richTextBox,
  })
  .transform((fields, ctx) => {
    const body = resolveRichPair(
      ctx,
      { ro: { plain: fields.bodyRo, body: fields.bodyRoBody }, en: { plain: fields.bodyEn, body: fields.bodyEnBody } },
      { ro: { plain: "bodyRo", body: "bodyRoBody" }, en: { plain: "bodyEn", body: "bodyEnBody" } },
      { max: TEAM_BOX_BODY_MAX, tables: false, what: "the text" },
    );
    return {
      titleRo: fields.titleRo,
      titleEn: fields.titleEn,
      bodyRo: body.ro.plain,
      bodyEn: body.en.plain,
      bodyRoJson: body.ro.doc,
      bodyEnJson: body.en.doc,
    };
  });

export type TeamBoxFields = z.output<typeof teamBoxFieldsSchema>;

/** A refusal's path as the form's box name: `links.1.url` → `links[1].url`. */
export function teamFieldName(path: readonly PropertyKey[]): string {
  if (path[0] === "links" && typeof path[1] === "number" && typeof path[2] === "string") return `links[${path[1]}].${path[2]}`;
  if (path[0] === "links") return "links";
  return path.map(String).join(".");
}
