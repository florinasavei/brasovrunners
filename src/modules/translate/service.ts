import { z } from "zod";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { isTranslatorError, type Translator, type TranslatorFailure } from "@/infrastructure/translate/adapter";
import { recordAuditEvent } from "@/modules/audit/repository";
import { type RichTextDoc, richTextSchema } from "@/modules/content/rich-text/domain/schema";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { canTranslateTexts } from "@/modules/staff-identity/domain/roles";
import { charactersTranslatedToday, readTranslationBudget } from "./budget";
import { budgetAllows, charactersToSend } from "./domain/budget";
import { creditAllows, type TranslationCredit } from "./domain/credit";
import { isRichTextField, isTranslatableEnglishField } from "./domain/fields";
import { glossaryContext } from "./domain/glossary";
import { protectPlaceholders, restorePlaceholders } from "./domain/placeholders";
import { type RichTextSegment, richTextSegments, segmentCharacters, withTranslatedSegments } from "./domain/rich-text-html";

/**
 * «Tradu din română» (`DECISIONS.md` §464). It fills, never saves: the browser puts the answer in
 * the English boxes as a draft and the ordinary save applies every rule (§352).
 *
 * Checks, each a refusal in words: role (BR-REQ-060-01), a translator, allowlisted fields only
 * (`domain/fields.ts`), something to translate, the throttle, the daily budget, DeepL's credit
 * (§497), then the provider. One audit row per billed press — never the words.
 */

const MAX_ITEMS = 150;
/** Bounds a crafted request; real texts are far under it. */
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
  | "credit"
  | TranslatorFailure;

export type TranslateOutcome =
  | { ok: true; items: TranslatedItem[]; characters: number; remainingToday: number }
  | { ok: false; reason: TranslateRefusal; remainingToday?: number; remainingCredit?: number };

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
      // The same allowlist a save uses (§11.3).
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
  deps: {
    translator: Translator | null;
    now: Date;
    /** `readTranslationCredit` (§497); null when unread — the press goes on and DeepL's 456 answers. */
    credit?: () => Promise<TranslationCredit | null>;
  },
): Promise<TranslateOutcome> {
  if (!canTranslateTexts(actor.role)) return { ok: false, reason: "forbidden" };
  if (!deps.translator) return { ok: false, reason: "notConfigured" };

  const items = prepare(raw);
  if (!items) return { ok: false, reason: "invalid" };

  const tokens = new Map<number, string[]>();
  const pieces: Piece[] = items.flatMap((item, index) => {
    if (item.kind === "rich") return richTextSegments(item.doc).map((segment) => ({ item: index, segment }));
    if (item.text.trim() === "") return [];
    const guarded = protectPlaceholders(item.text);
    tokens.set(index, guarded.tokens);
    return [{ item: index, segment: { format: "text" as const, text: guarded.text } }];
  });
  if (pieces.length === 0) return { ok: false, reason: "nothing" };
  // The same count «Copiază și tradu tot» names before the press (§482).
  const characters = charactersToSend(items);

  const throttle = await consumeRateLimit(db, "content-translate", actor.id, deps.now);
  if (!throttle.allowed) return { ok: false, reason: "rateLimited" };

  const [{ budget }, usedToday] = await Promise.all([readTranslationBudget(db), charactersTranslatedToday(db, deps.now)]);
  const verdict = budgetAllows(usedToday, characters, budget);
  if (!verdict.allowed) return { ok: false, reason: "budget", remainingToday: verdict.remaining };

  // §497: a too-small credit names what is left, so the person translates fewer boxes.
  const credit = deps.credit ? await deps.credit() : null;
  if (credit && !creditAllows(credit, characters)) {
    return credit.level === "spent" ? { ok: false, reason: "quota" } : { ok: false, reason: "credit", remainingCredit: credit.remaining };
  }

  // At most two requests (plain, then HTML), each in the pieces' order.
  const translated = new Map<Piece, string>();
  const context = glossaryContext();
  const translator = deps.translator;
  // The audit row is the day's meter (§464): write it whenever the provider billed, even on a later failure.
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
    // Re-validate: the provider's answer must still be a storable document.
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
