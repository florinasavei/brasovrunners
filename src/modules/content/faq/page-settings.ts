import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { type RichTextDoc, richTextSchema, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { storedTeamDoc } from "@/modules/content/team/fields";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Întrebări frecvente» as a page (§NNN): whether it is on the site at all, the club's own
 * introduction, and the page's version — one `platform_settings` row, «Echipa»'s shape (§459).
 *
 * `status` is DRAFT until an Administrator publishes it, both languages at once (§28); each
 * question keeps its own «Pe site» switch as the second gate. The introduction is the club's text
 * in the rich-text editor, Romanian **and** English or neither (§352); with none, the page reads
 * the catalogue's sentence. `version` guards the page's one save (AGENTS.md §11.5): every save
 * of the introduction and the questions bumps it, and a save loaded at another version is a
 * CONFLICT, never an overwrite. Publishing leaves it as it is — it changes no words.
 *
 * A row this code cannot read is a DRAFT page with no introduction — nothing is shown that nobody
 * decided to show.
 */

export const FAQ_PAGE_SETTING_KEY = "faqPage";
/**
 * `audit_logs.entity_id` for this setting, one fixed id per key, never reused (§164's rule). Taken
 * well away from the `…e00a`–`…e011` run the sibling settings count up through, so a sibling
 * branch's next setting cannot land on it.
 */
export const FAQ_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0fa";

export type FaqPageStatus = "DRAFT" | "PUBLISHED";
export type FaqPageSettings = {
  status: FaqPageStatus;
  version: number;
  introRo: string | null;
  introEn: string | null;
  introRoJson: RichTextDoc | null;
  introEnJson: RichTextDoc | null;
};

export const DEFAULT_FAQ_PAGE: FaqPageSettings = { status: "DRAFT", version: 1, introRo: null, introEn: null, introRoJson: null, introEnJson: null };

function readStoredDoc(value: unknown): RichTextDoc | null {
  const parsed = richTextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const storedDoc = z
  .unknown()
  .optional()
  .transform((value) => (value === undefined || value === null ? null : readStoredDoc(value)));

const storedSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED"]),
  version: z.number().int().min(1).optional().default(1),
  introRo: z.string().nullable().optional().default(null),
  introEn: z.string().nullable().optional().default(null),
  introRoJson: storedDoc,
  introEnJson: storedDoc,
});

type Actor = Pick<StaffUser, "id" | "role">;

/** The stored value as this code reads it: a row it cannot read is the default. */
export function parseFaqPageSettings(value: unknown): FaqPageSettings {
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_FAQ_PAGE;
}

export async function readFaqPageSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<FaqPageSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, FAQ_PAGE_SETTING_KEY)).limit(1);
  return row ? parseFaqPageSettings(row.value) : DEFAULT_FAQ_PAGE;
}

/** The introduction's two sides as the editor opens them. */
export function faqIntroDocs(settings: FaqPageSettings): { ro: RichTextDoc | null; en: RichTextDoc | null } {
  return { ro: storedTeamDoc(settings.introRoJson, settings.introRo), en: storedTeamDoc(settings.introEnJson, settings.introEn) };
}

/**
 * The introduction in this language — the document, and its words for the page's description —
 * or nulls unless both sides are written (§352, §354).
 */
export function faqIntroFor(locale: string, settings: FaqPageSettings): { doc: RichTextDoc | null; text: string | null } {
  const docs = faqIntroDocs(settings);
  if (!docs.ro || !docs.en) return { doc: null, text: null };
  const doc = locale === "en" ? docs.en : docs.ro;
  const text = richTextToPlainText(doc).replace(/\s+/g, " ").trim();
  return { doc, text: text === "" ? null : text };
}

/** Put the page on the site in both languages, or take it off — the Administrator's (§201). */
export async function setFaqPagePublished<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; published: boolean; now?: Date },
): Promise<FaqPageSettings> {
  if (!canShowFaqItem(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish the FAQ page`);
  }
  const now = input.now ?? new Date();
  const next = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(platformSettings).where(eq(platformSettings.key, FAQ_PAGE_SETTING_KEY)).limit(1).for("update");
    const before = row ? parseFaqPageSettings(row.value) : DEFAULT_FAQ_PAGE;
    // The words and the version as they are: publishing changes neither.
    const value: FaqPageSettings = { ...before, status: input.published ? "PUBLISHED" : "DRAFT" };
    await tx
      .insert(platformSettings)
      .values({ key: FAQ_PAGE_SETTING_KEY, value, updatedAt: now, updatedByStaffUserId: input.actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now, updatedByStaffUserId: input.actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.published ? "faq_page.published" : "faq_page.unpublished",
      entityType: "platform_setting",
      entityId: FAQ_PAGE_SETTING_ENTITY_ID,
      metadata: { from: before.status, to: value.status },
      now,
    });
    return value;
  });
  // The page, the header's entry, the footer's link and the sitemap read the page's state from the
  // public cache under `pages` (§333), as «Echipa»'s do.
  revalidatePublicContent("pages");
  return next;
}
