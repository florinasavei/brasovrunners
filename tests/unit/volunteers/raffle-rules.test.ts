import { describe, expect, it } from "vitest";
import {
  compareRaffleRows,
  foldName,
  RAFFLE_KINDS,
  RAFFLE_NUMBER_MAX,
  type RaffleGateFacts,
  type RaffleKind,
  type RafflePerson,
  type RaffleSettings,
  raffleKindOfRegistration,
  raffleNumberOf,
  raffleParticipation,
  raffleSettingsOf,
  raffleSignUpClosedFor,
  raffleSignUpEndsAt,
  typedNameMatches,
  typedNameOf,
} from "@/modules/volunteers/domain/raffle";

/**
 * §NNN — the raffle's rules, pure (the owner, 2026-11-18: «Vreau să pot bifa asta: tombolă din oficiu vs tombolă cu înscriere
 * separată», «trebuie să bifez acolo cine se poate înscrie: doar alergătorii și elitele și voluntarii», «vreau să văd în dreptul
 * fiecărei persoane dacă participă la tombolă»). BR-REQ-050-02 for the settings and the gate, BR-REQ-071-01 for who is in the file.
 *
 * - **The gate** (`raffleSignUpClosedFor`): every one of its conditions alone shuts it, in the order it asks them, and with all of
 *   them met it is open — for the group asked, or for any group when none is.
 * - **Who takes part** (`raffleParticipation`): one answer and one reason, for both modes and every group tick.
 * - **The form's matcher** (`typedNameMatches`): folded words, table-driven.
 */

const NOW = new Date("2026-11-20T10:00:00.000Z");

const ALL_GROUPS = { RUNNER: true, ELITE: true, VOLUNTEER: true } as const;

/** A raffle in the sign-up mode with its sign-ups open, every group ticked. */
const OPEN_SETTINGS: RaffleSettings = { hasRaffle: true, groups: ALL_GROUPS, signUp: true, signUpOpen: true };

/** Everything the gate reads, open: a published scheduled race tomorrow, the rules in force, the notice naming `{{raffle}}`. */
function openFacts(over: { settings?: Partial<RaffleSettings>; event?: Partial<RaffleGateFacts["event"]>; rulesInForce?: boolean; noticeDescribesRaffle?: boolean } = {}): RaffleGateFacts {
  return {
    settings: { ...OPEN_SETTINGS, ...over.settings },
    event: {
      type: "RACE",
      eventStatus: "SCHEDULED",
      editorialStatus: "PUBLISHED",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      endsAt: null,
      timezone: "Europe/Bucharest",
      ...over.event,
    },
    rulesInForce: over.rulesInForce ?? true,
    noticeDescribesRaffle: over.noticeDescribesRaffle ?? true,
  };
}

