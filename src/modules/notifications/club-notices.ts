import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type ClubNotices, clubNoticesSchema, DEFAULT_CLUB_NOTICES } from "./domain/club-notices";

/**
 * The club's own copies, as the club sets them (`DECISIONS.md` §244, §245).
 *
 * The shape §100 and §164 already established: one `platform_settings` row, read by whatever
 * needs it, written by an Administrator on `/admin/emails`, with an audit row naming who
 * changed it and from what. Addresses, never a credential — the Mailgun key stays in the
 * environment (`db/schema/platform-settings.ts`, `AGENTS.md` §14.5).
 *
 * The gate is `canManageRegistrations`, not merely "staff": these lists decide who receives a
 * participant's signed declaration, which is the most sensitive document this platform holds
 * (§15.11). The action asserts the role at the door and this asserts it again.
 */

export const CLUB_NOTICES_SETTING_KEY = "clubNotices";
/**
 * `audit_logs.entity_id` is a UUID and a setting has a key, so each setting names itself by a
 * fixed id of its own: `…e001` is the email plan, `…e002` the contact recipients, this is the third.
 */
export const CLUB_NOTICES_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e003";

export type ClubNoticesState = ClubNotices & { updatedAt: Date | null };

export async function readClubNotices<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<ClubNoticesState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, CLUB_NOTICES_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_CLUB_NOTICES, updatedAt: null };
  /*
    A stored value this code can no longer read falls back to "nobody named", which sends the
    declaration copy on to `DECLARATIONS_ARCHIVE_TO` and sends no confirmation notice at all —
    the behaviour of the day before this setting existed. The alternative, throwing, would take
    the confirmation transaction down with it, and a club mailbox is not worth a lost place.
  */
  const parsed = clubNoticesSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_CLUB_NOTICES, updatedAt: row.updatedAt };
}

export async function updateClubNotices<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<ClubNoticesState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change who receives the club's copies`);
  }
  const parsed = clubNoticesSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readClubNotices(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: CLUB_NOTICES_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "club_notices.changed",
      entityType: "platform_setting",
      entityId: CLUB_NOTICES_SETTING_ENTITY_ID,
      // Who was added or removed from a list that receives declarations is exactly what an
      // audit trail is for; the addresses are the club's own mailboxes, not a participant's.
      metadata: {
        from: { declarations: before.declarations, confirmations: before.confirmations },
        to: { declarations: next.declarations, confirmations: next.confirmations },
      },
      now,
    });
  });
  return { ...next, updatedAt: now };
}
