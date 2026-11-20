import { and, eq } from "drizzle-orm";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { lockEventForCapacity } from "@/modules/registrations/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type RaffleGuardianWay, raffleGuardianRecord, raffleSignUpClosedFor, volunteerConfirmedForRaffle } from "./domain/raffle";
import { isVolunteerMinor } from "./domain/volunteer";
import { signUpConfirmedVolunteerInTransaction } from "./raffle-entries";
import { canTakeRaffleList } from "./raffle-list";
import { localeOr, type RafflePersonFacts, readRaffleGateFacts, volunteerRafflePerson } from "./raffle-roster";
import { drawVolunteerNumber } from "./volunteer-numbers";

/*
  «Confirmă pentru tombolă» (§NNN, amending §984 and §1023). The owner, 2026-11-20, the day before the race, of a volunteer of
  seventeen whose row on «Ziua cursei» → «Tombolă» read «Voluntar · Nu · neconfirmat» and whose page read «Înscris», «Acordul
  părinților lipsește», «Link trimis părintelui»: «vreau să pot să o confirm și pe [ea] pentru tombolă, chiar și fără acordul
  părinților». The club's approved «Regulamentul tombolei» says «Un participant minor se înscrie cu acordul părintelui sau al
  tutorelui său.», so, asked, the owner chose: the Organizer or an Administrator confirms such a volunteer **for the raffle**,
  recording that the parent or guardian agreed and how (by telephone, in person, in writing); the volunteering agreement stays
  missing and the person stays unconfirmed as a volunteer.

  - **Who.** The Organizer and the Administrators — whoever takes the raffle's files and keeps its exclusions (`canTakeRaffleList`,
    which is `canReadRegistrations` and `canManageVolunteers`) —, asked here and again at the action's door (BR-REQ-060-01). The
    desk's Voluntar, the Redactor and Tehnic are refused, whatever a page draws.
  - **Not the volunteer's state.** The person stays «Înscris», their volunteering agreement and their parent's link exactly as they
    were: «Confirmat» is still the organizers' «Confirmă», which a minor reaches only with the parent's volunteering agreement
    (§768). What this records — `event_volunteers.raffle_confirmed_at`, `raffle_confirmed_by_staff_user_id` and, for a minor,
    `raffle_guardian_agreed` with `raffle_guardian_way` — lets the person take part in the raffle (`domain/raffle.ts#raffleConfirmed`).
  - **A minor** (the age «Acordul părintelui lipsește» is decided by, `isVolunteerMinor`) only with the box «Părintele sau tutorele
    a fost de acord să participe la tombolă» ticked and one of the three ways chosen (`raffleGuardianRecord`), refused here without
    them (`RAFFLE_GUARDIAN_MISSING`, naming what is missing). An adult: nothing is asked, nothing is recorded of a parent.
  - **One transaction under the event row's lock**, the serialization point of every number given at an event (§1023,
    `AGENTS.md` §10.6): the person's V number drawn when they have none — the very draw «Confirmă» uses, the next one the event
    never gave; a later «Confirmă» keeps it, and a number is never reissued —, the row marked, and, where the event's raffle asks a
    sign-up, the person signed up by the organizers' own door (STAFF, `signUpConfirmedVolunteerInTransaction`): the person's
    acceptance of the rules on paper or aloud, which the press's tick records, the gate asked again — shut, nothing is written.
  - **One audit row of its own**, `volunteer.raffle_confirmed`: the staff member as its actor, and of the person only their id,
    whether a minor, the parent's way, the V number and whether the press drew it — never a name. «Ziua cursei» → «Jurnal» reads it
    («a confirmat pentru tombolă»), beside the take-outs of §1020. A sign-up it writes keeps the sign-up's own row, as every one does.
  - **Nobody is told**: no email, no public page, no public cache. No state, role, agreement, link, point, kit, presence or place moves.
*/

type Actor = Pick<StaffUser, "id" | "role">;

export type RaffleConfirmationInput = {
  eventId: string;
  volunteerId: string;
  /** «Părintele sau tutorele a fost de acord să participe la tombolă» (a minor's): only a real `true` is a tick. */
  guardianAgreed: unknown;
  /** How the parent or guardian agreed (a minor's): «PHONE», «IN_PERSON» or «WRITING»; anything else is none. */
  guardianWay: unknown;
  /** «A acceptat regulamentul»: the person accepted the rules on paper or aloud — asked «Cu înscriere separată», where the press signs them up. */
  accepted: boolean;
};

/** What the press did: whether it wrote anything, the person's V number now, and whether it signed them up. */
export type RaffleConfirmationResult = { changed: boolean; volunteerNumber: number | null; signedUp: boolean; minor: boolean; guardianWay: RaffleGuardianWay | null };

/**
 * «Confirmă pentru tombolă» on a volunteer of the event (§NNN): the role first (`FORBIDDEN`), then, in one transaction under the event
 * row's lock — the event holding a raffle (`RAFFLE_NOT_HELD`), the person this event's (`NOT_FOUND`) and neither cancelled nor of a
 * group the raffle leaves out (`RAFFLE_NOT_ELIGIBLE`) —, a minor's parent's agreement and its way (`RAFFLE_GUARDIAN_MISSING`), «Cu
 * înscriere separată» the gate open for the volunteers (`RAFFLE_SIGN_UP_CLOSED`) and the rules accepted (`RAFFLE_RULES_NOT_ACCEPTED`)
 * — every refusal before anything is written. A person who takes part by a confirmation already — «Confirmat», or confirmed for the
 * raffle (a minor's with the parent's agreement) — is a press that changes nothing and writes nothing.
 */
