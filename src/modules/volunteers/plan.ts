import { and, asc, count, eq, max } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import type { StaffUser } from "@/db/schema/staff-users";
import { eventVolunteerPlanLinks, eventVolunteerPlanPictures, PLAN_LINKS_MAX, PLAN_PICTURES_MAX } from "@/db/schema/volunteer-plan";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { isLadderKeyPrefix, ladderWidths, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { listRoleNames, type RoleNameWords } from "./admin-list";
import { planLinkHost, PlanMapsRefusal, readPlanLinkLabel, readPlanLinkUrl } from "./domain/plan-link";
import { listPlanPoints, type PlanPoint } from "./plan-points";
import { listVolunteers, type VolunteerItem } from "./volunteers";

/*
  «Planul voluntarilor» (§949; the owner, 2026-11-16, with a map of the route and its seven points: «e foarte important sa avem
  planul de voluntari si fiecare in ce punct ramane»): who stands where on the day. One event's points, each with the people
  the organizers placed at it (`event_volunteers.checkpoint_id`), and under them everybody still to place.

  The points are of two kinds since §961 (the owner, 2026-11-17: «Practic voluntarii sunt de 2 tipuri: start-finish și pe
  traseu»): the points **at the start–finish** — the desk, the kits, the start and the finish line, with no kilometre and no
  number — and the points **on the route**, in the route's order and numbered as the route meets them. The points on the route
  are the event's «Puncte pe traseu» (§757), which the editor keeps, the page lists and the bib draws, and the ones the
  organizers typed by hand on the plan's page, which are the plan's alone; the points at the start–finish are always the
  plan's own. Which is which, in what order and with what number is `plan-points.ts#listPlanPoints`'s to say: this file reads
  the points from there and nowhere else, so the page, the «Voluntari» list and the email never number a point differently.

  Who is on it: every volunteer of the event who is not cancelled — a cancelled person keeps the point they had, in case they
  come back, and is simply not on the plan. Nothing here is the person's own answer: the plan is the organizers', and no public
  page or badge reads it. One email says a person their own point, and only at an organizer's press: «Trimite fiecăruia punctul
  lui» (§956, `point-mail.ts`). Placing, moving or taking somebody off writes to nobody.

  Read by whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators), asserted here
  (BR-REQ-060-01) as on the «Voluntari» list, whose names and telephone numbers these are; placing somebody is
  `volunteers.ts#changeVolunteer` (`setCheckpoint`), which asks for the role again.
*/

/*
  «Poze și hărți» — the plan's pictures and links (§NNN, amending §952; the owner, 2026-11-18: «Poza planului trebuie sa fie mai
  sus, si sa pot pune mai multe poze, si link-uri, am facut spre exemplu un google maps custom map si vreau sa pot pune
  url-ul»). The organizers have the plan as pictures — the map with the points drawn on it, a detail of the start — and as
  addresses — a Google My Maps map of their own —, and both live with the plan: up to twelve stored pictures and twelve links
  an event (`event_volunteer_plan_pictures`, `event_volunteer_plan_links`, `db/schema/volunteer-plan.ts`), each in the order
  it was added, shown at the top of the plan's page and printed with it. This file is their one reader and their one
  writer: the page reads them through `readVolunteerPlan`, and «Trimite fiecăruia punctul lui» (§956, `point-mail.ts`) sends
  them on as the message leaves (`readVolunteerPlanMaps`), so nobody but this file names the tables.

  The one picture of §952 (a column of the events) was copied into the pictures by migration `0213` and is
  written by nobody since; `media/references.ts` still counts it, so nothing it names is swept before the contract that
  drops it.
*/

/** One person as the plan says them: the name, how to reach them, what they were given to do, and the point they stand at. */
export type VolunteerPlanPerson = Pick<VolunteerItem, "id" | "name" | "phone" | "state" | "bibNumber" | "roleIds" | "checkpointId">;

/**
 * One point of the plan and the people standing at it, by name. `number` is the point's place in the route's order (1 for
 * the first) — the point's own (`PlanPoint.number`), said here too for whoever draws a row — or null at the start–finish.
 */
export type VolunteerPlanPoint = { point: PlanPoint; number: number | null; people: VolunteerPlanPerson[] };

/**
 * One picture of the plan, as whoever draws it needs it (§952, §NNN): its row's id (what «Șterge poza» posts), the stored
 * picture's id and its own size, and two addresses — the whole picture (`fullUrl`, the master: what a press on the picture
 * opens) and the same picture at a display size (`displayUrl`: the widest stored file not above `PLAN_PICTURE_DISPLAY_WIDTH`,
 * or the master when it is narrower than every rung). Both are the store's public addresses, absolute, so a page and a message
 * can carry them alike; `srcSet` is the ladder for a screen that chooses for itself (§414), absent for a picture stored
 * without one.
 */
export type VolunteerPlanPicture = { id: string; assetId: string; width: number; height: number; fullUrl: string; displayUrl: string; srcSet: string | undefined };

/** One link of the plan (§NNN): its row's id, the address as it was kept, its label or null, and its host without `www.`. */
export type VolunteerPlanLink = { id: string; url: string; label: string | null; host: string };

/** The plan's pictures and links (§NNN), each in the order they were added. */
export type VolunteerPlanMaps = { pictures: VolunteerPlanPicture[]; links: VolunteerPlanLink[] };

export type VolunteerPlan = VolunteerPlanMaps & {
  /** The event's points in the plan's one order (`listPlanPoints`, §961): the start–finish points, then the route by distance. */
  points: VolunteerPlanPoint[];
  /** Everybody not cancelled who stands at no point, by name. */
  unplaced: VolunteerPlanPerson[];
  /** The words of every role these people hold, for whoever draws them. */
  roles: Map<string, RoleNameWords>;
};

/**
 * The display size (§952): a laptop's half column at 2× and a phone's full column at 3× (`media/ladder.ts`), and what a
 * message's column needs at 2× — wide enough to read the numbers on a map, a fraction of the master's weight.
 */
export const PLAN_PICTURE_DISPLAY_WIDTH = 1280;

const byName = (a: VolunteerPlanPerson, b: VolunteerPlanPerson) => a.name.localeCompare(b.name, "ro") || a.id.localeCompare(b.id);

/**
 * A stored picture as the plan's (§952), or null for a row that is no picture to draw: a film's automatic poster (`yt-…`,
 * §485), or an environment with no store to build an address from.
 */
function planPictureOf(row: { id: string; assetId: string; keyPrefix: string; width: number; height: number }): VolunteerPlanPicture | null {
  if (row.keyPrefix.startsWith("yt-") || !isStorageConfigured()) return null;
  const storage = getStorage();
  const fullUrl = storage.publicUrl(objectKey(row.keyPrefix, "web"));
  // A rung exists only under a picture stored with its ladder (§414); one from before has its master and nothing narrower.
  const rung = isLadderKeyPrefix(row.keyPrefix) ? ladderWidths(row.width).filter((width) => width <= PLAN_PICTURE_DISPLAY_WIDTH).at(-1) : undefined;
  return {
    id: row.id,
    assetId: row.assetId,
    width: row.width,
    height: row.height,
    fullUrl,
    displayUrl: rung === undefined ? fullUrl : storage.publicUrl(objectKey(row.keyPrefix, rung)),
    srcSet: pictureSrcSet(fullUrl, row.width),
  };
}

/** One event's pictures and links, in their order: the rows of the two tables and the stored pictures they name. */
async function planMapsOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerPlanMaps> {
  const [pictures, links] = await Promise.all([
    db
      .select({
        id: eventVolunteerPlanPictures.id,
        assetId: mediaAssets.id,
        keyPrefix: mediaAssets.keyPrefix,
        width: mediaAssets.width,
        height: mediaAssets.height,
      })
      .from(eventVolunteerPlanPictures)
      .innerJoin(mediaAssets, eq(mediaAssets.id, eventVolunteerPlanPictures.mediaAssetId))
      .where(eq(eventVolunteerPlanPictures.eventId, eventId))
      .orderBy(asc(eventVolunteerPlanPictures.position), asc(eventVolunteerPlanPictures.createdAt), asc(eventVolunteerPlanPictures.id)),
    db
      .select({ id: eventVolunteerPlanLinks.id, url: eventVolunteerPlanLinks.url, label: eventVolunteerPlanLinks.label })
      .from(eventVolunteerPlanLinks)
      .where(eq(eventVolunteerPlanLinks.eventId, eventId))
      .orderBy(asc(eventVolunteerPlanLinks.position), asc(eventVolunteerPlanLinks.createdAt), asc(eventVolunteerPlanLinks.id)),
  ]);
  return {
    pictures: pictures.flatMap((row) => {
      const picture = planPictureOf(row);
      return picture ? [picture] : [];
    }),
    links: links.map((link) => ({ ...link, host: planLinkHost(link.url) })),
  };
}

/**
 * The plan's pictures and links alone, for the one message that carries them (§956, `point-mail.ts#volunteerPointAtSend`):
 * read as the email leaves, so a picture or a link added or taken off since the press is what is sent. No role is asked
 * here: the caller is the outbox's renderer, with nobody signed in; who may queue that message is asked where it is queued
 * (`sendVolunteerPoints`). Nothing for an event that is not there; no picture where no store is configured.
 */
export async function readVolunteerPlanMaps<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerPlanMaps> {
  if (!isUuid(eventId)) return { pictures: [], links: [] };
  return planMapsOf(db, eventId);
}

/** One event's plan: its points with their people, the people at none, and the plan's pictures and links. */
export async function readVolunteerPlan<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<VolunteerPlan> {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the volunteers' plan`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");

  const [points, everybody, maps] = await Promise.all([listPlanPoints(db, eventId), listVolunteers(db, eventId), planMapsOf(db, eventId)]);
  const people: VolunteerPlanPerson[] = everybody
    .filter((person) => person.state !== "CANCELLED")
    .map(({ id, name, phone, state, bibNumber, roleIds, checkpointId }) => ({ id, name, phone, state, bibNumber, roleIds, checkpointId }))
    .sort(byName);
  const onPlan = new Set(points.map((point) => point.id));
  return {
    points: points.map((point) => ({ point, number: point.number, people: people.filter((person) => person.checkpointId === point.id) })),
    unplaced: people.filter((person) => person.checkpointId === null || !onPlan.has(person.checkpointId)),
    roles: await listRoleNames(db, [...new Set(people.flatMap((person) => person.roleIds))]),
    ...maps,
  };
}

/** What a press of «Poze și hărți» did: something changed, or nothing — the picture already there, the row already gone. */
export type VolunteerPlanMapsChange = { changed: boolean };

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * Who may change the plan's pictures and links, asked before anything is read (BR-REQ-060-01): whoever works the volunteers
 * (`canManageVolunteers`: the Organizer and the Administrators). Anybody else is refused with nothing written.
 */
function assertMayChangeMaps(actor: Pick<StaffUser, "role">): void {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the pictures and links of the volunteers' plan`);
}

/**
 * A press of «Poze și hărți», start to finish: the event held under its row's lock — NO KEY UPDATE, as the plan's other presses
 * take it, so a sign-up's foreign-key check is not made to wait and two presses come one after the other (the limit and the
 * position are read under it) — then `work`. The event's `version` does not move: this is no edit of the page's words, and it
 * must not make a colleague's open editor stale.
 */
async function underPlanLock<T extends Record<string, unknown>, R>(db: Database<T>, eventId: string, work: (tx: Transaction<T>) => Promise<R>): Promise<R> {
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    return work(tx);
  });
}

