import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";
import { canManageVolunteers, canReadRaffle, canReadRegistrations, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import type { RaffleKind } from "./domain/raffle";
import { type RaffleRoster, readRaffleRosterRows } from "./raffle-roster";

/*
  «Lista pentru tombolă» (§948; the owner, 2026-11-15: «vreau să fac o tombolă și trebuie să pot exporta toți voluntarii
  și toți participanții»): one file for one event — everybody who takes part in its raffle, by the number: the number, the name,
  which group they are, and whether they were there.

  Since §949 (the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă la tombolă"»): nobody an organizer
  took out — «Participă la tombolă» unticked (`registrations.in_raffle`, `event_volunteers.in_raffle`) — and, beside each person,
  whether they were there («Prezent»). A column rather than a condition: a desk that did not check everybody in must not empty the list.

  Since the decision of 2026-11-18 titled «Prezent» on a volunteer, and «Lista pentru tombolă — doar prezenții»: a volunteer's
  «Prezent» is the organizers' own tick on the «Voluntari» list (`event_volunteers.present`), and beside the full file, never in
  place of it, a second one: **«Lista pentru tombolă — doar prezenții»** (`onlyPresent`) — the same people, of whom only the
  runners checked in — at the desk, or by «Am ajuns» from their own link — and the volunteers ticked «Prezent».

  Since §984 (the owner, 2026-11-18: «trebuie să bifez acolo cine se poate înscrie: doar alergătorii și elitele și voluntarii» and «tombolă
  din oficiu vs tombolă cu înscriere separată»): who is in the file is the one function's answer (`domain/raffle.ts#raffleParticipation`,
  read through `raffle-roster.ts#readRaffleRosterRows`) — the groups the event ticks in «Cine poate participa», and, «Cu înscriere separată»,
  only those who signed up — and the file has three groups: «Alergător», «Elită» — a registration marked «Elită» (§897) and a line of the
  race's elite list (§895), which takes part by name: its number when it has one, else an empty number cell, the numberless lines after
  the numbered ones, by name — and «Voluntar». A line's «Prezent» is the organizers' tick on the «Tombolă» tab.

  Since §1023 (the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001 V002 la toti voluntarii automat!»): a volunteer takes
  part with their V number — every confirmed volunteer has one, drawn by itself at the confirmation (`volunteer-numbers.ts`) — and
  every file writes a number as the raffle writes it (`domain/raffle.ts#raffleNumberText`): a race number as the event writes it,
  «V007» for a volunteer. The order is the race numbers, then the V numbers, then whoever has none (`compareRaffleRows`). Beside the
  CSV, **«Descarcă pentru random.org»** (`buildRaffleRandomOrgText`): the same people, one number per line and nothing else, for the
  draw on random.org's List Randomizer — a name would leave the site for a third party the privacy notice does not name, so the
  winner is found by number in the CSV or on «Tombolă».

  A name and a number, for the club's own table: nothing else of the person — no address, telephone, age or state. It is still a file
  of names that leaves the site, so it is taken only by a role that reads the registrations and works the volunteers (the Organizer and
  the Administrators), asserted here (BR-REQ-060-01), and recorded as the other exports are (§322): who, which event, how many of each
  group, which of the two scopes and which format — never a name.
*/

export type { RaffleKind };

/**
 * One person of the file. `number` is the integer of their series — a race number, or a volunteer's V number — and `label` the number
 * as the raffle writes it («7», «007» as the event writes a race number, «V007»), null for an elite line without one. `present`: whether
 * the person was there — a registration checked in (at the desk or by «Am ajuns»), a volunteer or an elite line ticked «Prezent».
 */
export type RaffleRow = { number: number | null; label: string | null; name: string; kind: RaffleKind; present: boolean };

export type RaffleList = { rows: RaffleRow[]; runners: number; elites: number; volunteers: number };

/** The two formats of one list: the CSV with the names (`csv`), and one number per line for random.org (`random-org`, §1023). */
export const RAFFLE_LIST_FORMATS = ["csv", "random-org"] as const;
export type RaffleListFormat = (typeof RAFFLE_LIST_FORMATS)[number];

/**
 * Which of the two scopes and which format: `onlyPresent` keeps only the people there — the runners checked in at the desk or by «Am
 * ajuns» from their own link, the volunteers and the elite lines ticked «Prezent» — everything else as for the whole file. Absent or
 * false is the whole file. `format` is what the download's trail row says (`csv` unless `random-org`); the people are the same.
 */
export type RaffleListOptions = { onlyPresent?: boolean; format?: RaffleListFormat };

/**
 * Whoever reads the registrations' list and works the volunteers: the Organizer and the Administrators. A role or an account, so an
 * action may ask it at its door (`requireStaffCapability(canTakeRaffleList)`, §984). Since §1014 it is no longer who reads the «Tombolă»
 * tab — every desk role does (`canReadRaffle`) — but what stays the organizers' there: the files — the two CSVs, whose names leave the
 * site, and the two for random.org (§1023), which hold the same people by number —, the exclusion, «Șterge înscrierea», an elite line's
 * ticks, the organizers' «Înscrie» of anybody, how and when each person signed up, and the reason «scos de organizatori».
 */
export function canTakeRaffleList(subject: StaffSubject): boolean {
  return canReadRegistrations(subject) && canManageVolunteers(subject);
}

/**
 * Everybody of the event's three groups with the answer — the «Tombolă» tab's read — for every desk role (`canReadRaffle`, §1014): a
 * name, a number, a group, a state and whether the person was there, never an address, an email or a telephone (BR-REQ-060-01).
 */
export async function readRaffleRoster<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string, now: Date): Promise<RaffleRoster | null> {
  if (!canReadRaffle(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the raffle`);
  return readRaffleRosterRows(db, eventId, now);
}

/** The event's list for a raffle, by number — the whole of it, or only the people there — and the download's record in the trail. */
export async function exportRaffleList<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  now: Date,
  options: RaffleListOptions = {},
): Promise<RaffleList> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not take the list of numbers for a raffle`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const roster = await readRaffleRosterRows(db, eventId, now);
  if (!roster) throw new DomainError("NOT_FOUND", "the event is not there");
  // Only a real `true` asks for the short file: anything else is the whole one, the file that never empties.
  const onlyPresent = options.onlyPresent === true;
  // Only the one other format's name asks for it: anything else is the CSV, the file the club has always taken.
  const format: RaffleListFormat = options.format === "random-org" ? "random-org" : "csv";

  // The roster's own order (`compareRaffleRows`): the race numbers, then the volunteers' V numbers, then whoever has none.
  const rows: RaffleRow[] = roster.rows
    .filter((row) => row.reason === "in" && (!onlyPresent || row.present))
    .map((row) => ({ number: row.number, label: row.label, name: row.name, kind: row.kind, present: row.present }));
  const count = (kind: RaffleKind) => rows.filter((row) => row.kind === kind).length;
  const list: RaffleList = { rows, runners: count("RUNNER"), elites: count("ELITE"), volunteers: count("VOLUNTEER") };

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "event.raffle_list_exported",
    entityType: "event",
    entityId: eventId,
    // Which of the two scopes and which format beside the counts: a trail that says a file left the site says which one, never a name.
    metadata: { runners: list.runners, elites: list.elites, volunteers: list.volunteers, onlyPresent, signUp: roster.settings.signUp, format },
    now,
  });
  return list;
}

