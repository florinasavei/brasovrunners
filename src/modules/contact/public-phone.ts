import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_PUBLIC_PHONE, type PublicPhone, publicPhoneSchema } from "./domain/public-phone";

/**
 * «Telefon public» (§NNN): the shown contact address's shape (§442) — one `platform_settings` row
 * (the table is a key-value store, so no migration), written by an Administrator on «Pagini» →
 * «Contact», audited, read by the footer's «Contact» column through the public cache.
 */

export const PUBLIC_PHONE_SETTING_KEY = "publicPhone";
/** The audit row's fixed entity id for this key — one per key, never reused (§483). */
export const PUBLIC_PHONE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0b1";

export type PublicPhoneState = PublicPhone & { updatedAt: Date | null };

/** The number in force; no row, or a value this code can no longer read, is no number. */
export async function readPublicPhone<T extends Record<string, unknown>>(db: Database<T>): Promise<PublicPhoneState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, PUBLIC_PHONE_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_PUBLIC_PHONE, updatedAt: null };
  const parsed = publicPhoneSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, updatedAt: row.updatedAt } : { ...DEFAULT_PUBLIC_PHONE, updatedAt: row.updatedAt };
}

/**
 * Saves the number, or clears it when the box is empty. Administrator only (`canManageClubSettings`,
 * the contact settings' gate), asserted here as well as in the action.
 */
export async function updatePublicPhone<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<PublicPhoneState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the public phone`);
  }
  const phone = rawInput && typeof rawInput === "object" ? (rawInput as { phone?: unknown }).phone : undefined;
  const parsed = publicPhoneSchema.safeParse({ phone: typeof phone === "string" ? phone : null });
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readPublicPhone(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: PUBLIC_PHONE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "public_phone.changed",
      entityType: "platform_setting",
      entityId: PUBLIC_PHONE_SETTING_ENTITY_ID,
      // Whether a number was shown before and after, never the number: an audit row is read by
      // more people than the setting (§483 names settings by id; the value is on the screen).
      metadata: { from: { set: before.phone !== null }, to: { set: next.phone !== null } },
      now,
    });
  });
  // The footer reads the number from the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}
