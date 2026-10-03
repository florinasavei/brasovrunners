import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The stretches during which the platform could not be reached (§NNN, «the clock stops while the door
 * is shut»): the site's name did not resolve, or no scheduler call reached the platform for longer than
 * the pinger's own threshold. While a `dns` window is open its running deadlines are moved on every
 * real run by the time since the last one; once a window is over, every participant deadline that was
 * running in it has been moved later by its length, capped by the club's «Termene» number
 * (`outageGraceMaxHours`) — the grace for the outage.
 *
 * One row per stretch, written by the maintenance job alone (`registrations/outage-grace.ts`). Ids,
 * instants and counts only: no name, no address, nothing about a person. The moves themselves are in
 * the audit trail of each registration and event they touched.
 */
export const UNREACHABLE_SOURCES = ["dns", "pings"] as const;
export type UnreachableSource = (typeof UNREACHABLE_SOURCES)[number];

/** A claim the outage grace did not revive because its counted place was no longer free (§NNN). */
export type NotRevivedClaim = { kind: "offer" | "familyReservation" | "invitation" | "placeHold"; id: string; eventId: string };

export const unreachableWindows = pgTable(
  "unreachable_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * How it was seen: `dns` — the job, reached by another address, found the site's public name not
     * resolving on two probes at least ten minutes apart; `pings` — no scheduler call arrived for longer
     * than the pinger's threshold.
     */
    source: text("source").notNull().$type<UnreachableSource>(),
    /** The first instant it was unreachable: the first failed probe of the name, or the pinger's missed call. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** The instant it could be reached again; null while it is open (or while a `dns` row is only suspected). */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * When the window was confirmed. A `pings` row is confirmed when it is written; a `dns` row is
     * written at the first probe that finds no such name with this null — a suspicion that holds
     * nothing, tells nobody and is shown nowhere — and confirmed by a second such probe at least ten
     * minutes later. A probe that resolves in between deletes it.
     */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /**
     * The time given back to the deadlines, in milliseconds: the window's length capped by «Termene»,
     * never lowered once given. A `pings` window decides it when it is written; a `dns` window grows it
     * on every real run while it is open — by the time since the last run, within the cap — so a running
     * deadline never reads as lapsed while the name is gone, and decides the rest when it closes. A
     * retried run moves by what is stored, whatever the setting says by then. 0 when the club has
     * switched the moving off.
     */
    grantedMs: bigint("granted_ms", { mode: "number" }).notNull().default(0),
    /** How much of `granted_ms` the moves have applied: every deadline running after `started_at + applied_ms` has been moved by it. */
    appliedMs: bigint("applied_ms", { mode: "number" }).notNull().default(0),
    /** The step in progress, `applied_ms` → this; null when none. A retried run finishes it by the same amount before another starts. */
    stepMs: bigint("step_ms", { mode: "number" }),
    /** How many deadlines were moved, each counted once however many steps moved it (`moved_keys`). */
    rowsMoved: integer("rows_moved").notNull().default(0),
    /** The deadlines moved, as kind and id (`r:<id>:hold`, `r:<id>:link`, `i:<id>`, `p:<id>`, `f:<id>`, `s:<id>`): ids only, so each is counted once. */
    movedKeys: jsonb("moved_keys").notNull().$type<string[]>().default([]),
    /**
     * How many claims it did not revive: an offer, a family's reservation or held place, or an
     * invitation that lapsed while the door was shut and whose counted place was given meanwhile. The
     * job seats nobody (§NNN): they lapse as they would have, and an Administrator decides.
     */
    claimsNotRevived: integer("claims_not_revived").notNull().default(0),
    /** Those claims, by kind, id and event — ids only: the email names them at its send, «Sarcini» reads whether they still wait. */
    notRevived: jsonb("not_revived").notNull().$type<NotRevivedClaim[]>().default([]),
    /** The step's event-blind deadlines (address links, a family's links, their tokens) moved, in their own transaction. */
    linksMovedAt: timestamp("links_moved_at", { withTimezone: true }),
    /** The events whose holds, offers and invitations the step moved, each in its own locked transaction: a retried run skips them. */
    eventsMoved: jsonb("events_moved").notNull().$type<string[]>().default([]),
    /** When `applied_ms` last caught up with `granted_ms`: null while there is something left to move (or, closed, to announce). */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** When the Administrators were told it opened (a `dns` window only: a `pings` one is seen once it is over). */
    openedAnnouncedAt: timestamp("opened_announced_at", { withTimezone: true }),
    /** When the Administrators were told it closed and what it moved. */
    closedAnnouncedAt: timestamp("closed_announced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one window open (or suspected) at a time: a second run that finds the name gone again keeps the first.
    uniqueIndex("unreachable_windows_one_open").on(sql`(${t.endedAt} is null)`).where(sql`${t.endedAt} is null`),
    /*
      A silence of the pings is recorded once (§NNN): two maintenance runs at the same moment (the
      backstop and the monitor landing together after a silence) read the same silence, and the second
      insert is refused here rather than moving every deadline twice.
    */
    uniqueIndex("unreachable_windows_pings_once").on(t.source, t.startedAt).where(sql`${t.source} = 'pings'`),
    index("unreachable_windows_started_at_idx").on(t.startedAt),
    check("unreachable_windows_source_known", sql`${t.source} in ('dns', 'pings')`),
    check("unreachable_windows_ends_after_start", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    // A `pings` window is over when it is seen; only a `dns` one is ever suspected.
    check("unreachable_windows_pings_confirmed", sql`${t.source} = 'dns' or ${t.confirmedAt} is not null`),
    check("unreachable_windows_counts_non_negative", sql`${t.grantedMs} >= 0 and ${t.rowsMoved} >= 0 and ${t.claimsNotRevived} >= 0`),
    // What is applied, or being applied, never exceeds what is given back.
    check("unreachable_windows_applied_within_granted", sql`${t.appliedMs} >= 0 and ${t.appliedMs} <= ${t.grantedMs} and (${t.stepMs} is null or (${t.stepMs} >= ${t.appliedMs} and ${t.stepMs} <= ${t.grantedMs}))`),
  ],
);

export type UnreachableWindow = typeof unreachableWindows.$inferSelect;