describe("§NNN BR-REQ-050-02 the one gate of the raffle's sign-up", () => {
  it("is open for a raffle in the sign-up mode, open, at a published scheduled race not ended, with the rules and the notice in force", () => {
    expect(raffleSignUpClosedFor(openFacts(), NOW)).toBeNull();
    for (const kind of RAFFLE_KINDS) expect(raffleSignUpClosedFor(openFacts(), NOW, kind), kind).toBeNull();
    expect(raffleSignUpClosedFor(openFacts(), NOW, ["RUNNER", "ELITE"])).toBeNull();
  });

  it("is shut by each condition alone, and says which — in the order it asks them", () => {
    const cases: Array<[string, RaffleGateFacts, string]> = [
      ["no raffle", openFacts({ settings: { hasRaffle: false } }), "noRaffle"],
      ["«Din oficiu»", openFacts({ settings: { signUp: false } }), "notSignUpMode"],
      ["sign-ups not open", openFacts({ settings: { signUpOpen: false } }), "signUpClosed"],
      ["a group run", openFacts({ event: { type: "GROUP_RUN" } }), "notARace"],
      ["a draft", openFacts({ event: { editorialStatus: "DRAFT" } }), "notPublished"],
      ["cancelled", openFacts({ event: { eventStatus: "CANCELLED" } }), "notScheduled"],
      ["no start", openFacts({ event: { startsAt: null } }), "ended"],
      ["ended", openFacts({ event: { startsAt: new Date("2026-11-19T07:00:00.000Z") } }), "ended"],
      ["no rules in force", openFacts({ rulesInForce: false }), "noRules"],
      ["a notice that does not name it", openFacts({ noticeDescribesRaffle: false }), "noNotice"],
      ["no group ticked", openFacts({ settings: { groups: { RUNNER: false, ELITE: false, VOLUNTEER: false } } }), "groupNotAllowed"],
    ];
    for (const [label, facts, why] of cases) expect(raffleSignUpClosedFor(facts, NOW), label).toBe(why);
    // The first condition missing is the one said: no raffle at all outranks everything after it.
    expect(raffleSignUpClosedFor(openFacts({ settings: { hasRaffle: false, signUp: false }, rulesInForce: false }), NOW)).toBe("noRaffle");
    expect(raffleSignUpClosedFor(openFacts({ settings: { signUpOpen: false }, rulesInForce: false, noticeDescribesRaffle: false }), NOW)).toBe("signUpClosed");
  });

  it("is open on race day after the start, until the event's end — its own, else the next midnight on its clock", () => {
    // The start passed this morning: the desk still signs people up.
    const raceDay = new Date("2026-11-21T12:00:00.000Z");
    expect(raffleSignUpClosedFor(openFacts(), raceDay)).toBeNull();
    // Midnight in Bucharest (UTC+2 in November) is 22:00 UTC the same day: shut from then on.
    expect(raffleSignUpEndsAt(openFacts().event)?.toISOString()).toBe("2026-11-21T22:00:00.000Z");
    expect(raffleSignUpClosedFor(openFacts(), new Date("2026-11-21T21:59:59.000Z"))).toBeNull();
    expect(raffleSignUpClosedFor(openFacts(), new Date("2026-11-21T22:00:00.000Z"))).toBe("ended");
    // An event with an end of its own ends there.
    const ends = new Date("2026-11-21T15:00:00.000Z");
    expect(raffleSignUpEndsAt({ ...openFacts().event, endsAt: ends })).toEqual(ends);
    expect(raffleSignUpClosedFor(openFacts({ event: { endsAt: ends } }), new Date("2026-11-21T15:00:00.000Z"))).toBe("ended");
    expect(raffleSignUpEndsAt({ startsAt: null, endsAt: null, timezone: "Europe/Bucharest" })).toBeNull();
  });

  it("asks the person's group: an unticked group is shut for its people and open for the others", () => {
    const noVolunteers = openFacts({ settings: { groups: { RUNNER: true, ELITE: true, VOLUNTEER: false } } });
    expect(raffleSignUpClosedFor(noVolunteers, NOW, "VOLUNTEER")).toBe("groupNotAllowed");
    expect(raffleSignUpClosedFor(noVolunteers, NOW, "RUNNER")).toBeNull();
    expect(raffleSignUpClosedFor(noVolunteers, NOW, "ELITE")).toBeNull();
    // Asked for any of several groups — the public form without «Sunt voluntar» — it is open while one of them is ticked.
    const onlyVolunteers = openFacts({ settings: { groups: { RUNNER: false, ELITE: false, VOLUNTEER: true } } });
    expect(raffleSignUpClosedFor(onlyVolunteers, NOW, ["RUNNER", "ELITE"])).toBe("groupNotAllowed");
    expect(raffleSignUpClosedFor(onlyVolunteers, NOW)).toBeNull();
  });

  it("reads the event row's columns as the settings: the three groups, «Cum», the open tick", () => {
    expect(raffleSettingsOf({ hasRaffle: true, raffleRunners: true, raffleElites: false, raffleVolunteers: true, raffleSignUp: true, raffleSignUpOpen: false })).toEqual({
      hasRaffle: true,
      groups: { RUNNER: true, ELITE: false, VOLUNTEER: true },
      signUp: true,
      signUpOpen: false,
    });
  });
});

/** A person the raffle takes in either mode: confirmed, with a number, not taken out — and, for the sign-up mode, signed up. */
const PERSON: RafflePerson = { kind: "RUNNER", confirmed: true, hasNumber: true, inRaffle: true, signedUp: true };

