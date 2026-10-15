import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { type DeclarationAcceptance, declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerCategories, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type Participant, participants } from "@/db/schema/participants";
import { registrationInterests } from "@/db/schema/registration-interests";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
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
 * versions (they are columns of the registration), the messages by type, date and status and what
 * the provider reported of each (delivered, refused, why — never its words), the
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
  /**
   * The messages by type, date and status, and what the provider reported of each (§670): when it was
   * delivered or refused, why, and whether the address took a later message — never the provider's words,
   * which a redactor may have missed an address in.
   */
  messages: Array<{
    registrationId: string | null;
    messageType: string;
    status: string;
    createdAt: Date;
    sentAt: Date | null;
    deliveredAt: Date | null;
    rejectedAt: Date | null;
    rejectionCause: string | null;
    laterDeliveredAt: Date | null;
  }>;
  announcementRequests: Array<{ eventId: string; eventTitle: string | null; deliveryEmail: string; locale: string; createdAt: Date }>;
  /**
   * What the person offered as a volunteer (§754): the event, the role, the state, where it came from and
   * what was typed — name, address, telephone number, their message and the organizers' note, every column
   * of the row (art. 15 GDPR). Deleted by the event's «Voluntari» card, or thirty days after the event.
   */
  volunteerOffers: Array<{
    eventId: string;
    eventTitle: string | null;
    /**
     * The role the organizers gave, in both languages (the page shows the one of its own locale) — null while none (§761). Named as
     * a role is named alone, with its category: «Direcționare (Traseu)» (§774, `roleLabel`).
     */
    roleNameRo: string | null;
    roleNameEn: string | null;
    /** The roles the person said they would do (§761), in both languages, in the club's order, each with its category as above. */
    chosenRolesRo: string[];
    chosenRolesEn: string[];
    state: (typeof eventVolunteers.$inferSelect)["state"];
    source: (typeof eventVolunteers.$inferSelect)["source"];
    name: string;
    deliveryEmail: string;
    phone: string;
    message: string | null;
    note: string | null;
    /** What the person said about themselves (§765), every answer as stored: nulls and false for a row from before. */
    age: number | null;
    /** The date of birth the age was derived from, `YYYY-MM-DD` (§773): a row from before has none (art. 15 GDPR: every column of the row). */
    dateOfBirth: string | null;
    sex: (typeof eventVolunteers.$inferSelect)["sex"];
    city: string | null;
    volunteeredBefore: boolean;
    clubMember: boolean;
    shirtSize: (typeof eventVolunteers.$inferSelect)["shirtSize"];
    privacyNoticeVersion: number | null;
    createdAt: Date;
    /** The volunteer agreement (§758): the version accepted, how and when, and the age declared — or nulls. */
    agreementVersion: number | null;
    agreementMethod: (typeof eventVolunteers.$inferSelect)["agreementMethod"];
    agreementAcceptedAt: Date | null;
    declaredAdult: boolean;
    /** The parent or guardian of a volunteer under eighteen (§768) — their name and address, and whether and how they accepted: every column of the row (art. 15 GDPR). */
    guardianName: string | null;
    guardianEmail: string | null;
    guardianAcceptedAt: Date | null;
    guardianMethod: (typeof eventVolunteers.$inferSelect)["guardianMethod"];
    /**
     * The trace of the electronic acceptance (§771): the IP address and browser of the press — the volunteer's own on
     * the form or the link, the guardian's on theirs. Null for «PAPER» and for a row from before it (art. 15 GDPR).
     */
    agreementIp: string | null;
    agreementUserAgent: string | null;
    guardianIp: string | null;
    guardianUserAgent: string | null;
  }>;
  /**
   * The group-run declarations signed with this address (§393, §769) — the signer's own and, for a minor, the minor's
   * name beside the parent's: every personal column of the row, the electronic signature's trace (§771: the IP address
   * and browser) among them. Found through the canonicalizer like every other part of this page (AGENTS.md §10.4).
   */
  groupRunDeclarations: Array<{
    eventId: string;
    eventTitle: string | null;
    version: number;
    locale: string;
    typedName: string;
    minorTypedName: string | null;
    idDocument: string | null;
    deliveryEmail: string;
    acceptedAt: Date;
    ip: string | null;
    userAgent: string | null;
  }>;
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
          deliveredAt: emailOutbox.deliveredAt,
          rejectedAt: emailOutbox.rejectedAt,
          rejectionCause: emailOutbox.rejectionCause,
          laterDeliveredAt: emailOutbox.laterDeliveredAt,
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

  // The offers to volunteer (§754), found by the same canonical address: the event's title in Romanian, the role as the club wrote it.
  const offerRows = await db
    .select({
      id: eventVolunteers.id,
      eventId: eventVolunteers.eventId,
      eventTitle: eventTranslations.title,
      roleNameRo: eventVolunteerRoles.nameRo,
      roleNameEn: eventVolunteerRoles.nameEn,
      roleCategoryRo: eventVolunteerCategories.nameRo,
      roleCategoryEn: eventVolunteerCategories.nameEn,
      state: eventVolunteers.state,
      source: eventVolunteers.source,
      name: eventVolunteers.name,
      deliveryEmail: eventVolunteers.email,
      phone: eventVolunteers.phone,
      message: eventVolunteers.message,
      note: eventVolunteers.note,
      age: eventVolunteers.age,
      dateOfBirth: eventVolunteers.dateOfBirth,
      sex: eventVolunteers.sex,
      city: eventVolunteers.city,
      volunteeredBefore: eventVolunteers.volunteeredBefore,
      clubMember: eventVolunteers.clubMember,
      shirtSize: eventVolunteers.shirtSize,
      privacyNoticeVersion: eventVolunteers.privacyNoticeVersion,
      createdAt: eventVolunteers.createdAt,
      agreementVersion: legalDocuments.version,
      agreementMethod: eventVolunteers.agreementMethod,
      agreementAcceptedAt: eventVolunteers.agreementAcceptedAt,
      declaredAdult: eventVolunteers.declaredAdult,
      guardianName: eventVolunteers.guardianName,
      guardianEmail: eventVolunteers.guardianEmail,
      guardianAcceptedAt: eventVolunteers.guardianAcceptedAt,
      guardianMethod: eventVolunteers.guardianMethod,
      agreementIp: eventVolunteers.agreementIp,
      agreementUserAgent: eventVolunteers.agreementUserAgent,
      guardianIp: eventVolunteers.guardianIp,
      guardianUserAgent: eventVolunteers.guardianUserAgent,
    })
    .from(eventVolunteers)
    // The role given, when there is one (§761: an offer nobody placed has none).
    .leftJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteers.roleId))
    .leftJoin(eventVolunteerCategories, eq(eventVolunteerCategories.id, eventVolunteerRoles.categoryId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, eventVolunteers.eventId), eq(eventTranslations.locale, "ro")))
    // The agreement's version number (§758), through the row's own reference.
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .where(eq(eventVolunteers.canonicalEmail, canonicalEmail))
    .orderBy(asc(eventVolunteers.createdAt));
  // The roles each offer chose (§761), every one of them: an access request is complete (art. 15 GDPR).
  const choiceRows =
    offerRows.length > 0
      ? await db
          .select({
            volunteerId: eventVolunteerRoleChoices.volunteerId,
            nameRo: eventVolunteerRoles.nameRo,
            nameEn: eventVolunteerRoles.nameEn,
            categoryRo: eventVolunteerCategories.nameRo,
            categoryEn: eventVolunteerCategories.nameEn,
            position: eventVolunteerRoles.position,
          })
          .from(eventVolunteerRoleChoices)
          .innerJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteerRoleChoices.roleId))
          .leftJoin(eventVolunteerCategories, eq(eventVolunteerCategories.id, eventVolunteerRoles.categoryId))
          .where(inArray(eventVolunteerRoleChoices.volunteerId, offerRows.map((offer) => offer.id)))
          .orderBy(asc(eventVolunteerRoles.position), asc(eventVolunteerRoles.createdAt), asc(eventVolunteerRoles.id))
      : [];
  // A role is named as a role is named alone (§774): «Direcționare (Traseu)», so the same name under two categories is two roles to read.
  const volunteerOffers = offerRows.map(({ id, roleCategoryRo, roleCategoryEn, ...offer }) => {
    const chosen = choiceRows.filter((choice) => choice.volunteerId === id);
    return {
      ...offer,
      roleNameRo: offer.roleNameRo === null ? null : roleLabel({ nameRo: offer.roleNameRo, nameEn: offer.roleNameEn ?? "", categoryRo: roleCategoryRo, categoryEn: roleCategoryEn }, "ro"),
      roleNameEn: offer.roleNameEn === null ? null : roleLabel({ nameRo: offer.roleNameRo ?? "", nameEn: offer.roleNameEn, categoryRo: roleCategoryRo, categoryEn: roleCategoryEn }, "en"),
      chosenRolesRo: chosen.map((choice) => roleLabel(choice, "ro")),
      chosenRolesEn: chosen.map((choice) => roleLabel(choice, "en")),
    };
  });

  const groupRuns = await groupRunDeclarationsOf(db, canonicalEmail);

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
    volunteerOffers,
    groupRunDeclarations: groupRuns,
    auditTrail,
  };
}

