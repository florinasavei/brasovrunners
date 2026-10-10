import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageShop } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { shopSettingsSchema } from "./fields";

/**
 * The shop's two settings (§683), one `platform_settings` row (a key-value store, no migration):
 * «Cum se plătește» — the club's words for paying outside the site, both languages or neither, shown
 * under every order and in the confirmation email — and «Cine primește comenzile», the address the
 * club's notice of each order goes to, or none (then only the list says it). Written by an
 * Administrator, audited — whether the words and the address are set, never what they say.
 */

export const SHOP_SETTING_KEY = "membersShop";
/** The audit row's fixed entity id for this key — one per key, never reused (§483). */
export const SHOP_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0d5";

export type ShopSettings = { paymentRo: string | null; paymentEn: string | null; ordersTo: string | null };

export const DEFAULT_SHOP_SETTINGS: ShopSettings = { paymentRo: null, paymentEn: null, ordersTo: null };

const storedSchema = z.object({
  paymentRo: z.string().nullable().catch(null),
  paymentEn: z.string().nullable().catch(null),
  ordersTo: z.email().nullable().catch(null),
});

export async function readShopSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<ShopSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, SHOP_SETTING_KEY)).limit(1);
  if (!row) return DEFAULT_SHOP_SETTINGS;
  const parsed = storedSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SHOP_SETTINGS;
}

/** The payment words in one language, or null unless both are written (§352): never the other language's. */
export function paymentWordsFor(settings: ShopSettings, locale: string): string | null {
  if (!settings.paymentRo || !settings.paymentEn) return null;
  return locale === "en" ? settings.paymentEn : settings.paymentRo;
}

export async function saveShopSettings<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Pick<StaffUser, "id" | "role">; fields: unknown; now?: Date },
): Promise<ShopSettings> {
  if (!canManageShop(input.actor.role)) throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change the shop's settings`);
  const parsed = shopSettingsSchema.safeParse(input.fields);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  const value: ShopSettings = parsed.data;
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SHOP_SETTING_KEY, value, updatedAt: now, updatedByStaffUserId: input.actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now, updatedByStaffUserId: input.actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "shop.settings_saved",
      entityType: "platform_setting",
      entityId: SHOP_SETTING_ENTITY_ID,
      metadata: { paymentWords: value.paymentRo !== null, recipient: value.ordersTo !== null },
      now,
    });
  });
  return value;
}
