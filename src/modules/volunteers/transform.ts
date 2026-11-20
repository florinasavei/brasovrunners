import { and, eq } from "drizzle-orm";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { participants } from "@/db/schema/participants";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { noticeDescribesVolunteerProfile } from "@/modules/legal-documents/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { cancelRegistrationByStaff, enterOnWaitlistByStaff, type WaitlistEntryByStaffResult } from "@/modules/registrations/admin-service";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { sexShown } from "@/modules/registrations/domain/sex";
import { canTransition } from "@/modules/registrations/domain/state-machine";
import { E164_PHONE } from "@/modules/registrations/phone";
import { setRegistrationInRaffle } from "@/modules/registrations/raffle-mark";
import { findRegistrationById, lockEventForCapacity } from "@/modules/registrations/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { isVolunteerMinor, VOLUNTEER_AGE_MAX, VOLUNTEER_CITY_MAX, VOLUNTEER_MINIMUM_AGE, volunteerAgeOn, volunteerEventDay } from "./domain/volunteer";
import { moveRaffleEntry } from "./raffle-entries";
import { changeVolunteer } from "./volunteers";

/*
  «Transformă în voluntar» and «Transformă în alergător» (§948; the owner, 2026-11-15: «aș vrea să pot să „transform" un
  alergător în voluntar și invers»).

  A volunteer is not a registration (`volunteers.ts`), and neither press makes one into the other: each is the two presses
  an Administrator would make by hand, in one transaction under the event row's lock, so the person is never on both lists
  or on neither —

  - **a runner turned volunteer**: the registration cancelled as «Anulează înscrierea» cancels it (the one allocator: the
    place released and offered to the front of the waiting list), and the person entered on the event's volunteers as
    «Adaugă un voluntar de mână» enters one, with the role the Administrator chose given and the person confirmed;
  - **a volunteer turned runner**: the person entered as «Adaugă pe lista de așteptare» enters one (§872: the address
    vouched for, the one allocator — a counted free place or the back of the line, never ahead of anyone — the
    declaration still the person's own to sign), and the volunteer cancelled as «Anulează» cancels one.

  No new way into a race and no new way out of one: no place is given or taken except by the verbs that already do it,
  no declaration is signed for anybody, and every existing refusal of those verbs stands. Each is the Administrator's
  (`canManageRegistrations`), asserted here before anything is read and again by every verb underneath (BR-REQ-060-01).

  **The numbers** (§948, §1023): a number is never reissued and never moves. The runner's stays retired with the cancelled
  registration; as a volunteer the person draws the next V number at the confirmation («V007»), like every volunteer confirmed.
  The volunteer's V number stays retired with the cancelled row; as a runner the person draws a race number when they are
  confirmed. The two series never meet: a race number and a V number are compared with nothing of each other.

  **«Participă la tombolă» travels with the person** (§953, amending §948 and §949): somebody an organizer took out of the
  event's raffle is out of it on the other list too — the new row would otherwise start in, the column's default, and the
  person would be back on «Lista pentru tombolă» by a press that was about something else. Each way through the tick's own
  writer (`changeVolunteer`'s `setRaffle`, `raffle-mark.ts`'s `setRegistrationInRaffle`), in the same transaction, so the
  trail says it as it says every tick; nobody is told, and nothing else of either row moves but «Prezent» and a raffle sign-up (below).

  **«Prezent» travels one way** (§983): a runner the desk had checked in (`checked_in_at` set) is there, so the volunteer they
  become is ticked «Prezent» by the volunteers' own tick (`changeVolunteer`'s `setPresent`), in the same transaction and with its
  trail row — otherwise the new row would start absent, the column's default, and a press about something else would drop a
  person who is there from «Lista pentru tombolă — doar prezenții» (the §953 lesson). A volunteer turned runner carries nothing:
  checking a runner in is the desk's verb, with its own conditions — a confirmed registration, an event neither over nor
  cancelled — and the entry here makes a registration that waits or holds a place, which the desk does not check in.

  **A raffle sign-up travels both ways** (§984): where the event's raffle asks a sign-up of its own, the person's sign-up — the same
  row, its door and its acceptance of the same rules for the same event — moves to the row they become, in the same transaction
  (`raffle-entries.ts#moveRaffleEntry`), and the transform's own trail row names the entry's id. Otherwise the cancelled row would
  keep it and the new row would read «nu s-a înscris»: a press about something else would drop a person who signed up. A row the
  entry restarted that holds a sign-up already keeps its own.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** A runner under eighteen is not turned into a volunteer by one press: a minor volunteers only with a parent's agreement (§768). */
