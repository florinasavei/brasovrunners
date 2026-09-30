import { asc, eq } from "drizzle-orm";
import { pages } from "@/db/schema/pages";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type MenuKey, parseStoredMenuOrder, resolveMenuOrder } from "./order";

/**
 * «Ordinea meniului» (§571): the site menu's one order, one `platform_settings` row — a JSON list
 * of keys, first to last. No migration: the settings table takes any key (§100). Written by an
 * Administrator on «Pagini» → «Paginile clubului», audited, read by the header and the footer
 * through the public cache (§333), which a save expires (`settings`).
 */

export const MENU_ORDER_SETTING_KEY = "menuOrder";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e012` is the text size). */
export const MENU_ORDER_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e013";

export type MenuOrderState = { stored: string[]; updatedAt: Date | null };

/** The stored list as it is, or the empty list with no row: the merge rule (`order.ts`) does the rest. */
export async function readMenuOrder<T extends Record<string, unknown>>(db: Database<T>): Promise<MenuOrderState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, MENU_ORDER_SETTING_KEY)).limit(1);
  if (!row) return { stored: [], updatedAt: null };
  return { stored: parseStoredMenuOrder(row.value), updatedAt: row.updatedAt };
}

/**
 * Every custom page's id, in the old «Ordinea» column's order — the fallback for a page the stored
 * list does not name yet (§406's `nav_order`, then the date it was written).
 */
export async function customPageIdsInFallbackOrder<T extends Record<string, unknown>>(db: Database<T>): Promise<string[]> {
  const rows = await db.select({ id: pages.id }).from(pages).orderBy(asc(pages.navOrder), asc(pages.createdAt), asc(pages.id));
  return rows.map((row) => row.id);
}

/** The whole order today: every section and every custom page, published or not. */
export async function resolvedMenuOrder<T extends Record<string, unknown>>(db: Database<T>): Promise<MenuKey[]> {
  const [{ stored }, pageIds] = await Promise.all([readMenuOrder(db), customPageIdsInFallbackOrder(db)]);
  return resolveMenuOrder(stored, pageIds);
}

/**
 * Saves the order «Salvează» posted: the keys first to last. A club setting (§450) — the
 * Administrator's, asserted here as well as at the action; an Organizer is refused.
 *
 * What is stored is the whole list, resolved against what exists now: a key the form did not send
 * (a page written meanwhile) takes its place at the end, a key for a page deleted meanwhile is
 * dropped, a duplicate counts once. Anything that is not a key at all is a refusal — the form only
 * ever sends keys, so that is a forged post, not a slip.
 */
export async function saveMenuOrder<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawOrder: unknown,
  now: Date,
): Promise<MenuOrderState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the menu's order`);
  }
  const posted =
    typeof rawOrder === "string" ? rawOrder.split(",").map((key) => key.trim()).filter(Boolean) : Array.isArray(rawOrder) ? rawOrder : null;
  if (!posted || posted.some((key) => typeof key !== "string" || !/^(?:[a-z]+|page:[0-9a-f-]{36})$/.test(key))) {
    throw new DomainError("VALIDATION_ERROR", "order: not a list of menu entries", ["order"]);
  }

  const before = await readMenuOrder(db);
  const next = resolveMenuOrder(parseStoredMenuOrder(posted), await customPageIdsInFallbackOrder(db));
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: MENU_ORDER_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "menu_order.changed",
      entityType: "platform_setting",
      entityId: MENU_ORDER_SETTING_ENTITY_ID,
      metadata: { from: before.stored, to: next },
      now,
    });
  });
  // The header and the footer read the order from the public cache, filed under `settings` (§333, §549).
  revalidatePublicContent("settings");
  return { stored: next, updatedAt: now };
}
