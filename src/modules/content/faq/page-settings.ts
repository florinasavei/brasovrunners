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
 * «Întrebări frecvente» as a page (§525): one `platform_settings` row shaped like «Echipa» (§459)
 * holding the DRAFT/PUBLISHED state (§28), the introduction (both languages or neither, §352) and
 * the page's `version`. Every save bumps the version and a stale one is a CONFLICT (AGENTS.md
 * §11.5); publishing does not bump it. An unreadable row reads as a DRAFT with no introduction.
 */

export const FAQ_PAGE_SETTING_KEY = "faqPage";
/** `audit_logs.entity_id` for this setting, fixed and never reused (§164); far from the …e00a–…e011 run. */
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

/** An unreadable row reads as the default. */
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

/** The introduction in this language, or nulls unless both sides are written (§352, §354). */
export function faqIntroFor(locale: string, settings: FaqPageSettings): { doc: RichTextDoc | null; text: string | null } {
  const docs = faqIntroDocs(settings);
  if (!docs.ro || !docs.en) return { doc: null, text: null };
  const doc = locale === "en" ? docs.en : docs.ro;
  const text = richTextToPlainText(doc).replace(/\s+/g, " ").trim();
  return { doc, text: text === "" ? null : text };
}

/** Publish or unpublish the page in both languages — the Administrator's (§201). */
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
    // Publishing changes neither the words nor the version.
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
  // The page's state is read from the public cache under `pages` (§333).
  revalidatePublicContent("pages");
  return next;
}
