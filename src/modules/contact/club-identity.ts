import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type ClubIdentityShown, clubIdentityShownSchema, DEFAULT_CLUB_IDENTITY_SHOWN } from "./domain/club-identity";

/**
 * «Ce arată site-ul despre asociație» (§890): «Telefon public»'s shape (§565) — one
 * `platform_settings` row (a key-value store, so no migration) holding the ticks and the seat as
 * the site prints it, written by an Administrator on «Pagini» → «Contact», audited, read by
 * `ClubIdentity` through the public cache.
 */

export const CLUB_IDENTITY_SETTING_KEY = "clubIdentity";
/** The audit row's fixed entity id for this key — one per key, never reused (§483). */
export const CLUB_IDENTITY_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0b2";

export type ClubIdentityState = ClubIdentityShown & { updatedAt: Date | null };

/** The choice in force; no row, or a value this code can no longer read, is the default. */
export async function readClubIdentityShown<T extends Record<string, unknown>>(db: Database<T>): Promise<ClubIdentityState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, CLUB_IDENTITY_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_CLUB_IDENTITY_SHOWN, updatedAt: null };
  const parsed = clubIdentityShownSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, updatedAt: row.updatedAt } : { ...DEFAULT_CLUB_IDENTITY_SHOWN, updatedAt: row.updatedAt };
}

/** Saves the ticks. Administrator only (`canManageClubSettings`), asserted here as well as in the action. */
export async function updateClubIdentityShown<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<ClubIdentityState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change what the site shows about the association`);
  }
  const parsed = clubIdentityShownSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readClubIdentityShown(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: CLUB_IDENTITY_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "club_identity.changed",
      entityType: "platform_setting",
      entityId: CLUB_IDENTITY_SETTING_ENTITY_ID,
      // The ticks, and whether a seat was typed before and after — never the address (the phone's rule, §565).
      metadata: {
        from: { name: before.name, seat: before.seat, email: before.email, seatAddress: { set: before.seatAddress !== null } },
        to: { name: next.name, seat: next.seat, email: next.email, seatAddress: { set: next.seatAddress !== null } },
      },
      now,
    });
  });
  // `ClubIdentity` reads the ticks from the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}
