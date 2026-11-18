import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { mediaAssets } from "./gallery";

/**
 * «Poze și hărți» of «Planul voluntarilor» (§978, amending §952; the owner, 2026-11-18: «Poza planului trebuie sa fie mai sus,
 * si sa pot pune mai multe poze, si link-uri, am facut spre exemplu un google maps custom map si vreau sa pot pune url-ul»):
 * the plan as the organizers drew it — several stored pictures and several addresses (a Google My Maps map, for instance) —,
 * kept with the plan of one event. Written and read by whoever works the volunteers (`canManageVolunteers`), in
 * `volunteers/plan.ts` alone; sent on by one email at an organizer's press («Trimite fiecăruia punctul lui», §956).
 *
 * The organizers' own and one edition's: no public query, cache or page reads these tables, and neither a series' later
 * dates, a repeat, a copy, the event's file nor an import carries them — this date's plan, and a file read on another
 * environment would name another bucket's objects. Deleting the event deletes its rows (`ON DELETE CASCADE`).
 *
 * This file imports `events.ts` and `gallery.ts`; neither imports it, so the foreign keys the column of §952 could not have
 * (the events' plan picture column, no longer written: the contract that drops it is a later release) are here.
 */

/** The most pictures one plan holds (§978): a map or two, a detail of the start, the parking — never an album. */
export const PLAN_PICTURES_MAX = 12;
/** The most links one plan holds (§978). */
export const PLAN_LINKS_MAX = 12;
/** The longest address a link may be, in characters: a Google My Maps link is some eighty; a long one with its query, a few hundred. */
export const PLAN_LINK_URL_MAX = 2000;
/** The longest label of a link, in characters: a line, «Harta voluntarilor (Google My Maps)». */
export const PLAN_LINK_LABEL_MAX = 120;

/**
 * One picture of the plan: a stored picture (`media_assets`, §66), in the plan's order. One stored picture is on one plan
 * once; another plan may carry it too. `media/references.ts` counts the table, so neither the sweep nor the pictures page's
 * delete takes a picture a plan uses; a stored picture deleted all the same takes its rows with it (as a gallery item).
 */
export const eventVolunteerPlanPictures = pgTable(
  "event_volunteer_plan_pictures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    /** One-based; a new picture goes last (the greatest plus one). There is no reordering: removed and added again, it goes last. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("event_volunteer_plan_pictures_event_asset_unique").on(t.eventId, t.mediaAssetId),
    check("event_volunteer_plan_pictures_position_positive", sql`${t.position} >= 1`),
    index("event_volunteer_plan_pictures_event_position_idx").on(t.eventId, t.position),
  ],
);

/**
 * One link of the plan: an `http:` or `https:` address (the service refuses every other kind) and an optional label, one for
 * both languages as a plan point's name is. Opened in a new tab; never embedded — an iframe would need the content-security
 * policy opened to the map's host.
 */
export const eventVolunteerPlanLinks = pgTable(
  "event_volunteer_plan_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label"),
    /** One-based; a new link goes last. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("event_volunteer_plan_links_url_length", sql`char_length(${t.url}) <= ${sql.raw(String(PLAN_LINK_URL_MAX))}`),
    check("event_volunteer_plan_links_label_length", sql`${t.label} IS NULL OR char_length(${t.label}) <= ${sql.raw(String(PLAN_LINK_LABEL_MAX))}`),
    check("event_volunteer_plan_links_position_positive", sql`${t.position} >= 1`),
    index("event_volunteer_plan_links_event_position_idx").on(t.eventId, t.position),
  ],
);

export type EventVolunteerPlanPicture = typeof eventVolunteerPlanPictures.$inferSelect;
export type EventVolunteerPlanLink = typeof eventVolunteerPlanLinks.$inferSelect;
