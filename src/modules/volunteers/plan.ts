import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import type { Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";
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
  page, email or badge reads it.

  Read by whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators), asserted here
  (BR-REQ-060-01) as on the «Voluntari» list, whose names and telephone numbers these are; placing somebody is
  `volunteers.ts#changeVolunteer` (`setCheckpoint`), which asks for the role again.
*/

/** One person as the plan says them: the name, how to reach them, what they were given to do, and the point they stand at. */
export type VolunteerPlanPerson = Pick<VolunteerItem, "id" | "name" | "phone" | "state" | "bibNumber" | "roleIds" | "checkpointId">;

/** One point of the route, its place in the route's order (1 for the first), and the people standing at it, by name. */
export type VolunteerPlanPoint = { point: Checkpoint; number: number; people: VolunteerPlanPerson[] };

export type VolunteerPlan = {
  /** The event's points by distance — the order the page, the editor and the bib have them in. */
  points: VolunteerPlanPoint[];
  /** Everybody not cancelled who stands at no point, by name. */
  unplaced: VolunteerPlanPerson[];
  /** The words of every role these people hold, for whoever draws them. */
  roles: Map<string, RoleNameWords>;
};

const byName = (a: VolunteerPlanPerson, b: VolunteerPlanPerson) => a.name.localeCompare(b.name, "ro") || a.id.localeCompare(b.id);

/** One event's plan: its points with their people, and the people at none. */
export async function readVolunteerPlan<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<VolunteerPlan> {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the volunteers' plan`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
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
  };
}
