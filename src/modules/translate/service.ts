import { z } from "zod";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { isTranslatorError, type Translator, type TranslatorFailure } from "@/infrastructure/translate/adapter";
import { recordAuditEvent } from "@/modules/audit/repository";
import { type RichTextDoc, richTextSchema } from "@/modules/content/rich-text/domain/schema";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { canTranslateTexts } from "@/modules/staff-identity/domain/roles";
import { charactersTranslatedToday, readTranslationBudget } from "./budget";
import { budgetAllows } from "./domain/budget";
import { isRichTextField, isTranslatableEnglishField } from "./domain/fields";
import { glossaryContext } from "./domain/glossary";
import { protectPlaceholders, restorePlaceholders } from "./domain/placeholders";
import { type RichTextSegment, richTextSegments, segmentCharacters, withTranslatedSegments } from "./domain/rich-text-html";

/**
 * «Tradu din română» — the Romanian words of some English boxes, translated (`DECISIONS.md` §NNN).
 *
 * The owner, 2026-09-26: «I need to introduce the option to auto-translate from RO to EN from the
 * backoffice», then «use the free stuff, we are an ONG» — DeepL API Free.
 *
 * **It fills, it never saves.** The answer goes back to the browser, which puts it in the English
 * boxes as a draft the person reads and corrects; the ordinary save then stores it under every
 * rule it always had — both languages or neither (§352), the role for that box, the version. So
 * nothing here writes a text, and a translation nobody saved leaves no trace but its audit row.
 *
 * In order, each a refusal in words rather than an exception, since the press is a button and not
 * a form: the role (BR-REQ-060-01), a translator configured, a request naming only the club's own
 * boxes (`domain/fields.ts` — never a legal text, never a participant's data), something to
 * translate, the per-person throttle, the club's daily character budget, and then the provider's
 * own answer. One audit row per press that reached the provider: who, which boxes, how many
 * characters, which provider — never the words.
 */

const MAX_ITEMS = 150;
/** A box's words: every text the editor has is far under this; it bounds a crafted request. */
const MAX_TEXT = 20_000;

const itemSchema = z.discriminatedUnion("kind", [
  z.object({ field: z.string().max(120), kind: z.literal("text"), text: z.string().max(MAX_TEXT) }),
  z.object({ field: z.string().max(120), kind: z.literal("rich"), doc: z.unknown() }),
]);

const requestSchema = z.object({ items: z.array(itemSchema).min(1).max(MAX_ITEMS) });

export type TranslateItemInput = z.infer<typeof itemSchema>;

export type TranslatedItem = { field: string; kind: "text"; text: string } | { field: string; kind: "rich"; doc: RichTextDoc };

export type TranslateRefusal =
  | "forbidden"
  | "notConfigured"
  | "invalid"
  | "nothing"
  | "rateLimited"
  | "budget"
  | TranslatorFailure;

export type TranslateOutcome =
  | { ok: true; items: TranslatedItem[]; characters: number; remainingToday: number }
  | { ok: false; reason: TranslateRefusal; remainingToday?: number };

type Piece = { item: number; segment: RichTextSegment };

type Prepared = { field: string; kind: "text"; text: string } | { field: string; kind: "rich"; doc: RichTextDoc };

function prepare(raw: unknown): Prepared[] | null {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const prepared: Prepared[] = [];
  for (const item of parsed.data.items) {
    if (!isTranslatableEnglishField(item.field)) return null;
    if ((item.kind === "rich") !== isRichTextField(item.field)) return null;
    if (item.kind === "text") prepared.push(item);
    else {
      // The document the Romanian box holds, through the same allowlist a save uses (§11.3).
      const doc = richTextSchema.safeParse(item.doc);
      if (!doc.success) return null;
      prepared.push({ field: item.field, kind: "rich", doc: doc.data });
    }
  }
  return prepared;
}