export type RaffleCsvWords = { number: string; name: string; kind: string; kinds: Record<RaffleKind, string>; present: string; presentYes: string; presentNo: string };

/**
 * The file: four columns — the number as the raffle writes it («7», «V007»; empty for an elite line without one), the name, which group,
 * and whether the person was there — one row per person; the present-only file has the same four. The registrations export's rules
 * (`registrations/csv.ts`): every cell through the one `csvCell`, so a name starting with `=`, `+`, `-` or `@` opens as text and never as
 * a formula; CRLF between lines and a BOM first, because the club opens the file in Excel on Windows.
 */
export function buildRaffleCsv(words: RaffleCsvWords, rows: readonly RaffleRow[]): string {
  const lines = [
    [words.number, words.name, words.kind, words.present],
    ...rows.map((row) => [row.label ?? "", row.name, words.kinds[row.kind], row.present ? words.presentYes : words.presentNo]),
  ];
  return `${CSV_BOM}${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * «Descarcă pentru random.org» (§1023): the same people as the CSV of the same scope, **one number per line** as the raffle writes it — a
 * race number as the event writes it, an elite's number, «V007» — in the raffle's order, each line ending CRLF, and nothing else: no
 * header, no name (a name would leave the site for random.org, a third party the privacy notice does not name), no BOM, no blank line —
 * what random.org's List Randomizer takes pasted as it is. A participant with no number (a line of the elite list nobody numbered yet)
 * cannot be written without a name and is left out; «Tombolă» says how many (`raffleWithoutNumber`). Every number once: the race numbers
 * are one per person at the event and the V numbers too, and «V» keeps the two series apart. An empty list is an empty file.
 */
export function buildRaffleRandomOrgText(rows: readonly RaffleRow[]): string {
  return rows.flatMap((row) => (row.label === null || row.label === "" ? [] : [`${row.label}\r\n`])).join("");
}

/** How many of the people taking part the file for random.org cannot hold: those with no number (§1023). */
export function raffleWithoutNumber(rows: ReadonlyArray<{ label: string | null }>): number {
  return rows.filter((row) => row.label === null || row.label === "").length;
}

/** The file's name, with the club's date: `tombola-2026-11-21.csv`, and the present-only one `tombola-prezenti-2026-11-21.csv`. */
export function raffleCsvFileName(day: string, options: RaffleListOptions = {}): string {
  return options.onlyPresent === true ? `tombola-prezenti-${day}.csv` : `tombola-${day}.csv`;
}

/**
 * The file for random.org's name (§1023), as the CSV's is built: `tombola-2026-11-21-random-org.txt`, and the present-only one
 * `tombola-prezenti-2026-11-21-random-org.txt`. ASCII alone.
 */
export function raffleRandomOrgFileName(day: string, options: RaffleListOptions = {}): string {
  return options.onlyPresent === true ? `tombola-prezenti-${day}-random-org.txt` : `tombola-${day}-random-org.txt`;
}