export async function confirmVolunteerForRaffle<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, input: RaffleConfirmationInput, now: Date): Promise<RaffleConfirmationResult> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not confirm a volunteer for the raffle`);
  if (!isUuid(input.eventId) || !isUuid(input.volunteerId)) throw new DomainError("NOT_FOUND", "the event or the volunteer is not there");

  return db.transaction(async (tx) => {
    // The event row first, the serialization point of every number given at the event — the order «Confirmă» and the transforms take.
    const event = await lockEventForCapacity(tx, input.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const facts = await readRaffleGateFacts(tx, input.eventId, now);
    if (!facts || !facts.settings.hasRaffle) throw new DomainError("RAFFLE_NOT_HELD", "the event holds no raffle");

    const [row] = await tx
      .select({
        id: eventVolunteers.id,
        eventId: eventVolunteers.eventId,
        name: eventVolunteers.name,
        locale: eventVolunteers.locale,
        state: eventVolunteers.state,
        age: eventVolunteers.age,
        volunteerNumber: eventVolunteers.volunteerNumber,
        inRaffle: eventVolunteers.inRaffle,
        raffleConfirmedAt: eventVolunteers.raffleConfirmedAt,
        raffleGuardianAgreed: eventVolunteers.raffleGuardianAgreed,
        raffleGuardianWay: eventVolunteers.raffleGuardianWay,
      })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.id, input.volunteerId), eq(eventVolunteers.eventId, input.eventId)))
      .for("update")
      .limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "the volunteer is not there");
    // A cancelled volunteer takes part in nothing; a raffle that takes no volunteers takes none confirmed this way either.
    if (row.state === "CANCELLED" || !facts.settings.groups.VOLUNTEER) throw new DomainError("RAFFLE_NOT_ELIGIBLE", "a cancelled volunteer, or a raffle without the volunteers");

    const minor = isVolunteerMinor(row.age);
    if (row.state === "CONFIRMED" || volunteerConfirmedForRaffle({ state: row.state, minor, raffleConfirmedAt: row.raffleConfirmedAt, raffleGuardianAgreed: row.raffleGuardianAgreed })) {
      return { changed: false, volunteerNumber: row.volunteerNumber, signedUp: false, minor, guardianWay: row.raffleGuardianWay };
    }
    const guardian = raffleGuardianRecord({ minor, agreed: input.guardianAgreed, way: input.guardianWay });
    if (!guardian.ok) throw new DomainError("RAFFLE_GUARDIAN_MISSING", "a minor is confirmed for the raffle only with the parent's agreement and its way", guardian.missing);
    // «Cu înscriere separată» the press signs the person up: the gate and the acceptance asked before a word is written.
    if (facts.settings.signUp) {
      const closed = raffleSignUpClosedFor(facts, now, "VOLUNTEER");
      if (closed) throw new DomainError("RAFFLE_SIGN_UP_CLOSED", `the raffle's sign-up is closed (${closed})`);
      if (!input.accepted) throw new DomainError("RAFFLE_RULES_NOT_ACCEPTED", "the press signs the person up: the rules accepted first", ["accepted"]);
    }

    // The V number (§1023): the very draw «Confirmă» makes — the next one the event never gave —, and never a second for a person
    // who holds one; a later «Confirmă» keeps it.
    const drawn = row.volunteerNumber === null ? await drawVolunteerNumber(tx, input.eventId) : null;
    const volunteerNumber = drawn ?? row.volunteerNumber;
    await tx
      .update(eventVolunteers)
      .set({
        raffleConfirmedAt: now,
        raffleConfirmedByStaffUserId: actor.id,
        raffleGuardianAgreed: guardian.agreed,
        raffleGuardianWay: guardian.way,
        ...(drawn !== null ? { volunteerNumber: drawn } : {}),
        updatedAt: now,
      })
      .where(eq(eventVolunteers.id, row.id));

    let raffleEntryId: string | null = null;
    if (facts.settings.signUp) {
      // The volunteer as the press leaves them: confirmed for the raffle, with their number — eligible for the organizers' own door.
      const person: RafflePersonFacts = {
        ref: { table: "volunteer", id: row.id },
        eventId: row.eventId,
        kind: "VOLUNTEER",
        name: row.name,
        number: volunteerNumber,
        locale: localeOr(row.locale),
        person: volunteerRafflePerson({ ...row, volunteerNumber, raffleConfirmedAt: now, raffleGuardianAgreed: guardian.agreed }),
      };
      raffleEntryId = (await signUpConfirmedVolunteerInTransaction(tx, { person, accepted: input.accepted, recordedBy: actor.id }, now)).entryId;
    }

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.raffle_confirmed",
      entityType: "event",
      entityId: input.eventId,
      // Who decided is the actor; of the person their id alone — never a name —, whether a minor and how the parent agreed.
      metadata: {
        volunteerId: row.id,
        minor,
        guardianWay: guardian.way,
        ...(volunteerNumber !== null ? { volunteerNumber } : {}),
        numberDrawn: drawn !== null,
        ...(raffleEntryId !== null ? { raffleEntryId } : {}),
      },
      now,
    });
    return { changed: true, volunteerNumber, signedUp: raffleEntryId !== null, minor, guardianWay: guardian.way };
  });
}