export async function translateClubTexts<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  raw: unknown,
  deps: { translator: Translator | null; now: Date },
): Promise<TranslateOutcome> {
  if (!canTranslateTexts(actor.role)) return { ok: false, reason: "forbidden" };
  if (!deps.translator) return { ok: false, reason: "notConfigured" };

  const items = prepare(raw);
  if (!items) return { ok: false, reason: "invalid" };

  // A plain box's `{placeholders}` travel as numbered markers and come back byte for byte
  // (`domain/placeholders.ts`): the participant message's `{participantName}` stays one.
  const tokens = new Map<number, string[]>();
  const pieces: Piece[] = items.flatMap((item, index) => {
    if (item.kind === "rich") return richTextSegments(item.doc).map((segment) => ({ item: index, segment }));
    if (item.text.trim() === "") return [];
    const guarded = protectPlaceholders(item.text);
    tokens.set(index, guarded.tokens);
    return [{ item: index, segment: { format: "text" as const, text: guarded.text } }];
  });
  if (pieces.length === 0) return { ok: false, reason: "nothing" };
  const characters = pieces.reduce((sum, piece) => sum + segmentCharacters(piece.segment), 0);

  const throttle = await consumeRateLimit(db, "content-translate", actor.id, deps.now);
  if (!throttle.allowed) return { ok: false, reason: "rateLimited" };

  const [{ budget }, usedToday] = await Promise.all([readTranslationBudget(db), charactersTranslatedToday(db, deps.now)]);
  const verdict = budgetAllows(usedToday, characters, budget);
  if (!verdict.allowed) return { ok: false, reason: "budget", remainingToday: verdict.remaining };

  // Two requests at most — the plain words, and the rich texts' lines as HTML — each in the
  // pieces' own order, so every answer goes back to the place it came from.
  const translated = new Map<Piece, string>();
  const context = glossaryContext();
  const translator = deps.translator;
  /*
    One audit row per press that the provider billed — also when it then failed: a second request
    refused after the first was answered, or an answer that is no longer a storable document. The
    row is the day's meter, so characters the provider counted are counted here too (§NNN, review).
  */
  const audit = (billed: number, outcome: "ok" | TranslatorFailure) =>
    recordAuditEvent(db, {
      actorStaffUserId: actor.id,
      action: "content.translated",
      entityType: "content",
      entityId: null,
      metadata: { fields: items.map((item) => item.field), characters: billed, provider: translator.provider, outcome },
      now: deps.now,
    });
  try {
    for (const format of ["text", "html"] as const) {
      const batch = pieces.filter((piece) => piece.segment.format === format);
      if (batch.length === 0) continue;
      const texts = batch.map((piece) => (piece.segment.format === "html" ? piece.segment.html : piece.segment.text));
      const answers = await translator.translate({ from: "ro", to: "en", format, texts, context });
      batch.forEach((piece, index) => translated.set(piece, answers[index] ?? ""));
    }
  } catch (error) {
    if (!isTranslatorError(error)) throw error;
    const billed = [...translated.keys()].reduce((sum, piece) => sum + segmentCharacters(piece.segment), 0);
    if (billed > 0) await audit(billed, error.failure);
    return { ok: false, reason: error.failure };
  }

  const result: TranslatedItem[] = [];
  for (const [index, item] of items.entries()) {
    const answers = pieces.filter((piece) => piece.item === index).map((piece) => translated.get(piece) ?? "");
    if (item.kind === "text") {
      result.push({ field: item.field, kind: "text", text: restorePlaceholders((answers[0] ?? "").trim(), tokens.get(index) ?? []) });
      continue;
    }
    // The rebuilt document goes through the allowlist once more: what the provider answered
    // must still be a document the site would store.
    const doc = richTextSchema.safeParse(withTranslatedSegments(item.doc, answers));
    if (!doc.success) {
      await audit(characters, "unavailable");
      return { ok: false, reason: "unavailable" };
    }
    result.push({ field: item.field, kind: "rich", doc: doc.data });
  }

  await audit(characters, "ok");

  return { ok: true, items: result, characters, remainingToday: Math.max(0, verdict.remaining - characters) };
}