/**
 * The picture a press asks for, as posted: a stored picture's id. Anything else — nothing posted, an empty box, a value that
 * is no id — is refused naming the box rather than handed to PostgreSQL as one (§376).
 */
function postedPictureId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isUuid(id)) throw new DomainError("VALIDATION_ERROR", "the plan's picture: the value is no picture's id", ["assetId"]);
  return id;
}

/**
 * «Adaugă o poză» (§NNN): the stored picture the browser has just uploaded through the backoffice's one upload
 * (`/api/admin/media`) goes last on the event's plan.
 *
 * - **Who:** `canManageVolunteers`, asked here whatever the action asked, before anything is read.
 * - **What:** the event must be there and the id must name a stored picture — a row of `media_assets` that is not a film's
 *   automatic poster (§485) — or the press is refused naming the box (`assetId`). One already on this plan changes nothing;
 *   past `PLAN_PICTURES_MAX` pictures the press is refused (`PLAN_PICTURES_FULL`).
 * - **The trail:** one row, `event.volunteer_plan_picture_added`, the stored picture's id alone.
 */
export async function addVolunteerPlanPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; assetId: unknown },
  now: Date,
): Promise<VolunteerPlanMapsChange> {
  assertMayChangeMaps(actor);
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const assetId = postedPictureId(request.assetId);

  return underPlanLock(db, request.eventId, async (tx) => {
    const [asset] = await tx.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
    if (!asset || asset.keyPrefix.startsWith("yt-")) throw new DomainError("VALIDATION_ERROR", "the plan's picture: the id names no stored picture", ["assetId"]);
    const onThePlan = eq(eventVolunteerPlanPictures.eventId, request.eventId);
    const [already] = await tx
      .select({ id: eventVolunteerPlanPictures.id })
      .from(eventVolunteerPlanPictures)
      .where(and(onThePlan, eq(eventVolunteerPlanPictures.mediaAssetId, assetId)))
      .limit(1);
    if (already) return { changed: false };
    const [{ held, last }] = await tx.select({ held: count(), last: max(eventVolunteerPlanPictures.position) }).from(eventVolunteerPlanPictures).where(onThePlan);
    if (held >= PLAN_PICTURES_MAX) throw new PlanMapsRefusal("PLAN_PICTURES_FULL");

    await tx.insert(eventVolunteerPlanPictures).values({ eventId: request.eventId, mediaAssetId: assetId, position: (last ?? 0) + 1, createdAt: now });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteer_plan_picture_added",
      entityType: "event",
      entityId: request.eventId,
      metadata: { assetId },
      now,
    });
    return { changed: true };
  });
}

