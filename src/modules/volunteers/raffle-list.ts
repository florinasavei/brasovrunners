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
  «Lista pentru tombolă» (§NNN; the owner, 2026-11-15: «vreau să fac o tombolă și trebuie să pot exporta toți voluntarii
  și toți participanții»): one file for one event — everybody who wears a number there, runner or volunteer, by the
  number: the number, the name, which of the two they are.

  Who is in it: a **confirmed** registration with a race number, and a **confirmed** volunteer with a number of the
  volunteers' own series. Nobody else — not a registration that is waiting, held, cancelled or expired, not a test one
  (§30: omitted from everything the club is given), not a cancelled volunteer whose number stays retired, not a line of
  the race's elite list (a name printed on a bib, nobody registered, §895). One number is one person at an event
  (`bibs.ts`), so the file never holds a number twice.

  A name and a number, for the club's own table: nothing else of the person — no address, telephone, age or state. It is
  still a file of names that leaves the site, so it is taken only by a role that reads the registrations and works the
  volunteers (the Organizer and the Administrators), asserted here (BR-REQ-060-01), and recorded as the other exports
  are (§322): who, which event and how many of each — never a name.
*/

export type RaffleKind = "RUNNER" | "VOLUNTEER";

export type RaffleRow = { number: number; name: string; kind: RaffleKind };

export type RaffleList = { rows: RaffleRow[]; runners: number; volunteers: number };

/** Whoever reads the registrations' list and works the volunteers: the Organizer and the Administrators. */
export function canTakeRaffleList(role: StaffUser["role"]): boolean {
  return canReadRegistrations(role) && canManageVolunteers(role);
}

/** The event's list for a raffle, by number, and the download's record in the trail. */
export async function exportRaffleList<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "id" | "role">, eventId: string, now: Date): Promise<RaffleList> {
  if (!canTakeRaffleList(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not take the list of numbers for a raffle`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");

  const runners = await db
    .select({ number: registrations.bibNumber, name: registrations.registeredName })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "CONFIRMED"), eq(registrations.kind, "REAL"), isNotNull(registrations.bibNumber)));
  const volunteers = await db
    .select({ number: eventVolunteers.bibNumber, name: eventVolunteers.name })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.state, "CONFIRMED"), isNotNull(eventVolunteers.bibNumber)));

  const rows: RaffleRow[] = [
    ...runners.flatMap((row) => (row.number === null ? [] : [{ number: row.number, name: row.name, kind: "RUNNER" as const }])),
    ...volunteers.flatMap((row) => (row.number === null ? [] : [{ number: row.number, name: row.name, kind: "VOLUNTEER" as const }])),
  ].sort((a, b) => a.number - b.number || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "event.raffle_list_exported",
    entityType: "event",
    entityId: eventId,
    metadata: { runners: runners.length, volunteers: volunteers.length },
    now,
  });
  return { rows, runners: runners.length, volunteers: volunteers.length };
}

export type RaffleCsvWords = { number: string; name: string; kind: string; kinds: Record<RaffleKind, string> };

/**
 * The file: three columns, one row per number. The registrations export's rules (`registrations/csv.ts`): every cell
 * through the one `csvCell`, so a name starting with `=`, `+`, `-` or `@` opens as text and never as a formula; CRLF
 * between lines and a BOM first, because the club opens the file in Excel on Windows.
 */
export function buildRaffleCsv(words: RaffleCsvWords, rows: readonly RaffleRow[]): string {
  const lines = [[words.number, words.name, words.kind], ...rows.map((row) => [String(row.number), row.name, words.kinds[row.kind]])];
  return `${CSV_BOM}${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The file's name, with the club's date: `tombola-2026-11-21.csv`. */
export function raffleCsvFileName(day: string): string {
  return `tombola-${day}.csv`;
}
