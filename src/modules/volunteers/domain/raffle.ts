import { nextMidnightIn } from "@/i18n/dates";

/*
  The raffle's rules, pure (§NNN; the owner, 2026-11-18: «Vreau să pot bifa asta: tombolă din oficiu vs tombolă cu înscriere
  separată», «trebuie să bifez acolo cine se poate înscrie: doar alergătorii și elitele și voluntarii» and «vreau să văd în dreptul
  fiecărei persoane dacă participă la tombolă»). No clock but the one passed in, no database: every door, page, list, file and
  count reads these few functions, so the screen that says «Participă: Da» and the file the draw is made from cannot disagree.

  - **The three groups** (`RaffleKind`): `RUNNER` — a registration not marked «Elită» (an ambassador runs as a runner); `ELITE` — a
    registration marked «Elită» (§897) and a line of the race's elite list (§895); `VOLUNTEER` — an event's volunteer (§754).
  - **The settings** (`RaffleSettings`): «Avem tombolă», the three ticks of «Cine poate participa», «Cum» — «Din oficiu» or «Cu
    înscriere separată» — and «Înscrierile la tombolă sunt deschise».
  - **The gate** (`raffleSignUpClosedFor`): whether a sign-up may be taken now, and why not.
  - **Who takes part** (`raffleParticipation`): one answer and its reason, for both modes.
  - **The public form's matcher** (`typedNameMatches`): a typed name against the registered one, folded.
*/

/** The raffle's three groups, in the order the screens and the files say them. */
export const RAFFLE_KINDS = ["RUNNER", "ELITE", "VOLUNTEER"] as const;
export type RaffleKind = (typeof RAFFLE_KINDS)[number];

export function isRaffleKind(value: unknown): value is RaffleKind {
  return typeof value === "string" && (RAFFLE_KINDS as readonly string[]).includes(value);
}

/** «Cine poate participa»: each group ticked or not. */
export type RaffleGroups = Readonly<Record<RaffleKind, boolean>>;

/** An event's raffle as its editor sets it. */
export type RaffleSettings = {
  /** «Avem tombolă» (§949). */
  hasRaffle: boolean;
  /** «Cine poate participa»: every group ticked by default. */
  groups: RaffleGroups;
  /** «Cum»: false «Din oficiu», true «Cu înscriere separată». */
  signUp: boolean;
  /** «Înscrierile la tombolă sunt deschise»: read in the sign-up mode only. */
  signUpOpen: boolean;
};

/** The event row's raffle columns (`events.has_raffle`, `raffle_*`), as the schema names them. */
export type RaffleSettingsRow = {
  hasRaffle: boolean;
  raffleRunners: boolean;
  raffleElites: boolean;
  raffleVolunteers: boolean;
  raffleSignUp: boolean;
  raffleSignUpOpen: boolean;
};

export function raffleSettingsOf(row: RaffleSettingsRow): RaffleSettings {
  return {
    hasRaffle: row.hasRaffle,
    groups: { RUNNER: row.raffleRunners, ELITE: row.raffleElites, VOLUNTEER: row.raffleVolunteers },
    signUp: row.raffleSignUp,
    signUpOpen: row.raffleSignUpOpen,
  };
}

/** A registration's group: «Elită» is the elites', every other registration — an ambassador's too — the runners'. */
export function raffleKindOfRegistration(registration: { elite: boolean }): RaffleKind {
  return registration.elite ? "ELITE" : "RUNNER";
}

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

/** The event's own facts the gate reads. */
export type RaffleGateEvent = {
  type: string;
  eventStatus: string;
  editorialStatus: string;
  startsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
};

/** Everything the gate decides from: the event's settings and facts, and the two legal texts. */
export type RaffleGateFacts = {
  settings: RaffleSettings;
  event: RaffleGateEvent;
  /** «Regulamentul tombolei» in force in every language (`raffleRulesInForce`). */
  rulesInForce: boolean;
  /** The privacy notice in force names `{{raffle}}` in every language (`noticeDescribesRaffle`). */
  noticeDescribesRaffle: boolean;
};

/** Why the sign-up is shut, in the order the gate asks. */
export type RaffleGateClosed =
  | "noRaffle"
  | "notSignUpMode"
  | "signUpClosed"
  | "notARace"
  | "notPublished"
  | "notScheduled"
  | "ended"
  | "noRules"
  | "noNotice"
  | "groupNotAllowed";

/**
 * When the sign-up ends with the event (§NNN): its own end, else the next midnight after its start day on its own clock — the
 * race-day desk signs people up after the start, so the start itself does not close it (`address-change.ts#eventEndForMove`'s
 * reading). Null for an event with no start.
 */
export function raffleSignUpEndsAt(event: Pick<RaffleGateEvent, "startsAt" | "endsAt" | "timezone">): Date | null {
  if (event.endsAt) return event.endsAt;
  return event.startsAt ? nextMidnightIn(event.startsAt, event.timezone) : null;
}

/**
 * The one rule every door, page and action reads (§NNN): null while a sign-up may be taken, else why not. The sign-up opens only
 * for **a raffle** («Avem tombolă»), **in the sign-up mode** («Cu înscriere separată»), **while the sign-ups are open**, at **a
 * published, scheduled race not ended**, while **«Regulamentul tombolei» is in force** and **the privacy notice in force names
 * `{{raffle}}`** — both in every language — and for **a group ticked** in «Cine poate participa»: the person's own `kind`, or,
 * asked without one (a page that serves several), any of `kinds` (every group by default). Closed, no door is drawn and every
 * action refuses, writing nothing.
 */
