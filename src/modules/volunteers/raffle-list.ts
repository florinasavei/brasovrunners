import { and, eq, isNotNull } from "drizzle-orm";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";
import { canManageVolunteers, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/*
  «Lista pentru tombolă» (§948; the owner, 2026-11-15: «vreau să fac o tombolă și trebuie să pot exporta toți voluntarii
  și toți participanții»): one file for one event — everybody who wears a number there, runner or volunteer, by the
  number: the number, the name, which of the two they are.

  Who is in it: a **confirmed** registration with a race number, and a **confirmed** volunteer with a number of the
  volunteers' own series. Nobody else — not a registration that is waiting, held, cancelled or expired, not a test one
  (§30: omitted from everything the club is given), not a cancelled volunteer whose number stays retired, not a line of
  the race's elite list (a name printed on a bib, nobody registered, §895). One number is one person at an event
  (`bibs.ts`), so the file never holds a number twice.

  Since §949 (the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă la tombolă"»): nobody an organizer
  took out — «Participă la tombolă» unticked on the registrations' or the volunteers' list (`registrations.in_raffle`,
  `event_volunteers.in_raffle`) — and, beside each person, whether they were there («Prezent»): the owner chose a raffle among
  who is there, and the draw is made outside the site, so the file says who was there and the club filters by it. A column
  rather than a condition: a desk that did not check everybody in must not empty the list.

  Since §NNN (the owner, 2026-11-18, three days before the race: «La voluntari trebuie să trec prezent/absent ca să pot face
  tombola doar pentru cei prezenți»): a runner's «Prezent» is the desk's check-in (`registrations.checked_in_at`), and a
  volunteer's — empty until then, the desk checks no volunteer in — is the organizers' own tick on the «Voluntari» list
  (`event_volunteers.present`), «Da» or «Nu» like a runner's. And beside the full file, never in place of it, a second one:
  **«Lista pentru tombolă — doar prezenții»** (`onlyPresent`) — the same people by the same rules, of whom only the runners
  the desk checked in and the volunteers ticked «Prezent». The full file stays as it was, so a desk that did not check
  everybody in still has a whole list; the short one is the organizers' explicit second download.

  A name and a number, for the club's own table: nothing else of the person — no address, telephone, age or state. It is
  still a file of names that leaves the site, so it is taken only by a role that reads the registrations and works the
  volunteers (the Organizer and the Administrators), asserted here (BR-REQ-060-01), and recorded as the other exports
  are (§322): who, which event, how many of each and which of the two files — never a name.
*/

export type RaffleKind = "RUNNER" | "VOLUNTEER";

/** `present`: whether the person was there — a runner the desk checked in, a volunteer the organizers ticked «Prezent» (§NNN). */
export type RaffleRow = { number: number; name: string; kind: RaffleKind; present: boolean };

export type RaffleList = { rows: RaffleRow[]; runners: number; volunteers: number };

/**
 * Which of the two files (§NNN): `onlyPresent` keeps only the runners the desk checked in and the volunteers ticked «Prezent» —
 * everything else as for the whole file. Absent or false is the whole file.
 */
export type RaffleListOptions = { onlyPresent?: boolean };

/** Whoever reads the registrations' list and works the volunteers: the Organizer and the Administrators. */
export function canTakeRaffleList(role: StaffUser["role"]): boolean {
  return canReadRegistrations(role) && canManageVolunteers(role);
}

/** The event's list for a raffle, by number — the whole of it, or only the people there (§NNN) — and the download's record in the trail. */
export async function exportRaffleList<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  now: Date,
  options: RaffleListOptions = {},
): Promise<RaffleList> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not take the list of numbers for a raffle`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  // Only a real `true` asks for the short file: anything else is the whole one, the file that never empties.
  const onlyPresent = options.onlyPresent === true;

  const runners = await db
    .select({ number: registrations.bibNumber, name: registrations.registeredName, checkedInAt: registrations.checkedInAt })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        eq(registrations.kind, "REAL"),
        isNotNull(registrations.bibNumber),
        // «Participă la tombolă» (§949): nobody the Organizer or an Administrator took out.
        eq(registrations.inRaffle, true),
        // «doar prezenții» (§NNN): only the runners the desk checked in.
        ...(onlyPresent ? [isNotNull(registrations.checkedInAt)] : []),
      ),
    );
  const volunteers = await db
    .select({ number: eventVolunteers.bibNumber, name: eventVolunteers.name, present: eventVolunteers.present })
    .from(eventVolunteers)
    .where(
      and(
        eq(eventVolunteers.eventId, eventId),
        eq(eventVolunteers.state, "CONFIRMED"),
        isNotNull(eventVolunteers.bibNumber),
        eq(eventVolunteers.inRaffle, true),
        // «doar prezenții» (§NNN): only the volunteers the organizers ticked «Prezent».
        ...(onlyPresent ? [eq(eventVolunteers.present, true)] : []),
      ),
    );

  const rows: RaffleRow[] = [
    ...runners.flatMap((row) => (row.number === null ? [] : [{ number: row.number, name: row.name, kind: "RUNNER" as const, present: row.checkedInAt !== null }])),
    ...volunteers.flatMap((row) => (row.number === null ? [] : [{ number: row.number, name: row.name, kind: "VOLUNTEER" as const, present: row.present }])),
  ].sort((a, b) => a.number - b.number || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "event.raffle_list_exported",
    entityType: "event",
    entityId: eventId,
    // Which of the two files beside the two counts (§NNN): a trail that says a file of names left the site says which one.
    metadata: { runners: runners.length, volunteers: volunteers.length, onlyPresent },
    now,
  });
  return { rows, runners: runners.length, volunteers: volunteers.length };
}

export type RaffleCsvWords = { number: string; name: string; kind: string; kinds: Record<RaffleKind, string>; present: string; presentYes: string; presentNo: string };

/**
 * The file: four columns — the number, the name, which of the two, and whether the person was there (a runner checked in at the desk,
 * a volunteer ticked «Prezent», §NNN) — one row per number; the present-only file has the same four. The registrations export's rules
 * (`registrations/csv.ts`): every cell through the one `csvCell`, so a name starting with `=`, `+`, `-` or `@` opens as text and never
 * as a formula; CRLF between lines and a BOM first, because the club opens the file in Excel on Windows.
 */
export function buildRaffleCsv(words: RaffleCsvWords, rows: readonly RaffleRow[]): string {
  const lines = [[words.number, words.name, words.kind, words.present], ...rows.map((row) => [String(row.number), row.name, words.kinds[row.kind], row.present ? words.presentYes : words.presentNo])];
  return `${CSV_BOM}${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The file's name, with the club's date: `tombola-2026-11-21.csv`, and the present-only one `tombola-prezenti-2026-11-21.csv` (§NNN). */
export function raffleCsvFileName(day: string, options: RaffleListOptions = {}): string {
  return options.onlyPresent === true ? `tombola-prezenti-${day}.csv` : `tombola-${day}.csv`;
}