/**
 * The group-run declarations signed with this person's address (§393, §769): the rows keep the address as typed, so each
 * is read through the canonicalizer and matched on the canonical form — `Ana.Pop+club@Gmail.com` and `ana.pop@gmail.com` are
 * one person, as everywhere on this page (AGENTS.md §10.4). The table is a club's signatures (a few thousand rows at most) and
 * an access request is rare, so the addresses are read and compared here rather than indexed twice. Every personal column is
 * returned, the trace of the electronic signature (§771) with them.
 */
async function groupRunDeclarationsOf<T extends Record<string, unknown>>(db: Database<T>, canonicalEmail: string): Promise<PersonData["groupRunDeclarations"]> {
  const addresses = await db.select({ id: groupRunDeclarations.id, email: groupRunDeclarations.email }).from(groupRunDeclarations);
  const ids = addresses
    .filter(({ email }) => {
      try {
        return canonicalizeEmail(email).canonicalEmail === canonicalEmail;
      } catch {
        return false;
      }
    })
    .map(({ id }) => id);
  if (ids.length === 0) return [];
  return db
    .select({
      eventId: groupRunDeclarations.eventId,
      eventTitle: eventTranslations.title,
      version: groupRunDeclarations.declarationVersion,
      locale: groupRunDeclarations.locale,
      typedName: groupRunDeclarations.typedName,
      minorTypedName: groupRunDeclarations.minorTypedName,
      idDocument: groupRunDeclarations.idDocument,
      deliveryEmail: groupRunDeclarations.email,
      acceptedAt: groupRunDeclarations.acceptedAt,
      ip: groupRunDeclarations.ip,
      userAgent: groupRunDeclarations.userAgent,
    })
    .from(groupRunDeclarations)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, groupRunDeclarations.eventId), eq(eventTranslations.locale, "ro")))
    .where(inArray(groupRunDeclarations.id, ids))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
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
      volunteerOffers: data.volunteerOffers.length,
      groupRunDeclarations: data.groupRunDeclarations.length,
      auditRows: data.auditTrail.length,
    },
    now,
  });
  return data;
}
