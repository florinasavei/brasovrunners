import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import type { Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import { isLadderKeyPrefix, ladderWidths, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { listRoleNames, type RoleNameWords } from "./admin-list";
import { listVolunteers, type VolunteerItem } from "./volunteers";

/*
  «Planul voluntarilor» (§949; the owner, 2026-11-16, with a map of the route and its seven points: «e foarte important sa avem
  planul de voluntari si fiecare in ce punct ramane»): who stands where on the day. One event's points on the route — the same
  «Puncte pe traseu» the editor keeps, the page lists and the bib draws (§757) — in the route's order, each with the people the
  organizers placed at it (`event_volunteers.checkpoint_id`), and under them everybody not placed: still to place, or working
  somewhere that is not a point of the route (the start, the kits), which their roles say.

  Who is on it: every volunteer of the event who is not cancelled — a cancelled person keeps the point they had, in case they
  come back, and is simply not on the plan. Nothing here is the person's own answer: the plan is the organizers', and no public
  page or badge reads it. One email says a person their own point, and only at an organizer's press: «Trimite fiecăruia punctul
  lui» (§NNN, `point-mail.ts`). Placing, moving or taking somebody off writes to nobody.

  Read by whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators), asserted here
  (BR-REQ-060-01) as on the «Voluntari» list, whose names and telephone numbers these are; placing somebody is
  `volunteers.ts#changeVolunteer` (`setCheckpoint`), which asks for the role again.
*/

/*
  The plan's picture (the decision after the plan's own; the owner, the same day, with a picture of Saturday's route and its
  volunteers' points numbered 1 to 7 on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul [pozei] si sa ii
  pot distribui din aplicatie, sa stie exact unde si cum»). The organizers also have the plan as a picture — the map with the
  points drawn on it — and it lives with the plan: one stored picture an event (`events.volunteer_plan_media_asset_id`),
  uploaded on the plan's page, drawn above the points and printed with them. This file reads it (`readVolunteerPlan`) and is
  the one writer of the column (`setVolunteerPlanPicture`); `media/references.ts` counts it, so the sweep never takes it.
  «Trimite fiecăruia punctul lui» (§NNN, `point-mail.ts`) sends it to the volunteers placed at a point: the message reads the
  picture from here as it leaves (`readVolunteerPlanPicture`), so nobody but this file names the column.
*/

/** One person as the plan says them: the name, how to reach them, what they were given to do, and the point they stand at. */
export type VolunteerPlanPerson = Pick<VolunteerItem, "id" | "name" | "phone" | "state" | "bibNumber" | "roleIds" | "checkpointId">;

/** One point of the route, its place in the route's order (1 for the first), and the people standing at it, by name. */
export type VolunteerPlanPoint = { point: Checkpoint; number: number; people: VolunteerPlanPerson[] };

/**
 * The plan's picture, as whoever draws it needs it (§952): the stored picture's id and its own size, and two addresses — the
 * whole picture (`fullUrl`, the master: what a press on the picture opens) and the same picture at a display size
 * (`displayUrl`: the widest stored file not above `PLAN_PICTURE_DISPLAY_WIDTH`, or the master when it is narrower than every
 * rung). Both are the store's public addresses, absolute, so a page and a message can carry them alike; `srcSet` is the
 * ladder for a screen that chooses for itself (§414), absent for a picture stored without one.
 */
export type VolunteerPlanPicture = { assetId: string; width: number; height: number; fullUrl: string; displayUrl: string; srcSet: string | undefined };

export type VolunteerPlan = {
  /** The event's points by distance — the order the page, the editor and the bib have them in. */
  points: VolunteerPlanPoint[];
  /** Everybody not cancelled who stands at no point, by name. */
  unplaced: VolunteerPlanPerson[];
  /** The words of every role these people hold, for whoever draws them. */
  roles: Map<string, RoleNameWords>;
  /** The plan as the organizers drew it (§952), or null: none uploaded, the picture gone from the store, or no store here. */
  picture: VolunteerPlanPicture | null;
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
function planPictureOf(asset: { id: string; keyPrefix: string; width: number; height: number }): VolunteerPlanPicture | null {
  if (asset.keyPrefix.startsWith("yt-") || !isStorageConfigured()) return null;
  const storage = getStorage();
  const fullUrl = storage.publicUrl(objectKey(asset.keyPrefix, "web"));
  // A rung exists only under a picture stored with its ladder (§414); one from before has its master and nothing narrower.
  const rung = isLadderKeyPrefix(asset.keyPrefix) ? ladderWidths(asset.width).filter((width) => width <= PLAN_PICTURE_DISPLAY_WIDTH).at(-1) : undefined;
  return {
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    fullUrl,
    displayUrl: rung === undefined ? fullUrl : storage.publicUrl(objectKey(asset.keyPrefix, rung)),
    srcSet: pictureSrcSet(fullUrl, asset.width),
  };
}

/**
 * The event's row with its plan's picture joined to the store (§952): the column has no foreign key, so an id that names
 * nothing reads as no picture. Nothing for an event that is not there.
 */
async function eventWithPlanPicture<T extends Record<string, unknown>>(db: Database<T>, eventId: string) {
  const [event] = await db
    .select({ id: events.id, pictureId: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix, width: mediaAssets.width, height: mediaAssets.height })
    .from(events)
    .leftJoin(mediaAssets, eq(mediaAssets.id, events.volunteerPlanMediaAssetId))
    .where(eq(events.id, eventId))
    .limit(1);
  return event;
}

/** The joined row's picture as the plan's, or null: none set, the picture gone from the store, or no store here. */
function planPictureOfEvent(event: NonNullable<Awaited<ReturnType<typeof eventWithPlanPicture>>>): VolunteerPlanPicture | null {
  return event.pictureId !== null && event.keyPrefix !== null && event.width !== null && event.height !== null
    ? planPictureOf({ id: event.pictureId, keyPrefix: event.keyPrefix, width: event.width, height: event.height })
    : null;
}

/**
 * The plan's picture alone, for the one message that carries it (§NNN, `point-mail.ts#volunteerPointAtSend`): read as the
 * email leaves, so a picture changed or taken off since the press is the one sent — or none. No role is asked here: the
 * caller is the outbox's renderer, with nobody signed in; who may queue that message is asked where it is queued
 * (`sendVolunteerPoints`). Null for an event that is not there, has no picture, or where no store is configured.
 */
export async function readVolunteerPlanPicture<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerPlanPicture | null> {
  if (!isUuid(eventId)) return null;
  const event = await eventWithPlanPicture(db, eventId);
  return event ? planPictureOfEvent(event) : null;
}

/** One event's plan: its points with their people, the people at none, and the plan's picture. */
export async function readVolunteerPlan<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<VolunteerPlan> {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the volunteers' plan`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const event = await eventWithPlanPicture(db, eventId);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");

  const [points, everybody] = await Promise.all([listCheckpoints(db, eventId), listVolunteers(db, eventId)]);
  const people: VolunteerPlanPerson[] = everybody
    .filter((person) => person.state !== "CANCELLED")
    .map(({ id, name, phone, state, bibNumber, roleIds, checkpointId }) => ({ id, name, phone, state, bibNumber, roleIds, checkpointId }))
    .sort(byName);
  const onRoute = new Set(points.map((point) => point.id));
  return {
    points: points.map((point, index) => ({ point, number: index + 1, people: people.filter((person) => person.checkpointId === point.id) })),
    unplaced: people.filter((person) => person.checkpointId === null || !onRoute.has(person.checkpointId)),
    roles: await listRoleNames(db, [...new Set(people.flatMap((person) => person.roleIds))]),
    picture: planPictureOfEvent(event),
  };
}

/** What a press on the plan's picture did: the first picture, another in its place, the picture taken off — or nothing. */
export type VolunteerPlanPictureChange = { changed: false } | { changed: true; outcome: "set" | "replaced" | "removed" };

/**
 * The picture a press asks for, as posted: a stored picture's id, or null for none — nothing posted, or an empty box, which is
 * how «Șterge poza» says it. Anything else is no id, refused naming the box rather than handed to PostgreSQL as one (§376).
 */
function postedPictureId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = typeof value === "string" ? value.trim().toLowerCase() : null;
  if (id === "") return null;
  if (id === null || !isUuid(id)) throw new DomainError("VALIDATION_ERROR", "the plan's picture: the value is no picture's id", ["assetId"]);
  return id;
}

/**
 * The plan's picture set, changed or taken off (§952): «Încarcă poza planului», «Schimbă poza» and «Șterge poza» on the plan's
 * page. `assetId` is the stored picture the browser has just uploaded through the backoffice's one upload
 * (`/api/admin/media`), or nothing — an empty value, as «Șterge poza» posts it — to take the picture off.
 *
 * - **Who:** whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators), asked here whatever
 *   the action asked (BR-REQ-060-01) and before anything is read; anybody else is refused with nothing written.
 * - **What:** the event must be there, and the id must name a stored picture — a row of `media_assets` that is not a film's
 *   automatic poster (§485) — or the press is refused, naming the box; the column has no foreign key (`events.ts` says why),
 *   so this check is what keeps an id that names nothing out of it.
 * - **How:** under the event row's lock, so two presses are one after the other and each trail row says what it replaced.
 *   A press that changes nothing writes nothing. The event's `version` does not move: this is no edit of the page's words,
 *   and it must not make a colleague's open editor stale.
 * - **The trail:** one row a change — `event.volunteer_plan_picture_set` (the picture's id and the one it replaced, null for
 *   the first) or `event.volunteer_plan_picture_removed` (the id it was) — the event and the pictures' ids, nothing else.
 *
 * The picture it replaces or takes off is not deleted here: used nowhere else, it is the sweep's after its week, as every
 * stored picture a page lets go of (§73). Nobody is told and nothing public changes — no public query reads the column.
 */
export async function setVolunteerPlanPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  request: { eventId: string; assetId: unknown },
  now: Date,
): Promise<VolunteerPlanPictureChange> {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the picture of the volunteers' plan`);
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const wanted = postedPictureId(request.assetId);

  return db.transaction(async (tx): Promise<VolunteerPlanPictureChange> => {
    // NO KEY UPDATE, the strength the UPDATE below takes anyway: a sign-up's foreign-key check is not made to wait.
    const [event] = await tx.select({ current: events.volunteerPlanMediaAssetId }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (event.current === wanted) return { changed: false };

    if (wanted !== null) {
      const [asset] = await tx.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).where(eq(mediaAssets.id, wanted)).limit(1);
      if (!asset || asset.keyPrefix.startsWith("yt-")) {
        throw new DomainError("VALIDATION_ERROR", "the plan's picture: the id names no stored picture", ["assetId"]);
      }
    }

    await tx.update(events).set({ volunteerPlanMediaAssetId: wanted }).where(eq(events.id, request.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: wanted === null ? "event.volunteer_plan_picture_removed" : "event.volunteer_plan_picture_set",
      entityType: "event",
      entityId: request.eventId,
      metadata: wanted === null ? { assetId: event.current } : { assetId: wanted, replaced: event.current },
      now,
    });
    return { changed: true, outcome: wanted === null ? "removed" : event.current === null ? "set" : "replaced" };
  });
}