export function raffleSignUpClosedFor(facts: RaffleGateFacts, now: Date, kind?: RaffleKind | readonly RaffleKind[]): RaffleGateClosed | null {
  const { settings, event } = facts;
  if (!settings.hasRaffle) return "noRaffle";
  if (!settings.signUp) return "notSignUpMode";
  if (!settings.signUpOpen) return "signUpClosed";
  if (event.type !== "RACE") return "notARace";
  if (event.editorialStatus !== "PUBLISHED") return "notPublished";
  if (event.eventStatus !== "SCHEDULED") return "notScheduled";
  const ends = raffleSignUpEndsAt(event);
  if (!ends || ends.getTime() <= now.getTime()) return "ended";
  if (!facts.rulesInForce) return "noRules";
  if (!facts.noticeDescribesRaffle) return "noNotice";
  const asked: readonly RaffleKind[] = kind === undefined ? RAFFLE_KINDS : typeof kind === "string" ? [kind] : kind;
  if (!asked.some((one) => settings.groups[one])) return "groupNotAllowed";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Who takes part
// ---------------------------------------------------------------------------------------------

/** The answer for one person, and why: `in`, or the first thing that keeps them out. */
export type RaffleReason = "in" | "groupNotAllowed" | "notConfirmed" | "noNumber" | "takenOut" | "notSignedUp";

/** What the answer reads of one person, whatever table they come from. */
export type RafflePerson = {
  kind: RaffleKind;
  /**
   * In the state the raffle takes: a registration confirmed and real (a test one is in no count the club is given, §30), a volunteer
   * confirmed; a line of the elite list always (it has no state).
   */
  confirmed: boolean;
  /** Wears a number: a registration's race number, a volunteer's own (§948). A line of the elite list takes part by name: always true. */
  hasNumber: boolean;
  /** «Participă la tombolă»: not taken out by the organizers (§949; a line's own tick, §NNN). */
  inRaffle: boolean;
  /** Signed up (`event_raffle_entries`): read in the sign-up mode only. */
  signedUp: boolean;
};

/**
 * Whether a person takes part in the event's raffle, and the reason (§NNN) — the one function the files (whole and present-only),
 * the counts, the «Tombolă» tab, the lists' «Tombolă» columns, the person's pages and the desk read. In the order a person is told:
 * the group ticked in «Cine poate participa» (both modes), the state, the number, the organizers' exclusion, and — only «Cu
 * înscriere separată» — the sign-up. «Din oficiu» is §949's file for the ticked groups: everybody confirmed with a number and not
 * taken out. Presence is no condition here: «Doar prezenții» is a second file over the same answer.
 */
export function raffleParticipation(person: RafflePerson, settings: Pick<RaffleSettings, "groups" | "signUp">): RaffleReason {
  if (!settings.groups[person.kind]) return "groupNotAllowed";
  if (!person.confirmed) return "notConfirmed";
  if (!person.hasNumber) return "noNumber";
  if (!person.inRaffle) return "takenOut";
  if (settings.signUp && !person.signedUp) return "notSignedUp";
  return "in";
}

/** A row of the raffle's files and tab, in the order they are read: the numbers rising, then the numberless lines by name (§NNN). */
export function compareRaffleRows(a: { number: number | null; name: string; kind: RaffleKind }, b: { number: number | null; name: string; kind: RaffleKind }): number {
  if (a.number !== null && b.number !== null) return a.number - b.number || RAFFLE_KINDS.indexOf(a.kind) - RAFFLE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, "ro");
  if (a.number !== null) return -1;
  if (b.number !== null) return 1;
  return a.name.localeCompare(b.name, "ro") || RAFFLE_KINDS.indexOf(a.kind) - RAFFLE_KINDS.indexOf(b.kind);
}

// ---------------------------------------------------------------------------------------------
// The public form's matcher
// ---------------------------------------------------------------------------------------------

/** The highest number the form takes: five digits, as a bib draws (`ELITE_NUMBER_MAX`). */
export const RAFFLE_NUMBER_MAX = 99_999;

/**
 * A name as the matcher compares it (§NNN): lower case, the diacritics gone (ș and ş alike are s, ă and â are a), every
 * punctuation mark — a hyphen, an apostrophe, a dot — a space, the spaces collapsed and the ends trimmed.
 */
export function foldName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("ro")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A folded name's words. */
export function nameWords(value: string): string[] {
  const folded = foldName(value);
  return folded === "" ? [] : folded.split(" ");
}

/**
 * Whether a name typed on the public form names the registered person (§NNN): both folded (`foldName`), **every typed word is one
 * of the registered name's words** — each used once, so «Ana Ana» is not «Ana Popescu» — and **at least two words are typed**,
 * unless the registered name has only one. «Popescu Ana», «ana popescu» and «Ana-Maria Popescu» for «Ana Maria Popescu» match;
 * «Popescu» alone, «Ana Ionescu» and an empty box do not. The order does not matter: people write their names both ways.
 */
export function typedNameMatches(typed: string, registered: string): boolean {
  const typedWords = nameWords(typed);
  const registeredWords = nameWords(registered);
  if (typedWords.length === 0 || registeredWords.length === 0) return false;
  if (registeredWords.length >= 2 && typedWords.length < 2) return false;
  const left = [...registeredWords];
  for (const word of typedWords) {
    const at = left.indexOf(word);
    if (at === -1) return false;
    left.splice(at, 1);
  }
  return true;
}

/** The name as the form keeps it: trimmed, inner spaces collapsed — as typed, never folded. */
export function typedNameOf(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The race or volunteer number as typed: a whole number from 1 to `RAFFLE_NUMBER_MAX`, digits only (spaces around allowed); else null. */
export function raffleNumberOf(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= 1 && number <= RAFFLE_NUMBER_MAX ? number : null;
}
