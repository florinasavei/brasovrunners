import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { participants } from "./participants";
import { staffUsers } from "./staff-users";

/**
 * The trail of what staff did to somebody's registration (AGENTS.md §12.12; BR-REQ-037-03
 * criterion 3, BR-REQ-037-05).
 *
 * Insert-only. Nothing in the application updates or deletes a row here, and nothing should:
 * the point of the table is to answer "who changed this, and when" months later, about an
 * event that has already happened, to a person who is asking why their place went away.
 *
 * What must never be written into `metadata_json` (§12.12, repeated here because this is the
 * file somebody will be looking at when they add a field): an email body, a raw token, the
 * declaration text, or anything resembling a participant export. Metadata is the shape of the
 * change — a status, a name before and after, a reason an organizer typed — not a copy of the
 * data the change was about.
 *
 * `actor_staff_user_id` and `participant_id` are both nullable and both `ON DELETE SET NULL`:
 * a staff account that is later removed must not take the record of what it did with it, and
 * the row keeps saying that *something* was done even when it can no longer say by whom.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    actorStaffUserId: uuid("actor_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),

    /** What happened, as a stable token: `registration.created`, `registration.name_corrected`. */
    action: text("action").notNull(),
    /** The kind of thing it happened to — `registration` today, and only that. */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),

    metadataJson: jsonb("metadata_json").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Everything that happened to this registration, in order" — the only question the
    // backoffice asks of this table.
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorStaffUserId, t.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
