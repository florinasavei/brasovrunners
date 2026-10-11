import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_SITE_LOOK_SETTING, describeSiteLook, parseSiteLook, type SiteLookSetting } from "./domain/site-look";

/**
 * «Aspectul nou» (§NNN): one `platform_settings` row, written by an Administrator under «Setări» →
 * «Aspect», audited, read by the locale layout and the header through the public cache (§333).
 * No migration: the settings table takes any key (§100).
 */

export const SITE_LOOK_SETTING_KEY = "siteLook";
/**
 * The audit row's fixed entity id for this key — one per key, never reused (`…e011` is the tint,
 * `…e012` the text size). `…e01a` rather than the next in line, so a sibling branch that takes the
 * next one for a setting of its own cannot land on the same id.
 */
export const SITE_LOOK_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e01a";

export type SiteLookState = { setting: SiteLookSetting; updatedAt: Date | null };

/** The look in force: off with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readSiteLook<T extends Record<string, unknown>>(db: Database<T>): Promise<SiteLookState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, SITE_LOOK_SETTING_KEY)).limit(1);
  if (!row) return { setting: DEFAULT_SITE_LOOK_SETTING, updatedAt: null };
  return { setting: parseSiteLook(row.value), updatedAt: row.updatedAt };
}

/** What the form sends: the radio's value, `on` or `off`. Anything else is refused. */
const CHOICES: Record<string, boolean> = { on: true, off: false };

/**
 * Switches the look on or off. A club setting (§450): the Administrator's, asserted here as well as
 * at the action. Expires the public cache's settings — every static public page is made again at its
 * next visit, in the look now in force (§549).
 */
export async function updateSiteLook<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<SiteLookState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the site's look`);
  }
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as { look?: unknown }) : {};
  if (typeof raw.look !== "string" || !Object.hasOwn(CHOICES, raw.look)) {
    throw new DomainError("VALIDATION_ERROR", `look: not one of the choices (${String(raw.look)})`, ["look"]);
  }
  const next: SiteLookSetting = { on: CHOICES[raw.look] };

  const before = await readSiteLook(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SITE_LOOK_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "site_look.changed",
      entityType: "platform_setting",
      entityId: SITE_LOOK_SETTING_ENTITY_ID,
      metadata: { from: describeSiteLook(before.setting), to: describeSiteLook(next) },
      now,
    });
  });
  // Every public page reads the look from the public cache (§333); the static ones are made again.
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
