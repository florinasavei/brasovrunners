import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  CUSTOM_SITE_TINT,
  DEFAULT_SITE_TINT_SETTING,
  describeSiteTint,
  parseSiteTint,
  SITE_TINT_CHOICES,
  type SiteTintSetting,
  siteTintSchema,
} from "./domain/site-tint";
import { judgeTint } from "./domain/tint-contrast";

/**
 * «Aspectul site-ului» (§NNN): one `platform_settings` row, written by an Administrator under
 * Pagini → «Aspect», audited, read by the locale layout through the public cache (§333).
 * No migration: the settings table takes any key (§100).
 */

export const SITE_TINT_SETTING_KEY = "siteTint";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e00a` is the shown contact address). */
export const SITE_TINT_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00d";

export type SiteTintState = { setting: SiteTintSetting; updatedAt: Date | null };

/**
 * The markers a refused «Personalizat» colour carries beside its box's name, so the action can say
 * which rule it broke in words rather than "check what you entered" (the `UNDER_MINIMUM_AGE`
 * pattern, §321). Markers, not boxes: the action drops them from the field list.
 */
export const SITE_TINT_REFUSAL = { unreadable: "tintUnreadable", tooDark: "tintTooDark" } as const;

/** The tint in force: the default with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readSiteTint<T extends Record<string, unknown>>(db: Database<T>): Promise<SiteTintState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, SITE_TINT_SETTING_KEY))
    .limit(1);
  if (!row) return { setting: DEFAULT_SITE_TINT_SETTING, updatedAt: null };
  return { setting: parseSiteTint(row.value), updatedAt: row.updatedAt };
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
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as { tint?: unknown; hex?: unknown }) : {};
  if (typeof raw.tint !== "string" || !(SITE_TINT_CHOICES as readonly string[]).includes(raw.tint)) {
    throw new DomainError("VALIDATION_ERROR", `tint: not one of the choices (${String(raw.tint)})`, ["tint"]);
  }
  let candidate: unknown = { tint: raw.tint };
  if (raw.tint === CUSTOM_SITE_TINT) {
    // Typed by hand: spaces around it and a missing "#" are forgiven, nothing else.
    const typed = typeof raw.hex === "string" ? raw.hex.trim() : "";
    const hex = typed.startsWith("#") ? typed : `#${typed}`;
    const verdict = judgeTint(hex);
    if (verdict === "notAColour") {
      throw new DomainError("VALIDATION_ERROR", "hex: not a #rrggbb colour", ["hex"]);
    }
    if (verdict !== null) {
      throw new DomainError("VALIDATION_ERROR", `hex: ${verdict} as a page colour`, ["hex", SITE_TINT_REFUSAL[verdict]]);
    }
    candidate = { tint: CUSTOM_SITE_TINT, hex };
  }
  const parsed = siteTintSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "tint: not a setting this code can store", ["tint"]);
  }
  const next: SiteTintSetting = parsed.data;

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
      metadata: { from: describeSiteTint(before.setting), to: describeSiteTint(next) },
      now,
    });
  });
  // Every public page reads the tint from the public cache (§333).
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