/**
 * «Șterge poza» (§NNN): one picture taken off the event's plan, by its row's id. A row that is not this plan's — gone already,
 * another event's, a value that is no id — changes nothing. The stored picture is not deleted here: used nowhere else, it is
 * the sweep's after its week (§73). The trail: `event.volunteer_plan_picture_removed`, the stored picture's id alone.
 */
export async function removeVolunteerPlanPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: unknown },
  now: Date,
): Promise<VolunteerPlanMapsChange> {
  assertMayChangeMaps(actor);
  return underPlanLock(db, request.eventId, async (tx) => {
    const id = typeof request.id === "string" ? request.id.trim().toLowerCase() : "";
    if (!isUuid(id)) return { changed: false };
    const [gone] = await tx
      .delete(eventVolunteerPlanPictures)
      .where(and(eq(eventVolunteerPlanPictures.id, id), eq(eventVolunteerPlanPictures.eventId, request.eventId)))
      .returning({ assetId: eventVolunteerPlanPictures.mediaAssetId });
    if (!gone) return { changed: false };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteer_plan_picture_removed",
      entityType: "event",
      entityId: request.eventId,
      metadata: { assetId: gone.assetId },
      now,
    });
    return { changed: true };
  });
}

/**
 * «Adaugă linkul» (§NNN): an address — a Google My Maps map, a document — goes last on the event's plan, with an optional label.
 *
 * - **Who:** `canManageVolunteers`, asked here whatever the action asked, before anything is read.
 * - **What:** the address an `http:` or `https:` one, read whole, at most 2 000 characters (`PLAN_LINK_URL`); the label at most
 *   120 (`PLAN_LINK_LABEL`), empty meaning none (`domain/plan-link.ts`); past `PLAN_LINKS_MAX` links the press is refused
 *   (`PLAN_LINKS_FULL`). The same address already on the plan changes nothing — a second press of a slow form adds no twin.
 * - **The trail:** one row, `event.volunteer_plan_link_added`, the link's id alone — never the address or the label.
 */
