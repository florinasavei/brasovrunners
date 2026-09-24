import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { type DeclarationAcceptance, declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations } from "@/db/schema/events";
import { type Participant, participants } from "@/db/schema/participants";
import { registrationInterests } from "@/db/schema/registration-interests";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { openFormDraft, purposeSecret, sealFormDraft } from "./form-draft";

/**
 * Everything the platform holds about one person (§322) — the answer to an access request
 * (art. 15 GDPR) and the checklist before an erasure (art. 17).
 *
 * Looked up by the **canonical** address, through the canonicalizer and never a raw compare
 * (`AGENTS.md` §10.4): `Ana.Pop+club@Gmail.com` and `ana.pop@gmail.com` are one person here as
 * they are one participant, and the "Anunță-mă" list is matched the same way. Every registration
 * in every status with every stored column, the declaration acceptances, the consents and their
 * versions (they are columns of the registration), the messages by type, date and status, the
 * addresses left for an announcement, and the audit rows about the person or their registrations.
 *
 * Administrator only (`canManageRegistrations`): it is the whole of a person on one screen, the
 * health note included, and the Organizer's reading of the list (§289) was never that.
 *
 * ## The address never goes in the address bar
 *
 * "Nothing about a person goes in a URL" (`docs/VIBECODING.md`; `AGENTS.md` §14.5): a query
 * string is written to the host's request log, the browser's history and every referrer. So the
 * page is reached through a form that posts the address, and the address comes back in the URL
 * only **sealed** — AES-256-GCM under the deployment's secret, bound to this purpose, stamped with
 * the time and good for half an hour (`sealPersonLookup`). A log line holds ciphertext.
 */

/** How long a sealed lookup opens: long enough to read the page and download the file. */
export const PERSON_LOOKUP_MINUTES = 30;
const PURPOSE = "person-lookup";

export function sealPersonLookup(canonicalEmail: string, now: Date): string | null {
  return sealFormDraft({ email: canonicalEmail, at: now.toISOString() }, purposeSecret(PURPOSE));
}

/** The canonical address a sealed lookup carries, or null when it is not one, or is too old. */
export function openPersonLookup(sealed: string, now: Date): string | null {
  const opened = openFormDraft(sealed, purposeSecret(PURPOSE));
  if (!opened?.email || !opened.at) return null;
  const at = Date.parse(opened.at);
  if (Number.isNaN(at) || now.getTime() - at > PERSON_LOOKUP_MINUTES * 60_000 || at - now.getTime() > 60_000) return null;
  return opened.email;
}

/** The address typed, as the identity the platform keys on; refused as a field error. */
export function canonicalLookupOf(typed: string): string {
  try {
    return canonicalizeEmail(typed).canonicalEmail;
  } catch {
    throw new DomainError("VALIDATION_ERROR", "not an email address", ["email"]);
  }
}

export type PersonRegistration = Registration & { eventTitle: string | null };

export type PersonData = {
  canonicalEmail: string;
  participant: Participant | null;
  registrations: PersonRegistration[];
  declarationAcceptances: DeclarationAcceptance[];
  messages: Array<{ registrationId: string | null; messageType: string; status: string; createdAt: Date; sentAt: Date | null }>;
  announcementRequests: Array<{ eventId: string; eventTitle: string | null; deliveryEmail: string; locale: string; createdAt: Date }>;
  auditTrail: Array<{ action: string; entityType: string; entityId: string | null; createdAt: Date; actorName: string | null; metadata: unknown }>;
};

