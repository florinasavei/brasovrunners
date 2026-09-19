import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * Settings an Administrator changes from the backoffice (`DECISIONS.md` §100).
 *
 * One row per key, the value as JSON, validated by the module that owns the key — the table
 * knows nothing about what a value means. The first key is `emailPlan`: which Mailgun plan
 * the club is on, which is what "how much can we still send today" is computed from, and
 * which an Administrator flips the day the club pays for a month of Basic before a race and
 * flips back after. A constant in code was the earlier answer (`notifications/volume.ts`);
 * the owner asked for a switch he can throw without a deploy, and this is it.
 *
 * Not for secrets, ever: a value here is read by every page that needs it and shown on the
 * screen that sets it. Keys and API tokens stay in the environment (§14.5).
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, {
    onDelete: "set null",
  }),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
