import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import type { RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { canReadRaceDayDeclarations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import type { RaceDayDeclarationRow } from "./domain/declarations";

/*
  «Ziua cursei» → «Declarații» (§NNN), the reads: one event's registrations that hold a signed declaration, each with its newest
  acceptance — what the page draws and nothing more. The organizers' alone (`canReadRaceDayDeclarations`, asserted here as on the
  page, BR-REQ-060-01). Reading only: nothing here writes, and the trail is written by the PDF route a row links to
  (`registration.declaration_downloaded`), as before.

  **One query for the event's rows, whatever their number:** the event's registrations joined to their acceptances on
  `declaration_acceptances_registration_accepted_at_idx`, `DISTINCT ON` the registration so each keeps its newest — the one its PDF
  prints (`signed-declaration.ts#findSignedDeclaration`) —, the recording colleague's name by one join. **No identity document is
  selected**: neither `id_document` nor `minor_id_document` leaves the database for this page, so no page built on it can print one.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** The event the page is about, as it heads it: its title in the reader's language, its day and clock, how it writes a number. */
export type DeclarationsEvent = { id: string; title: string | null; startsAt: Date; timezone: string; raceNumberFormat: RaceNumberFormat };

/** The event by id, for the page's head and its select, or null for an id nobody has. */
export async function findDeclarationsEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string, locale: Locale): Promise<DeclarationsEvent | null> {
  if (!isUuid(eventId)) return null;
  const [row] = await db
    .select({ id: events.id, startsAt: events.startsAt, timezone: events.timezone, raceNumberFormat: RACE_NUMBER_FORMAT, title: eventTranslations.title })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

const recordedBy = alias(staffUsers, "declaration_recorded_by");

/**
 * Every registration of one event that holds a signed declaration (§NNN), with its newest acceptance, for the Organizer, the
 * Administrator and the Superadministrator (`canReadRaceDayDeclarations`); any other role is refused here as on the page. In no
 * particular order: the page sorts them into its sections (`domain/declarations.ts`).
 */
export async function readRaceDayDeclarations<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<RaceDayDeclarationRow[]> {
  if (!canReadRaceDayDeclarations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the race-day declarations`);
  return db
    .selectDistinctOn([declarationAcceptances.registrationId], {
      registrationId: declarationAcceptances.registrationId,
      status: registrations.status,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      guardianName: registrations.guardianName,
      bibNumber: registrations.bibNumber,
      acceptedAt: declarationAcceptances.acceptedAt,
      method: declarationAcceptances.method,
      typedName: declarationAcceptances.typedName,
      minorTypedName: declarationAcceptances.minorTypedName,
      declarationVersion: declarationAcceptances.declarationVersion,
      textHash: declarationAcceptances.textHash,
      recordedByName: recordedBy.displayName,
    })
    .from(declarationAcceptances)
    .innerJoin(registrations, eq(registrations.id, declarationAcceptances.registrationId))
    .leftJoin(recordedBy, eq(recordedBy.id, declarationAcceptances.attestedByStaffUserId))
    .where(eq(registrations.eventId, eventId))
    .orderBy(declarationAcceptances.registrationId, desc(declarationAcceptances.acceptedAt), desc(declarationAcceptances.createdAt));
}
