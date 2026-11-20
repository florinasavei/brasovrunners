import { describe, expect, it } from "vitest";
import { VOLUNTEER_RAFFLE_GUARDIAN_WAYS } from "@/db/schema/event-volunteers";
import {
  isRaffleGuardianWay,
  RAFFLE_GUARDIAN_FIELDS,
  RAFFLE_GUARDIAN_WAYS,
  type RaffleGateClosed,
  type RafflePerson,
  type RaffleSettings,
  raffleConfirmationOffered,
  raffleConfirmed,
  raffleGuardianRecord,
  raffleParticipation,
  type VolunteerRaffleFacts,
  volunteerConfirmedForRaffle,
} from "@/modules/volunteers/domain/raffle";
import { isVolunteerMinor } from "@/modules/volunteers/domain/volunteer";
import { raffleEligible } from "@/modules/volunteers/raffle-roster";

/**
 * §1028 (amending §984 and §1023), BR-REQ-071-01 — «Confirmă pentru tombolă», the pure half. The owner, 2026-11-20, the day before the
 * race, of a volunteer of seventeen whose parents' volunteering agreement was still missing: «vreau să pot să o confirm și pe [ea]
 * pentru tombolă, chiar și fără acordul părinților». The approved «Regulamentul tombolei»: «Un participant minor se înscrie cu acordul
 * părintelui sau al tutorelui său.»
 *
 * - **Eligibility**: a volunteer takes part when confirmed (as before) **or confirmed for the raffle alone**, and holding a V number —
 *   `raffleConfirmed` at `raffleParticipation`'s second step and in `raffleEligible`, every door's condition; the reasons after it
 *   (no number, taken out, not signed up) stand as they were.
 * - **The minor's rule**: a confirmation for the raffle counts for a minor only with the parent's or guardian's agreement recorded,
 *   and the press records it only with the box ticked and one of the three ways (`raffleGuardianRecord`); an adult is asked nothing.
 * - **A cancelled volunteer** takes part in nothing, whatever was recorded.
 * - **When the press is offered** (`raffleConfirmationOffered`).
 */

const SETTINGS: RaffleSettings = { hasRaffle: true, groups: { RUNNER: true, ELITE: true, VOLUNTEER: true }, signUp: false, signUpOpen: false };
const AT = new Date("2026-11-21T07:30:00.000Z");

/** A volunteer as the raffle reads them, «Înscris» with no confirmation for the raffle unless told otherwise. */
const facts = (over: Partial<VolunteerRaffleFacts> = {}): VolunteerRaffleFacts => ({ state: "REGISTERED", minor: false, raffleConfirmedAt: null, raffleGuardianAgreed: null, ...over });

const person = (over: Partial<RafflePerson> = {}): RafflePerson => ({ kind: "VOLUNTEER", confirmed: false, hasNumber: true, inRaffle: true, signedUp: false, ...over });

