import { nextMidnightIn } from "@/i18n/dates";
import { formatRaceNumber, type RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { formatVolunteerNumber } from "./volunteer-number";

/*
  The raffle's rules, pure (§984; the owner, 2026-11-18: «Vreau să pot bifa asta: tombolă din oficiu vs tombolă cu înscriere
  separată», «trebuie să bifez acolo cine se poate înscrie: doar alergătorii și elitele și voluntarii» and «vreau să văd în dreptul
  fiecărei persoane dacă participă la tombolă»). No clock but the one passed in, no database: every door, page, list, file and
  count reads these few functions, so the screen that says «Participă: Da» and the file the draw is made from cannot disagree.

  - **The three groups** (`RaffleKind`): `RUNNER` — a registration not marked «Elită» (one marked «Ambasador» runs as a runner); `ELITE` — a
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

/** The row's raffle columns, in the editor's order: «Avem tombolă», «Cine poate participa», «Cum», «… sunt deschise». */
const RAFFLE_SETTINGS_COLUMNS = ["hasRaffle", "raffleRunners", "raffleElites", "raffleVolunteers", "raffleSignUp", "raffleSignUpOpen"] as const satisfies readonly (keyof RaffleSettingsRow)[];

/**
 * Whether a save moved any of the raffle's settings (§NNN): the editor's «Tombolă» fold opens by itself right after such a save, so
 * what was saved is in sight — as the race numbers' card opens after a press inside it (§895). A save that wrote none of them, or
 * wrote them as they were, moved nothing.
 */
export function raffleSettingsMoved(before: RaffleSettingsRow, after: RaffleSettingsRow): boolean {
  return RAFFLE_SETTINGS_COLUMNS.some((column) => before[column] !== after[column]);
}

/**
 * Whether the event's raffle asks a sign-up of its own (§984): «Avem tombolă» and «Cu înscriere separată», open or not. What the
 * raffle's page asks before it says the thank-you to a person reading the answer to their own post — never on an event that asks none.
 */
export function raffleAsksSignUp(settings: Pick<RaffleSettings, "hasRaffle" | "signUp">): boolean {
  return settings.hasRaffle && settings.signUp;
}

/** A registration's group: «Elită» is the elites', every other registration — one marked «Ambasador» too — the runners'. */
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
 * When the sign-up ends with the event (§984): its own end, else the next midnight after its start day on its own clock — the
 * race-day desk signs people up after the start, so the start itself does not close it (`address-change.ts#eventEndForMove`'s
 * reading). Null for an event with no start.
 */
export function raffleSignUpEndsAt(event: Pick<RaffleGateEvent, "startsAt" | "endsAt" | "timezone">): Date | null {
  if (event.endsAt) return event.endsAt;
  return event.startsAt ? nextMidnightIn(event.startsAt, event.timezone) : null;
}

/**
 * The one rule every door, page and action reads (§984): null while a sign-up may be taken, else why not. The sign-up opens only
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
  /**
   * Wears a number: a registration's race number, a volunteer's V number (§NNN, amending §948 — every confirmed volunteer has one,
   * drawn by itself at the confirmation). A line of the elite list takes part by name: always true.
   */
  hasNumber: boolean;
  /** «Participă la tombolă»: not taken out by the organizers (§949; a line's own tick, §984). */
  inRaffle: boolean;
  /** Signed up (`event_raffle_entries`): read in the sign-up mode only. */
  signedUp: boolean;
};

/**
 * Whether a person takes part in the event's raffle, and the reason (§984) — the one function the files (whole and present-only),
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

/**
 * Which block of the raffle's order a row falls in (§NNN): a race number — a registration's or an elite line's, one series — first,
 * then a volunteer's V number — a series of its own, never compared with a race number — then whoever has no number.
 */
function raffleBlockOf(row: { number: number | null; kind: RaffleKind }): 0 | 1 | 2 {
  if (row.number === null) return 2;
  return row.kind === "VOLUNTEER" ? 1 : 0;
}

/**
 * A row of the raffle's files and tab, in the order they are read (§NNN, amending §984): the race numbers rising — runners and elites
 * together, one series —, then the volunteers by their V number rising (V001, V002, …), then the numberless lines by name. The two
 * series are never interleaved: a volunteer's 1 is «V001», not a race number 1.
 */
export function compareRaffleRows(a: { number: number | null; name: string; kind: RaffleKind }, b: { number: number | null; name: string; kind: RaffleKind }): number {
  const block = raffleBlockOf(a) - raffleBlockOf(b);
  if (block !== 0) return block;
  if (a.number !== null && b.number !== null) return a.number - b.number || RAFFLE_KINDS.indexOf(a.kind) - RAFFLE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, "ro");
  return a.name.localeCompare(b.name, "ro") || RAFFLE_KINDS.indexOf(a.kind) - RAFFLE_KINDS.indexOf(b.kind);
}

/**
 * A raffle row's number as the raffle writes it (§NNN) — on the tab, in «Lista pentru tombolă» and in the file for random.org alike:
 * a race number as the event writes it (§735: «7», or «007» under `pad3`) for a runner and an elite, the V number for a volunteer
 * («V007», `volunteer-number.ts`), null for a line with no number.
 */
export function raffleNumberText(row: { number: number | null; kind: RaffleKind }, format: RaceNumberFormat | null | undefined): string | null {
  if (row.number === null) return null;
  return row.kind === "VOLUNTEER" ? formatVolunteerNumber(row.number) : formatRaceNumber(row.number, format);
}

// ---------------------------------------------------------------------------------------------
// The public form's matcher
// ---------------------------------------------------------------------------------------------

/** The highest number the form takes: five digits, as a bib draws (`ELITE_NUMBER_MAX`). */
export const RAFFLE_NUMBER_MAX = 99_999;

/**
 * A name as the matcher compares it (§984): lower case, the diacritics gone (ș and ş alike are s, ă and â are a), every
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
 * Whether a name typed on the public form names the registered person (§984): both folded (`foldName`), **every typed word is one
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