function assertAdministrator(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read everything held about a person`);
  }
}

/** The read itself, with nothing asserted and nothing recorded — the two callers below do both. */
async function collectPersonData<T extends Record<string, unknown>>(
  db: Database<T>,
  canonicalEmail: string,
): Promise<PersonData> {
  const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalEmail)).limit(1);

  const rows = participant
    ? await db
        .select({ registration: registrations, eventTitle: eventTranslations.title })
        .from(registrations)
        .leftJoin(
          eventTranslations,
          and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, registrations.locale)),
        )
        .where(eq(registrations.participantId, participant.id))
        .orderBy(asc(registrations.submittedAt), asc(registrations.id))
    : [];
  const registrationIds = rows.map((row) => row.registration.id);

  const acceptances =
    registrationIds.length > 0
      ? await db
          .select()
          .from(declarationAcceptances)
          .where(inArray(declarationAcceptances.registrationId, registrationIds))
          .orderBy(asc(declarationAcceptances.acceptedAt))
      : [];

  const messages = participant
    ? await db
        .select({
          registrationId: emailOutbox.registrationId,
          messageType: emailOutbox.messageType,
          status: emailOutbox.status,
          createdAt: emailOutbox.createdAt,
          sentAt: emailOutbox.sentAt,
        })
        .from(emailOutbox)
        .where(
          registrationIds.length > 0
            ? or(eq(emailOutbox.participantId, participant.id), inArray(emailOutbox.registrationId, registrationIds))
            : eq(emailOutbox.participantId, participant.id),
        )
        .orderBy(asc(emailOutbox.createdAt))
    : [];

  const announcementRequests = await db
    .select({
      eventId: registrationInterests.eventId,
      eventTitle: eventTranslations.title,
      deliveryEmail: registrationInterests.deliveryEmail,
      locale: registrationInterests.locale,
      createdAt: registrationInterests.createdAt,
    })
    .from(registrationInterests)
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, registrationInterests.eventId), eq(eventTranslations.locale, registrationInterests.locale)),
    )
    .where(eq(registrationInterests.canonicalEmail, canonicalEmail))
    .orderBy(asc(registrationInterests.createdAt));

  const aboutThePerson = [
    ...(participant ? [eq(auditLogs.participantId, participant.id)] : []),
    ...(registrationIds.length > 0 ? [and(eq(auditLogs.entityType, "registration"), inArray(auditLogs.entityId, registrationIds))] : []),
  ];
  const auditTrail =
    aboutThePerson.length > 0
      ? (
          await db
            .select({
              action: auditLogs.action,
              entityType: auditLogs.entityType,
              entityId: auditLogs.entityId,
              createdAt: auditLogs.createdAt,
              actorName: staffUsers.displayName,
              metadata: auditLogs.metadataJson,
            })
            .from(auditLogs)
            .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
            .where(or(...aboutThePerson))
            .orderBy(desc(auditLogs.createdAt))
        )
      : [];

  return {
    canonicalEmail,
    participant: participant ?? null,
    registrations: rows.map((row) => ({ ...row.registration, eventTitle: row.eventTitle })),
    declarationAcceptances: acceptances,
    messages,
    announcementRequests,
    auditTrail,
  };
}

/**
 * The page's read. Every registration shown carries its emergency details and health note, so
 * each one is recorded as read (`registration.health_viewed`, §322) exactly as the section on
 * the registration's own page is — the same question, "who has seen my health note", from
 * another door.
 */
export async function viewPersonData<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  canonicalEmail: string,
  now: Date,
): Promise<PersonData> {
  assertAdministrator(actor);
  const data = await collectPersonData(db, canonicalEmail);
  for (const registration of data.registrations) {
    await recordAuditEvent(db, {
      actorStaffUserId: actor.id,
      participantId: registration.participantId,
      action: "registration.health_viewed",
      entityType: "registration",
      entityId: registration.id,
      metadata: { via: "PERSON_VIEW" },
      now,
    });
  }
  return data;
}

/**
 * "Descarcă JSON" — the same data as a file, recorded as `participant.data_exported` with the
 * counts and never a value (§322). A file that leaves the application is a copy the erase cannot
 * reach, which is why the trail says it was made.
 */
export async function exportPersonData<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  canonicalEmail: string,
  now: Date,
): Promise<PersonData> {
  assertAdministrator(actor);
  const data = await collectPersonData(db, canonicalEmail);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: data.participant?.id ?? null,
    action: "participant.data_exported",
    entityType: "participant",
    entityId: data.participant?.id ?? null,
    metadata: {
      registrations: data.registrations.length,
      declarationAcceptances: data.declarationAcceptances.length,
      messages: data.messages.length,
      announcementRequests: data.announcementRequests.length,
      auditRows: data.auditTrail.length,
    },
    now,
  });
  return data;
}