describe("§1028 BR-REQ-071-01 a volunteer confirmed for the raffle alone takes part, with a V number", () => {
  it("is confirmed at the answer's second step — the reasons after it unchanged", () => {
    expect(raffleParticipation(person(), SETTINGS)).toBe("notConfirmed");
    expect(raffleParticipation(person({ confirmedForRaffle: true }), SETTINGS)).toBe("in");
    // A volunteer's «Confirmă» as before.
    expect(raffleParticipation(person({ confirmed: true }), SETTINGS)).toBe("in");
    // The group first, then the number, the organizers' exclusion and the sign-up — as for anybody confirmed.
    expect(raffleParticipation(person({ confirmedForRaffle: true }), { ...SETTINGS, groups: { ...SETTINGS.groups, VOLUNTEER: false } })).toBe("groupNotAllowed");
    expect(raffleParticipation(person({ confirmedForRaffle: true, hasNumber: false }), SETTINGS)).toBe("noNumber");
    expect(raffleParticipation(person({ confirmedForRaffle: true, inRaffle: false }), SETTINGS)).toBe("takenOut");
    expect(raffleParticipation(person({ confirmedForRaffle: true }), { ...SETTINGS, signUp: true })).toBe("notSignedUp");
    expect(raffleParticipation(person({ confirmedForRaffle: true, signedUp: true }), { ...SETTINGS, signUp: true })).toBe("in");
  });

  it("is eligible for every door — confirmed either way and holding a number — and never without the number", () => {
    expect(raffleConfirmed({ confirmed: false })).toBe(false);
    expect(raffleConfirmed({ confirmed: false, confirmedForRaffle: false })).toBe(false);
    expect(raffleConfirmed({ confirmed: false, confirmedForRaffle: true })).toBe(true);
    expect(raffleConfirmed({ confirmed: true })).toBe(true);
    expect(raffleEligible({ kind: "VOLUNTEER", confirmed: false, confirmedForRaffle: true, hasNumber: true, inRaffle: true })).toBe(true);
    expect(raffleEligible({ kind: "VOLUNTEER", confirmed: false, confirmedForRaffle: true, hasNumber: false, inRaffle: true })).toBe(false);
    expect(raffleEligible({ kind: "VOLUNTEER", confirmed: false, hasNumber: true, inRaffle: true })).toBe(false);
    // A registration and a line of the elite list are read as before.
    expect(raffleEligible({ kind: "RUNNER", confirmed: true, hasNumber: true, inRaffle: true })).toBe(true);
    expect(raffleEligible({ kind: "RUNNER", confirmed: false, hasNumber: true, inRaffle: true })).toBe(false);
  });
});

describe("§1028 the minor's rule: the parent's or guardian's agreement, and how", () => {
  it("counts a confirmation for the raffle of an adult, of a minor only with the parent's agreement — and of a cancelled person never", () => {
    expect(volunteerConfirmedForRaffle(facts())).toBe(false);
    expect(volunteerConfirmedForRaffle(facts({ raffleConfirmedAt: AT }))).toBe(true);
    expect(volunteerConfirmedForRaffle(facts({ minor: true, raffleConfirmedAt: AT, raffleGuardianAgreed: true }))).toBe(true);
    // An adult's confirmation, the date of birth corrected since to a minor's: it counts no longer, and the press is offered again.
    expect(volunteerConfirmedForRaffle(facts({ minor: true, raffleConfirmedAt: AT }))).toBe(false);
    expect(volunteerConfirmedForRaffle(facts({ minor: true, raffleConfirmedAt: AT, raffleGuardianAgreed: false }))).toBe(false);
    // A cancelled volunteer takes part in nothing; one confirmed as a volunteer since keeps the record, read beside the state.
    expect(volunteerConfirmedForRaffle(facts({ state: "CANCELLED", raffleConfirmedAt: AT }))).toBe(false);
    expect(volunteerConfirmedForRaffle(facts({ state: "CONFIRMED", raffleConfirmedAt: AT }))).toBe(true);
  });

  it("asks a minor the box ticked — a real `true` — and one of the three ways, naming what is missing; an adult nothing", () => {
    expect(raffleGuardianRecord({ minor: false, agreed: false, way: "" })).toEqual({ ok: true, agreed: null, way: null });
    // Whatever a form posts for an adult, nothing of a parent is recorded.
    expect(raffleGuardianRecord({ minor: false, agreed: true, way: "PHONE" })).toEqual({ ok: true, agreed: null, way: null });
    for (const way of RAFFLE_GUARDIAN_WAYS) expect(raffleGuardianRecord({ minor: true, agreed: true, way })).toEqual({ ok: true, agreed: true, way });
    expect(raffleGuardianRecord({ minor: true, agreed: false, way: "PHONE" })).toEqual({ ok: false, missing: [RAFFLE_GUARDIAN_FIELDS.agreed] });
    expect(raffleGuardianRecord({ minor: true, agreed: true, way: "" })).toEqual({ ok: false, missing: [RAFFLE_GUARDIAN_FIELDS.way] });
    expect(raffleGuardianRecord({ minor: true, agreed: undefined, way: undefined })).toEqual({ ok: false, missing: ["raffleGuardianAgreed", "raffleGuardianWay"] });
    // A forged post: a truthy string is no tick, a way outside the three no way.
    expect(raffleGuardianRecord({ minor: true, agreed: "on", way: "PHONE" })).toEqual({ ok: false, missing: ["raffleGuardianAgreed"] });
    for (const junk of ["phone", "EMAIL", "PHONE ", 1, null, ["PHONE"]]) expect(raffleGuardianRecord({ minor: true, agreed: true, way: junk }), String(junk)).toEqual({ ok: false, missing: ["raffleGuardianWay"] });
  });

  it("has the three ways the table's CHECK holds, in the dialog's order", () => {
    expect(RAFFLE_GUARDIAN_WAYS).toEqual(["PHONE", "IN_PERSON", "WRITING"]);
    expect([...RAFFLE_GUARDIAN_WAYS]).toEqual([...VOLUNTEER_RAFFLE_GUARDIAN_WAYS]);
    for (const way of RAFFLE_GUARDIAN_WAYS) expect(isRaffleGuardianWay(way)).toBe(true);
    for (const junk of ["", "phone", "PAPER", "LINK", undefined, null, 0]) expect(isRaffleGuardianWay(junk)).toBe(false);
  });

  it("decides a minor by the age «Acordul părintelui lipsește» is decided by: under eighteen on the event's day", () => {
    expect(isVolunteerMinor(17)).toBe(true);
    expect(isVolunteerMinor(14)).toBe(true);
    expect(isVolunteerMinor(18)).toBe(false);
    expect(isVolunteerMinor(null)).toBe(false);
  });
});

