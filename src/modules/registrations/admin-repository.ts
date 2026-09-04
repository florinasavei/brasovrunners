import { and, asc, desc, eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import {
  type RegistrationKind,
  type RegistrationStatus,
  registrations,
} from "@/db/schema/registrations";
import type { Database } from "@/db/types";

/**
 * Read queries for the Administrator-only backoffice (AGENTS.md §15.8, §15.10; BR-REQ-060-01,
 * BR-REQ-070-01). Kept apart from `repository.ts`, which is the state-machine's own guarded
 * reads and writes: nothing here ever changes a registration, and every column selected is
 * chosen explicitly — the same `PUBLIC_COLUMNS` discipline `modules/events/repository.ts` uses
 * — so a join can never smuggle a participant's email into a response nobody asked it to carry.
 */

export type RegistrationListRow = {
  id: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  registeredName: string;
  participantEmail: string;
  eventId: string;
  eventTitle: string | null;
  submittedAt: Date;
  confirmedAt: Date | null;
};

/**
 * `excludeTest` is what the CSV export sets, and the reason it is a filter here rather than a
 * column the caller drops.
 *
 * The decision (`DECISIONS.md` §30): the export **omits** `TEST` rows rather than labelling
 * them. A label survives inside this application, where the chip sits next to the row; an
 * export is a file that leaves it. It is opened in a spreadsheet, sorted, filtered, and printed
 * at a start line by a volunteer who never saw this screen — and a column they filtered away an
 * hour ago is not a warning. Every screen inside the backoffice labels them instead, because
 * there the context travels with the row.
 */
export async function listRegistrationsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: { eventId?: string; status?: RegistrationStatus; excludeTest?: boolean } = {},
): Promise<RegistrationListRow[]> {
  const conditions = [
    filters.eventId ? eq(registrations.eventId, filters.eventId) : undefined,
    filters.status ? eq(registrations.status, filters.status) : undefined,
    filters.excludeTest ? eq(registrations.kind, "REAL") : undefined,
  ].filter((condition) => condition !== undefined);

  return db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      submittedAt: registrations.submittedAt,
      confirmedAt: registrations.confirmedAt,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(registrations.submittedAt));
}

export type RegistrationDetail = {
  id: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  registeredName: string;
  participantEmail: string;
  eventId: string;
  eventTitle: string | null;
  submittedAt: Date;
  emailConfirmedAt: Date | null;
  waitlistedAt: Date | null;
  offerCreatedAt: Date | null;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationSource: string | null;
  expiredAt: Date | null;
  expiryReason: string | null;
};

export async function findRegistrationDetailForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<RegistrationDetail | undefined> {
  const [row] = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      submittedAt: registrations.submittedAt,
      emailConfirmedAt: registrations.emailConfirmedAt,
      waitlistedAt: registrations.waitlistedAt,
      offerCreatedAt: registrations.offerCreatedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      confirmedAt: registrations.confirmedAt,
      cancelledAt: registrations.cancelledAt,
      cancellationSource: registrations.cancellationSource,
      expiredAt: registrations.expiredAt,
      expiryReason: registrations.expiryReason,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .where(eq(registrations.id, id))
    .limit(1);

  return row;
}

export type DeclarationAcceptanceRow = {
  acceptedAt: Date;
  typedName: string;
  declarationVersion: number;
};

export async function listDeclarationAcceptances<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<DeclarationAcceptanceRow[]> {
  return db
    .select({
      acceptedAt: declarationAcceptances.acceptedAt,
      typedName: declarationAcceptances.typedName,
      declarationVersion: declarationAcceptances.declarationVersion,
    })
    .from(declarationAcceptances)
    .where(eq(declarationAcceptances.registrationId, registrationId))
    .orderBy(desc(declarationAcceptances.acceptedAt));
}

export type OutboxHistoryRow = {
  messageType: string;
  status: string;
  isManualResend: boolean;
  createdAt: Date;
  sentAt: Date | null;
};

export async function listOutboxHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<OutboxHistoryRow[]> {
  return db
    .select({
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      isManualResend: emailOutbox.isManualResend,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.registrationId, registrationId))
    .orderBy(asc(emailOutbox.createdAt));
}

/** Events with at least one registration, for the list page's filter — Admin has no reason to
 * see events nobody has registered for on this screen; the CMS already lists all of them. */
export async function listEventsWithRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Array<{ id: string; title: string | null }>> {
  return db
    .selectDistinct({ id: events.id, title: eventTranslations.title })
    .from(events)
    .innerJoin(registrations, eq(registrations.eventId, events.id))
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, registrations.locale)),
    )
    .orderBy(asc(eventTranslations.title));
}
