import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * **Permissions per person, on top of the role ladder (§687).**
 *
 * The roles nest (`domain/roles.ts`): each one is everything below it plus one thing more, so a
 * capability is a threshold. A grant is the other shape — one named power given to one person
 * whatever their rung — and it exists for the asks the ladder cannot answer: «Gestionează
 * magazinul» (`shop.manage`) for the colleague who runs the members' shop without being an
 * Administrator.
 *
 * One row per person and permission (the primary key: granting twice is one row). The CHECK lists
 * the permissions the code knows, so a row naming anything else cannot exist even if the
 * application is bypassed (BR-REQ-060-01); a later permission widens it in its own expand-only
 * migration. A grant goes with the person (`ON DELETE CASCADE`: withdrawing access leaves nothing
 * behind); who gave it is kept while they are on the team.
 *
 * The row grants nothing by itself: the predicates in `domain/roles.ts` read it only for a role
 * that may hold it (`canHoldPermission`) — never for a club member, who is no staff (§524).
 */
export const staffUserPermissions = pgTable(
  "staff_user_permissions",
  {
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    grantedByStaffUserId: uuid("granted_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.staffUserId, t.permission] }),
    check("staff_user_permissions_permission_known", sql`${t.permission} IN ('shop.manage')`),
  ],
);

export type StaffUserPermissionRow = typeof staffUserPermissions.$inferSelect;