describe("§1028 when «Confirmă pentru tombolă» is offered", () => {
  const offered = (volunteer: Partial<VolunteerRaffleFacts & { inRaffle: boolean }> = {}, settings: Partial<RaffleSettings> = {}, gateClosed: RaffleGateClosed | null = null) =>
    raffleConfirmationOffered({ volunteer: { ...facts(), inRaffle: true, ...volunteer }, settings: { ...SETTINGS, ...settings }, gateClosed });

  it("to a volunteer «Înscris» of a raffle that takes its volunteers, not taken out and not confirmed for it yet", () => {
    expect(offered()).toBe(true);
    expect(offered({ minor: true })).toBe(true);
    // A minor's confirmation without the parent's agreement counts for nothing: offered again.
    expect(offered({ minor: true, raffleConfirmedAt: AT })).toBe(true);
    expect(offered({ raffleConfirmedAt: AT })).toBe(false);
    expect(offered({ minor: true, raffleConfirmedAt: AT, raffleGuardianAgreed: true })).toBe(false);
    expect(offered({ state: "CONFIRMED" })).toBe(false);
    expect(offered({ state: "CANCELLED" })).toBe(false);
    // Taken out by the organizers: «Pune înapoi» first.
    expect(offered({ inRaffle: false })).toBe(false);
    expect(offered({}, { hasRaffle: false })).toBe(false);
    expect(offered({}, { groups: { ...SETTINGS.groups, VOLUNTEER: false } })).toBe(false);
  });

  it("«Cu înscriere separată» only while the gate takes volunteers: the press signs the person up too", () => {
    expect(offered({}, { signUp: true, signUpOpen: true }, null)).toBe(true);
    for (const closed of ["signUpClosed", "noRules", "noNotice", "ended", "groupNotAllowed"] as const) expect(offered({}, { signUp: true }, closed), closed).toBe(false);
    // «Din oficiu» asks no gate: nobody signs up.
    expect(offered({}, { signUp: false }, "notSignUpMode")).toBe(true);
  });
});
