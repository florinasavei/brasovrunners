import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_SITE_FONT_SIZE_SETTING,
  parseSiteFontSize,
  SITE_FONT_SIZES,
  type SiteFontSizeSetting,
} from "./domain/site-font-size";

/**
 * «Mărimea textului» (§NNN): one `platform_settings` row, written by an Administrator under
 * «Setări» → «Aspect», audited, read by the locale layout through the public cache (§333).
 * No migration: the settings table takes any key (§100).
 */

export const SITE_FONT_SIZE_SETTING_KEY = "siteFontSize";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e011` is the tint). */
export const SITE_FONT_SIZE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e012";

export type SiteFontSizeState = { setting: SiteFontSizeSetting; updatedAt: Date | null };

/** The size in force: the default with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readSiteFontSize<T extends Record<string, unknown>>(db: Database<T>): Promise<SiteFontSizeState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, SITE_FONT_SIZE_SETTING_KEY))
    .limit(1);
  if (!row) return { setting: DEFAULT_SITE_FONT_SIZE_SETTING, updatedAt: null };
  return { setting: parseSiteFontSize(row.value), updatedAt: row.updatedAt };
}

/**
 * Saves the size. A club setting (§450): the Administrator's, asserted here as well as at the
 * action. Expires the public cache's settings, so the next page view is drawn at the new size.
 */
export async function updateSiteFontSize<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<SiteFontSizeState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the site's text size`);
  }
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as { size?: unknown }) : {};
  if (typeof raw.size !== "string" || !(SITE_FONT_SIZES as readonly string[]).includes(raw.size)) {
    throw new DomainError("VALIDATION_ERROR", `size: not one of the choices (${String(raw.size)})`, ["size"]);
  }
  const next = parseSiteFontSize({ size: raw.size });

  const before = await readSiteFontSize(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SITE_FONT_SIZE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "site_font_size.changed",
      entityType: "platform_setting",
      entityId: SITE_FONT_SIZE_SETTING_ENTITY_ID,
      metadata: { from: before.setting.size, to: next.size },
      now,
    });
  });
  // Every public page reads the size from the public cache (§333).
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