describe("§NNN BR-REQ-071-01 who takes part, and why not — one answer for both modes", () => {
  it("is «in» for a confirmed person with a number of a ticked group, not taken out, in both modes — signed up in the sign-up mode", () => {
    for (const kind of RAFFLE_KINDS) {
      expect(raffleParticipation({ ...PERSON, kind }, { groups: ALL_GROUPS, signUp: false }), kind).toBe("in");
      expect(raffleParticipation({ ...PERSON, kind }, { groups: ALL_GROUPS, signUp: true }), kind).toBe("in");
    }
  });

  it("«Din oficiu» is the file as before for the ticked groups: a sign-up neither adds nor is asked", () => {
    expect(raffleParticipation({ ...PERSON, signedUp: false }, { groups: ALL_GROUPS, signUp: false })).toBe("in");
  });

  it("«Cu înscriere separată» takes only those who signed up", () => {
    expect(raffleParticipation({ ...PERSON, signedUp: false }, { groups: ALL_GROUPS, signUp: true })).toBe("notSignedUp");
  });

  it("the group ticks decide in both modes, each group alone", () => {
    for (const signUp of [false, true]) {
      for (const unticked of RAFFLE_KINDS) {
        const groups = { ...ALL_GROUPS, [unticked]: false } as Record<RaffleKind, boolean>;
        for (const kind of RAFFLE_KINDS) {
          expect(raffleParticipation({ ...PERSON, kind }, { groups, signUp }), `${signUp ? "sign-up" : "automatic"} · ${unticked} unticked · ${kind}`).toBe(
            kind === unticked ? "groupNotAllowed" : "in",
          );
        }
      }
    }
  });

  it("says the first thing that keeps a person out: the group, the state, the number, the organizers' exclusion, the sign-up", () => {
    const settings = { groups: { ...ALL_GROUPS, RUNNER: false }, signUp: true };
    const nobody: RafflePerson = { kind: "RUNNER", confirmed: false, hasNumber: false, inRaffle: false, signedUp: false };
    expect(raffleParticipation(nobody, settings)).toBe("groupNotAllowed");
    expect(raffleParticipation(nobody, { ...settings, groups: ALL_GROUPS })).toBe("notConfirmed");
    expect(raffleParticipation({ ...nobody, confirmed: true }, { ...settings, groups: ALL_GROUPS })).toBe("noNumber");
    expect(raffleParticipation({ ...nobody, confirmed: true, hasNumber: true }, { ...settings, groups: ALL_GROUPS })).toBe("takenOut");
    expect(raffleParticipation({ ...nobody, confirmed: true, hasNumber: true, inRaffle: true }, { ...settings, groups: ALL_GROUPS })).toBe("notSignedUp");
  });

  it("keeps the organizers' exclusion in both modes: a person taken out is out though signed up", () => {
    expect(raffleParticipation({ ...PERSON, inRaffle: false }, { groups: ALL_GROUPS, signUp: false })).toBe("takenOut");
    expect(raffleParticipation({ ...PERSON, inRaffle: false, signedUp: true }, { groups: ALL_GROUPS, signUp: true })).toBe("takenOut");
  });

  it("files a registration marked «Elită» with the elites, and every other — an ambassador's too — with the runners", () => {
    expect(raffleKindOfRegistration({ elite: true })).toBe("ELITE");
    expect(raffleKindOfRegistration({ elite: false })).toBe("RUNNER");
  });

  it("orders the rows by the number, then the numberless lines of the elite list by name", () => {
    const rows = [
      { number: null, name: "Zoe Elita", kind: "ELITE" as const },
      { number: 12, name: "Radu", kind: "RUNNER" as const },
      { number: null, name: "Ana Elita", kind: "ELITE" as const },
      { number: 3, name: "Ion", kind: "VOLUNTEER" as const },
      { number: 3, name: "Ana", kind: "RUNNER" as const },
    ];
    expect([...rows].sort(compareRaffleRows).map((row) => `${row.number ?? "—"} ${row.name}`)).toEqual(["3 Ana", "3 Ion", "12 Radu", "— Ana Elita", "— Zoe Elita"]);
  });
});

describe("§NNN BR-REQ-050-02 the public form's matcher: the typed name against the registered one, folded", () => {
  it.each([
    // [typed, registered, matches]
    ["Ana Popescu", "Ana Popescu", true],
    ["ana popescu", "Ana Popescu", true],
    ["  ANA   POPESCU ", "Ana Popescu", true],
    ["Popescu Ana", "Ana Popescu", true],
    ["Ana Popescu", "Ana Maria Popescu", true],
    ["Ana-Maria Popescu", "Ana Maria Popescu", true],
    ["Ana Maria Popescu", "Ana-Maria Popescu", true],
    ["Stefan Tanase", "Ștefan Tănase", true],
    ["ştefan tănase", "Ștefan Tănase", true],
    ["Ioana O'Neil", "Ioana ONeil", false],
    ["Ioana O Neil", "Ioana O'Neil", true],
    ["Ion", "Ion", true],
    ["ion", "Ion", true],
    // Fewer than two words for a name of two or more.
    ["Popescu", "Ana Popescu", false],
    ["Ana", "Ana Popescu", false],
    // A word the registered name does not hold.
    ["Ana Ionescu", "Ana Popescu", false],
    ["Ana Popescu Ionescu", "Ana Popescu", false],
    ["Ion Pop", "Ion", false],
    // A word used twice where the name holds it once.
    ["Ana Ana", "Ana Popescu", false],
    // A prefix is not a word.
    ["An Popescu", "Ana Popescu", false],
    // Nothing typed, or only punctuation.
    ["", "Ana Popescu", false],
    [" - . ", "Ana Popescu", false],
    ["Ana Popescu", "", false],
  ])("«%s» against «%s» → %s", (typed, registered, matches) => {
    expect(typedNameMatches(typed, registered)).toBe(matches);
  });

  it("folds case, diacritics, punctuation and spaces alike", () => {
    expect(foldName("  Ștefan-Ţăranu  O'Brien. ")).toBe("stefan taranu o brien");
    expect(foldName("ŞTEFAN ȚĂRANU")).toBe(foldName("ștefan țăranu"));
    expect(foldName("Îmi Âna")).toBe("imi ana");
  });

  it("keeps the name as typed — trimmed, the inner spaces collapsed, never folded", () => {
    expect(typedNameOf("  Ana   Maria\tPopescu ")).toBe("Ana Maria Popescu");
    expect(typedNameOf("Ștefan")).toBe("Ștefan");
  });

  it("takes a race or volunteer number of digits only, from 1 to the highest a bib draws", () => {
    expect(raffleNumberOf("12")).toBe(12);
    expect(raffleNumberOf(" 007 ")).toBe(7);
    expect(raffleNumberOf(String(RAFFLE_NUMBER_MAX))).toBe(RAFFLE_NUMBER_MAX);
    for (const refused of ["", "0", "-3", "1.5", "12a", "١٢", "100000", "1 2", "+7"]) expect(raffleNumberOf(refused), refused).toBeNull();
  });
});
