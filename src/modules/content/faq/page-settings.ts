import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Întrebări frecvente» as a page (§NNN): whether it is on the site at all — «Echipa»'s first gate
 * (§459), one `platform_settings` row. DRAFT until an Administrator publishes it, both languages at
 * once (§28); each question keeps its own «Pe site» switch as the second gate.
 *
 * No introduction of the club's: the page's lead is the catalogue's sentence. A row this code
 * cannot read is a DRAFT page — nothing is shown that nobody decided to show.
 */

export const FAQ_PAGE_SETTING_KEY = "faqPage";
/**
 * `audit_logs.entity_id` for this setting, one fixed id per key, never reused (§164's rule). Taken
 * well away from the `…e00a`–`…e011` run the sibling settings count up through, so a sibling
 * branch's next setting cannot land on it.
 */
export const FAQ_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0fa";

export type FaqPageStatus = "DRAFT" | "PUBLISHED";
export type FaqPageSettings = { status: FaqPageStatus };

export const DEFAULT_FAQ_PAGE: FaqPageSettings = { status: "DRAFT" };

const storedSchema = z.object({ status: z.enum(["DRAFT", "PUBLISHED"]) });

type Actor = Pick<StaffUser, "id" | "role">;

export async function readFaqPageSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<FaqPageSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, FAQ_PAGE_SETTING_KEY)).limit(1);
  if (!row) return DEFAULT_FAQ_PAGE;
  const parsed = storedSchema.safeParse(row.value);
  return parsed.success ? { status: parsed.data.status } : DEFAULT_FAQ_PAGE;
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
  const before = await readFaqPageSettings(db);
  const next: FaqPageSettings = { status: input.published ? "PUBLISHED" : "DRAFT" };
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: FAQ_PAGE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: input.actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: input.actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.published ? "faq_page.published" : "faq_page.unpublished",
      entityType: "platform_setting",
      entityId: FAQ_PAGE_SETTING_ENTITY_ID,
      metadata: { from: before.status, to: next.status },
      now,
    });
  });
  // The page, the header's entry and the sitemap read the page's state from the public cache under
  // `pages` (§333), as «Echipa»'s do.
  revalidatePublicContent("pages");
  return next;
}
