import { and, count, eq, gt } from "drizzle-orm";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { readDeadlines } from "@/modules/deadlines/deadlines";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { countVolunteersWithKit } from "@/modules/volunteers/admin-list";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { countKits, type KitCount, readPlaceDeadlines, readPlaceOutlook } from "./admin-repository";
import { countBibs, spareCardState } from "./bibs";
import { listCapacityHistory } from "./capacity-history";
import { computeOccupied, placesTaken } from "./domain/capacity";
import type { CapacityHistory } from "./domain/capacity-history";
import type { PlaceDeadlineCounts, PlaceDeadlineEvent } from "./domain/place-deadlines";
import type { PlaceOutlook } from "./domain/place-outlook";
import { breakdownOf, type OrderTotals, orderTotals, outsideOf, type RacePlanRows, racePlanRows } from "./domain/race-plan";
import { invitationOpen } from "./invitation-repository";
import { type PublicDoor, readPublicDoor } from "./public-now";
import { countOccupied } from "./repository";

/** What the page says about the event itself. */
export type RacePlanEvent = {
  id: string;
  /** null: no limit of places. */
  capacity: number | null;
  /** Whether the event takes its registration on this site: the plan means nothing otherwise. */
  internal: boolean;
};

export type RacePlan =
  | { event: RacePlanEvent; internal: false }
  | {
      event: RacePlanEvent;
      internal: true;
      /** «Locuri» (`readPlaceOutlook`, unchanged): null for an event with no limit of places. */
      outlook: PlaceOutlook | null;
      /** «Pe site acum» (`readPublicDoor`, unchanged), drawn read-only. */
      door: PublicDoor | null;
      /** «Pe categorii». */
      rows: RacePlanRows;
      /** «De comandat» if every place fills; null for an event with no limit. */
      totals: OrderTotals | null;
      /** «Kituri de pregătit» now (`countKits`, unchanged) and the volunteers with a kit beside it (§904). */
      kits: KitCount;
      volunteersWithKit: number;
      /** «Termene» (`readPlaceDeadlines`, unchanged) and the club's deadlines it words them with. */
      placeDeadlines: { event: PlaceDeadlineEvent; counts: PlaceDeadlineCounts; deadlines: Deadlines } | null;
      /** The race numbers given now and how many are still unprinted (`countBibs`, unchanged). */
      bibs: { total: number; unprinted: number };
      /** «Istoric capacitate». */
      history: CapacityHistory;
    };

/**
 * «Planul locurilor» for one event (§NNN): every reader the registrations list already calls for «Locuri», «Pe site
 * acum», «Kituri de pregătit» and «Când se pierde un loc», with their signatures as they are, and reads of its own — the
 * allocator's count once more for the lapsed holds (`countOccupied`, the definition the sweep uses), one grouped count
 * of the registrations by state × outside × elite × kind, the open invitations by «Pe lista de invitați speciali», the
 * elite list's and the internal list's lines — and «Istoric capacitate». About twenty small queries in one
 * `Promise.all`, only when somebody opens the page: no polling, nothing cached, nothing written.
 *
 * Reading the elite list's lines and the elite mark here amends §895 and §897, which kept both out of every count: the
 * plan says «din care elită» and orders a bib per elite line. Neither reaches the allocator, a state or an email.
 *
 * Asserted here as well as on the page (BR-REQ-060-01): whoever may read the registrations (`canReadRegistrations` —
 * the Organizer, the Administrator, the Superadministrator), `FORBIDDEN` for anybody else; `NOT_FOUND` for a malformed
 * id or an event that does not exist. An event that takes no registration on this site has no places to plan: only
 * the fact is returned.
 */
export async function readRacePlan<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  eventId: string,
  now: Date,
): Promise<RacePlan> {
  if (!canReadRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's places`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const [row] = await db.select({ id: events.id, capacity: events.capacity, registrationMode: events.registrationMode }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "no such event");
  const event: RacePlanEvent = { id: row.id, capacity: row.capacity, internal: row.registrationMode === "INTERNAL" };
  if (!event.internal) return { event, internal: false };

  const [outlook, door, kits, volunteersWithKit, deadlineFacts, { deadlines }, bibs, spares, history, counts, groups, invitations, [elite], [internalLines]] = await Promise.all([
    readPlaceOutlook(db, eventId, now),
    readPublicDoor(db, eventId, now),
    countKits(db, eventId, now),
    countVolunteersWithKit(db, eventId),
    readPlaceDeadlines(db, eventId, now),
    readDeadlines(db),
    countBibs(db, eventId),
    spareCardState(db, eventId),
    listCapacityHistory(db, eventId, event.capacity),
    countOccupied(db, eventId, now),
    db
      .select({ status: registrations.status, outside: registrations.outsideCapacity, elite: registrations.elite, kind: registrations.kind, total: count() })
      .from(registrations)
      .where(eq(registrations.eventId, eventId))
      .groupBy(registrations.status, registrations.outsideCapacity, registrations.elite, registrations.kind),
    db
      .select({ outside: eventInvitations.outsideCapacity, total: count() })
      .from(eventInvitations)
      .where(and(eq(eventInvitations.eventId, eventId), gt(eventInvitations.expiresAt, now), invitationOpen()))
      .groupBy(eventInvitations.outsideCapacity),
    db.select({ total: count() }).from(eventEliteEntries).where(eq(eventEliteEntries.eventId, eventId)),
    db.select({ total: count() }).from(eventReserveEntries).where(eq(eventReserveEntries.eventId, eventId)),
  ]);

  /*
    With a capacity, every number «Locuri» says is the outlook's own — the places by kind, the special guests, both
    lists — so «Pe categorii» cannot disagree with it. With no limit there is no outlook: the same allocator's count
    speaks for the places, and the grouped read for the guests and the line, counted as `readPlaceOutlook` counts them.
  */
  const breakdown = breakdownOf(groups);
  const taken = outlook ?? { ...placesTaken(0, counts), occupied: computeOccupied(counts) };
  const outside = outlook ? outlook.outside : outsideOf(breakdown);
  const outsideInvitations = invitations.find((group) => group.outside)?.total ?? 0;
  const eliteEntries = elite?.total ?? 0;
  const rows = racePlanRows({
    capacity: event.capacity,
    taken: { confirmed: taken.confirmed, declaration: taken.declaration, offered: taken.offered, invited: taken.invited, family: taken.family, occupied: taken.occupied },
    free: outlook ? outlook.free : null,
    waiting: outlook ? outlook.waiting : breakdown.waiting,
    internal: outlook ? outlook.internal : (internalLines?.total ?? 0),
    outside,
    lapsed: counts.lapsedDeclarationHolds,
    breakdown,
    outsideInvitations,
    eliteEntries,
    volunteersWithKit,
  });
  return {
    event,
    internal: true,
    outlook,
    door,
    rows,
    totals: orderTotals({ capacity: event.capacity, occupied: taken.occupied, outside, outsideInvitations, volunteersWithKit, eliteEntries, spares: spares.free }),
    kits,
    volunteersWithKit,
    placeDeadlines: deadlineFacts ? { ...deadlineFacts, deadlines } : null,
    bibs,
    history,
  };
}