export const RUNNER_TO_VOLUNTEER_MINOR = "RUNNER_TO_VOLUNTEER_MINOR";
/** A volunteer the club typed without an address cannot be registered: a registration is its address. */
export const VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS = "VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS";

function assertAdministrator(actor: Actor, what: string): void {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not ${what}`);
}

/**
 * The entry's refusal of the role — not this event's — named by this press's own box: the hand entry posts the roles as
 * `assignedRoleIds`, this form one `roleId`.
 */
async function asRoleBox<R>(entry: () => Promise<R>): Promise<R> {
  try {
    return await entry();
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.some((field) => field === "assignedRoleIds" || field === "roleIds")) {
      throw new DomainError("VALIDATION_ERROR", "that role is not this event's", ["roleId"]);
    }
    throw error;
  }
}

export type RunnerToVolunteerInput = {
  registrationId: string;
  /** The role the Administrator gives the person: one of the event's (§837). A hand entry needs one, and so does this. */
  roleId: unknown;
  /** Why the registration ends, for its own trail («Anulată de echipă»): the page's sentence, never anything of the person. */
  reason: string;
  /**
   * The question's answer (§976): the person's two emails — «Înscriere anulată» and «Rolul tău de voluntar» — or, «… fără email», neither.
   * The freed place's offer to the first in line is that person's email, and always goes.
   */
  sendEmail?: boolean;
};

export type RunnerToVolunteerResult = {
  eventId: string;
  volunteerId: string;
  /** The V number the person drew at the confirmation (§1023): every event numbers its volunteers, so null only for a row that kept none. */
  volunteerNumber: number | null;
};

/**
 * «Transformă în voluntar» on a registration's page. One transaction, the event row locked first:
 *
 * 1. the registration is read under that lock and refused unless it can still be cancelled (a cancelled, expired or
 *    never-confirmed one is nobody to move: CONFLICT), is a real one (a test registration is nobody), and its person is
 *    eighteen on the event's day — a minor volunteers only with a parent's or guardian's agreement, which the volunteers'
 *    own entry asks for (`RUNNER_TO_VOLUNTEER_MINOR`);
 * 2. the person is entered on the event's volunteers by the staff entry (`changeVolunteer`, `add`): the registered name,
 *    the registration's address and telephone number, its language, the role given — and, only while the privacy notice in
 *    force names the volunteers' answers (§765), the date of birth, sex, city, the club-member tick and the shirt size
 *    the person gave for the same event. Never their place on a public list, which is the person's own tick (§821). An
 *    address already on the event's volunteers is that entry's refusal (`VOLUNTEER_ALREADY_LISTED`): cancel the
 *    registration alone;
 * 3. the person is confirmed, which draws their V number (§1023, amending §948) — and a runner an organizer had
 *    taken out of the raffle is taken out as a volunteer too (§953), and a runner the desk had checked in is ticked «Prezent»
 *    as a volunteer (§983), each by the volunteers' own tick;
 * 4. the person's raffle sign-up, when they hold one, moves to the volunteer (`moveRaffleEntry`, §984);
 * 5. the registration is cancelled by the staff verb (`cancelRegistrationByStaff`): through the allocator, with its own
 *    trail row — a printed bib named in it (§311);
 * 6. one row ties the two: `registration.became_volunteer`, ids only — the moved sign-up's among them.
 *
 * Any refusal writes nothing.
 */
export async function turnRunnerIntoVolunteer<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: RunnerToVolunteerInput,
  now: Date,
): Promise<RunnerToVolunteerResult> {
  assertAdministrator(actor, "turn a runner into a volunteer");
  if (!isUuid(input.registrationId)) throw new DomainError("NOT_FOUND", "no such registration");
  const roleId = typeof input.roleId === "string" ? input.roleId.trim() : "";
  if (!isUuid(roleId)) throw new DomainError("VALIDATION_ERROR", "choose the role the person takes", ["roleId"]);
  const sendEmail = input.sendEmail !== false;

  const found = await findRegistrationById(db, input.registrationId);
  if (!found) throw new DomainError("NOT_FOUND", "no such registration");
  // The volunteers' answers travel only under a notice that names them (§765): read before the lock, as the entry reads it.
  const profileDescribed = await noticeDescribesVolunteerProfile(db, now);

  const result = await db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, found.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    // Under the event's lock no state of this registration moves: what is read here is what is cancelled below.
    const registration = await findRegistrationById(tx, input.registrationId);
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    if (registration.kind === "TEST") throw new DomainError("VALIDATION_ERROR", "a test registration is nobody: it becomes no volunteer");
    if (!canTransition(registration.status, "CANCELLED")) {
      throw new DomainError("CONFLICT", `a registration in status ${registration.status} is not one a person runs on: nothing to turn into a volunteer`);
    }
    const eventDay = volunteerEventDay(event, now);
    const age = registration.birthDate ? volunteerAgeOn(registration.birthDate, eventDay) : null;
    if (isVolunteerMinor(age)) {
      throw new DomainError(RUNNER_TO_VOLUNTEER_MINOR, "a person under eighteen volunteers only with a parent's or guardian's agreement: enter them by hand");
    }

    const [person] = await tx.select({ email: participants.deliveryEmail }).from(participants).where(eq(participants.id, registration.participantId)).limit(1);
    const sex = sexShown(registration.sex);
    const city = (registration.city ?? "").trim();
    const added = await asRoleBox(() =>
      changeVolunteer(
        tx,
        actor,
        {
          kind: "add",
          eventId: registration.eventId,
          locale: registration.locale,
          fields: {
            assignedRoleIds: [roleId],
            name: registration.registeredName,
            email: person?.email ?? "",
            // The registration's own number when it is one a telephone can dial; anything else is left for «Modifică».
            phone: registration.phone && E164_PHONE.test(registration.phone) ? registration.phone : "",
            ...(profileDescribed
              ? {
                  // The date only when it gives an age the volunteers' box takes: a refusal here would be of a box nobody typed.
                  birthDate: age !== null && age >= VOLUNTEER_MINIMUM_AGE && age <= VOLUNTEER_AGE_MAX ? (registration.birthDate ?? "") : "",
                  sex: sex ?? "",
                  city: city.length <= VOLUNTEER_CITY_MAX ? city : "",
                  clubMember: registration.clubMemberDeclared,
                  shirtSize: (SHIRT_SIZES as readonly string[]).includes(registration.tshirtSize ?? "") ? registration.tshirtSize : "",
                }
              : {}),
          },
        },
        now,
        { sendEmail },
      ),
    );
    const volunteerId = added.volunteer.id;
    // Confirmed in the same press: the Administrator who gives the role is the organizers' yes, and the number is drawn here.
    await changeVolunteer(tx, actor, { kind: "setState", eventId: registration.eventId, id: volunteerId, state: "CONFIRMED" }, now, { sendEmail: false });
    // A runner taken out of the raffle is out of it as a volunteer too (§953): the row entered a moment ago holds the column's
    // default — in — so only a runner who was out is written, by the volunteers' own tick and with its trail row.
    if (!registration.inRaffle) {
      await changeVolunteer(tx, actor, { kind: "setRaffle", eventId: registration.eventId, id: volunteerId, inRaffle: false }, now);
    }
    // A runner the desk had checked in is there (§983): the row entered a moment ago starts absent, the column's default, so the
    // volunteers' own tick says «Prezent» — with its trail row — and the present-only raffle file keeps the person.
    if (registration.checkedInAt !== null) {
      await changeVolunteer(tx, actor, { kind: "setPresent", eventId: registration.eventId, id: volunteerId, present: true }, now);
    }
    // The runner's raffle sign-up is the volunteer's now (§984): the same row and acceptance, so nobody who signed up drops out.
    const raffleEntryId = await moveRaffleEntry(tx, { table: "registration", id: registration.id }, { table: "volunteer", id: volunteerId });
    await cancelRegistrationByStaff(tx, actor, registration.id, input.reason, now, { sendEmail });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: registration.participantId,
      action: "registration.became_volunteer",
      entityType: "registration",
      entityId: registration.id,
      metadata: { volunteerId, roleId, from: registration.status, ...(raffleEntryId ? { raffleEntryId } : {}) },
      now,
    });
    const [volunteer] = await tx.select({ volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.id, volunteerId)).limit(1);
    return { eventId: registration.eventId, volunteerId, volunteerNumber: volunteer?.volunteerNumber ?? null };
  });
  // The freed place is on every public page that counts places (§333): told again now that the cancellation has committed.
  revalidatePublicContent("places");
  return result;
}

export type VolunteerToRunnerInput = {
  eventId: string;
  volunteerId: string;
  /** The runner's two names, as the form asks them: the volunteers' list keeps one line, a registration two. */
  firstName: string;
  lastName: string;
  /** The relay tick (§33), binding: the entry is refused without it. */
  relayedByParticipantRequest: boolean;
};

export type VolunteerToRunnerResult = WaitlistEntryByStaffResult & { eventId: string; volunteerId: string };

/**
 * «Transformă în alergător» on a volunteer's page. One transaction, the event row locked first, then the volunteer's own
 * row — the order «Confirmă» takes them in (`changeVolunteer`):
 *
 * 1. a volunteer who is not there, or is another event's, is NOT_FOUND; a cancelled one is nobody to move (CONFLICT:
 *    reopen them first); one with no address cannot be registered (`VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS`);
 * 2. the person is entered by the official waiting list's own entry (`enterOnWaitlistByStaff`, §872): the address vouched
 *    for, the row through the one allocator under this same lock — a counted free place with the declaration to sign, or
 *    the back of the line — in the language the club already writes to them in, with that state's ordinary email. Every
 *    refusal of that entry stands: after the start, a full line, this person already on the address. The registration
 *    takes the volunteer's raffle tick (§953), by the registrations' own tick, and the volunteer's raffle sign-up when they
 *    hold one (`moveRaffleEntry`, §984);
 * 3. the volunteer is cancelled by the volunteers' own verb — the row, its roles and its number stay, retired; the role
 *    email a press queued a moment ago is withdrawn at the send, as for any cancelled person;
 * 4. one row ties the two: `volunteer.became_runner`, ids only — the moved sign-up's among them.
 *
 * Nothing of what the person told the organizers as a volunteer is copied onto the registration: its answers and its
 * declaration are the person's own, given from their link — the raffle tick is the organizers' mark, no answer of the
 * person's. Any refusal writes nothing.
 */
export async function turnVolunteerIntoRunner<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: VolunteerToRunnerInput,
  now: Date,
): Promise<VolunteerToRunnerResult> {
  assertAdministrator(actor, "turn a volunteer into a runner");
  if (!isUuid(input.eventId) || !isUuid(input.volunteerId)) throw new DomainError("NOT_FOUND", "the volunteer is not there");

  const result = await db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, input.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const [volunteer] = await tx
      .select({ id: eventVolunteers.id, state: eventVolunteers.state, email: eventVolunteers.email, locale: eventVolunteers.locale, inRaffle: eventVolunteers.inRaffle })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.id, input.volunteerId), eq(eventVolunteers.eventId, input.eventId)))
      .for("update")
      .limit(1);
    if (!volunteer) throw new DomainError("NOT_FOUND", "the volunteer is not there");
    if (volunteer.state === "CANCELLED") throw new DomainError("CONFLICT", "a cancelled volunteer is nobody to turn into a runner: reopen them first");
    if (volunteer.email === null) throw new DomainError(VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS, "a registration is its address: give the volunteer one first");

    const placed = await enterOnWaitlistByStaff(
      tx,
      actor,
      {
        eventId: input.eventId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: volunteer.email,
        // The language the club already writes to this person in: the page they signed up from, or the registration they came from.
        locale: volunteer.locale,
        relayedByParticipantRequest: input.relayedByParticipantRequest,
      },
      now,
    );
    // The volunteer's raffle tick is the registration's now (§953): out as a volunteer, out as a runner — and in again where
    // the entry restarted a registration of this person that an organizer had once taken out. The entry itself names no
    // raffle (neither the allocator nor the staff entry reads the column), so the registrations' own writer says it here:
    // a row that already holds the value is left alone and no trail row is written.
    await setRegistrationInRaffle(tx, actor, placed.registrationId, volunteer.inRaffle, now);
    // The volunteer's raffle sign-up is the registration's now (§984) — unless the row the entry restarted holds its own.
    const raffleEntryId = await moveRaffleEntry(tx, { table: "volunteer", id: volunteer.id }, { table: "registration", id: placed.registrationId });
    await changeVolunteer(tx, actor, { kind: "setState", eventId: input.eventId, id: volunteer.id, state: "CANCELLED" }, now, { sendEmail: false });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.became_runner",
      entityType: "event",
      entityId: input.eventId,
      metadata: { volunteerId: volunteer.id, registrationId: placed.registrationId, to: placed.status, ...(raffleEntryId ? { raffleEntryId } : {}) },
      now,
    });
    return { ...placed, eventId: input.eventId, volunteerId: volunteer.id };
  });
  // The place the entry took, when it took one, is on every public page that counts places (§333): told after the commit.
  revalidatePublicContent("places");
  return result;
}
