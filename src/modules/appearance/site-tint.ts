import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_SITE_TINT, parseSiteTint, type SiteTint, siteTintSchema } from "./domain/site-tint";

/**
 * «Fundalul site-ului» (§NNN): one `platform_settings` row, written by an Administrator under
 * Pagini → «Aspect», audited, read by the locale layout through the public cache (§333).
 * No migration: the settings table takes any key (§100).
 */

export const SITE_TINT_SETTING_KEY = "siteTint";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e00a` is the shown contact address). */
export const SITE_TINT_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00d";

export type SiteTintState = { tint: SiteTint; updatedAt: Date | null };

/** The tint in force: the default with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readSiteTint<T extends Record<string, unknown>>(db: Database<T>): Promise<SiteTintState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, SITE_TINT_SETTING_KEY))
    .limit(1);
  if (!row) return { tint: DEFAULT_SITE_TINT, updatedAt: null };
  return { tint: parseSiteTint(row.value), updatedAt: row.updatedAt };
}

/**
 * Saves the tint. A club setting (§450): the Administrator's, asserted here as well as at the
 * action. Expires the public cache's settings, so the next page view is drawn in the new colour.
 */
export async function updateSiteTint<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<SiteTintState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the site's background`);
  }
  const tint = rawInput && typeof rawInput === "object" ? (rawInput as { tint?: unknown }).tint : undefined;
  const parsed = siteTintSchema.safeParse({ tint });
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", `tint: not one of the presets (${String(tint)})`, ["tint"]);
  }
  const next = parsed.data;

  const before = await readSiteTint(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SITE_TINT_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "site_tint.changed",
      entityType: "platform_setting",
      entityId: SITE_TINT_SETTING_ENTITY_ID,
      metadata: { from: before.tint, to: next.tint },
      now,
    });
  });
  // Every public page reads the tint from the public cache (§333).
  revalidatePublicContent("settings");
  return { tint: next.tint, updatedAt: now };
}
