import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The stretches during which the door was shut (§NNN): the site's name did not resolve, or no
 * scheduler call reached the platform for longer than the pinger's own threshold. While one is
 * open, the maintenance job lapses nothing; once it is over, every participant deadline that was
 * running in it is moved later by its length, capped by the club's «Termene» number
 * (`doorShutMaxHours`) — the clock stops while the door is shut.
 *
 * One row per stretch, written by the maintenance job alone (`registrations/door-shut.ts`). Ids and
 * instants and counts only: no name, no address, nothing about a person. The moves themselves are in
 * the audit trail of each registration they touched.
 */
export const DOOR_SHUT_SOURCES = ["name", "pings"] as const;
export type DoorShutSource = (typeof DOOR_SHUT_SOURCES)[number];

export const doorShutWindows = pgTable(
  "door_shut_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The first instant the door was shut: the name's first failed answer, or the pinger's missed call. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** The instant it was open again; null while it is still shut. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * How it was seen: `name` — the job, reached by another address, found the site's public name not
     * resolving; `pings` — no scheduler call arrived for longer than the pinger's threshold.
     */
    source: text("source").notNull().$type<DoorShutSource>(),
    /** How long the clock was stopped, in minutes: the window's length, capped by «Termene». Set when it is moved. */
    stoppedMinutes: integer("stopped_minutes"),
    /** The event-blind deadlines (address links, a family's links, the links' tokens) moved, in their own transaction. */
    linksMovedAt: timestamp("links_moved_at", { withTimezone: true }),
    /** The events whose holds, offers and invitations were moved, each in its own locked transaction: a retried run skips them. */
    eventsMoved: jsonb("events_moved").notNull().$type<string[]>().default([]),
    /** Every deadline of the window moved: nothing left to do for it. */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** How many deadlines were moved. */
    movedCount: integer("moved_count").notNull().default(0),
    /** How many of them, revived after their place was given meanwhile, were seated outside the places (§642, §643). */
    outsideCount: integer("outside_count").notNull().default(0),
    /** When the Administrators were told the door is shut (only a `name` window: a `pings` one is seen once it is over). */
    openedNoticeAt: timestamp("opened_notice_at", { withTimezone: true }),
    /** When the Administrators were told what the window moved. */
    closedNoticeAt: timestamp("closed_notice_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one window open at a time: a second run that finds the name gone again keeps the first.
    uniqueIndex("door_shut_windows_one_open").on(sql`(${t.endedAt} is null)`).where(sql`${t.endedAt} is null`),
    index("door_shut_windows_started_at_idx").on(t.startedAt),
    check("door_shut_windows_source_known", sql`${t.source} in ('name', 'pings')`),
    check("door_shut_windows_ends_after_start", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    check("door_shut_windows_counts_non_negative", sql`${t.movedCount} >= 0 and ${t.outsideCount} >= 0`),
  ],
);

export type DoorShutWindow = typeof doorShutWindows.$inferSelect;