export async function addVolunteerPlanLink<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; url: unknown; label: unknown },
  now: Date,
): Promise<VolunteerPlanMapsChange> {
  assertMayChangeMaps(actor);
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const url = readPlanLinkUrl(request.url);
  const label = readPlanLinkLabel(request.label);

  return underPlanLock(db, request.eventId, async (tx) => {
    const onThePlan = eq(eventVolunteerPlanLinks.eventId, request.eventId);
    const [already] = await tx.select({ id: eventVolunteerPlanLinks.id }).from(eventVolunteerPlanLinks).where(and(onThePlan, eq(eventVolunteerPlanLinks.url, url))).limit(1);
    if (already) return { changed: false };
    const [{ held, last }] = await tx.select({ held: count(), last: max(eventVolunteerPlanLinks.position) }).from(eventVolunteerPlanLinks).where(onThePlan);
    if (held >= PLAN_LINKS_MAX) throw new PlanMapsRefusal("PLAN_LINKS_FULL");

    const [added] = await tx
      .insert(eventVolunteerPlanLinks)
      .values({ eventId: request.eventId, url, label, position: (last ?? 0) + 1, createdAt: now })
      .returning({ id: eventVolunteerPlanLinks.id });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteer_plan_link_added",
      entityType: "event",
      entityId: request.eventId,
      metadata: { linkId: added.id },
      now,
    });
    return { changed: true };
  });
}

/**
 * «Șterge linkul» (§NNN): one link taken off the event's plan, by its id. A row that is not this plan's changes nothing. The
 * trail: `event.volunteer_plan_link_removed`, the link's id alone.
 */
export async function removeVolunteerPlanLink<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: unknown },
  now: Date,
): Promise<VolunteerPlanMapsChange> {
  assertMayChangeMaps(actor);
  return underPlanLock(db, request.eventId, async (tx) => {
    const id = typeof request.id === "string" ? request.id.trim().toLowerCase() : "";
    if (!isUuid(id)) return { changed: false };
    const [gone] = await tx
      .delete(eventVolunteerPlanLinks)
      .where(and(eq(eventVolunteerPlanLinks.id, id), eq(eventVolunteerPlanLinks.eventId, request.eventId)))
      .returning({ id: eventVolunteerPlanLinks.id });
    if (!gone) return { changed: false };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteer_plan_link_removed",
      entityType: "event",
      entityId: request.eventId,
      metadata: { linkId: gone.id },
      now,
    });
    return { changed: true };
  });
}
