import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { type DeclarationAcceptance, declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventResults } from "@/db/schema/event-results";
import { eventRsvps, rsvpAskRefusals, rsvpRefuseTokens } from "@/db/schema/event-rsvps";
import { eventVolunteerInvitations } from "@/db/schema/event-volunteer-invitations";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type Participant, participants } from "@/db/schema/participants";
import { personSessions } from "@/db/schema/person-sessions";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrationNotes } from "@/db/schema/registration-notes";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { routing } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { seriesKey as seriesKeyOf } from "@/modules/events/domain/series";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { parseClubMember } from "@/modules/rsvp/domain/public-member";
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
   * The answers «Vin!» given with this address (§811, art. 15 GDPR): the event, the address and the name as typed, the person's own tick
   * «Vreau să apar cu numele», the language, the privacy notice's version they were given under, and when they were given and
   * confirmed — every column of the row. Gone thirty days after the event, or sooner at the person's own link.
   */
  rsvpAnswers: Array<{
    eventId: string;
    eventTitle: string | null;
    deliveryEmail: string;
    displayName: string | null;
    showName: boolean;
    /** The member mark the answer holds (§831): `DECLARED` (the person's tick), `ACCOUNT` (given from a member account), or null — never said. */
    clubMember: ReturnType<typeof parseClubMember>;
    locale: string;
    privacyNoticeVersion: number;
    confirmedAt: Date | null;
    /** When the «Vii?» email (§818) asked and wrote this row; with no `confirmedAt` it is a question nobody answered, not an answer. */
    askedAt: Date | null;
    createdAt: Date;
  }>;
  /**
   * The series this address refused the «Vii?» question for («Nu mă mai întreba la seria aceasta», §823, art. 15 GDPR): the series' key (the
   * event type and the default-language title, one line) and when, every column of the row but the address itself. Not erased with the
   * answers: the row is the objection, and forgetting it would ask the person again; it goes a year after the series' last date.
   */
  askRefusals: Array<{
    seriesKey: string;
    /**
     * The series as the club wrote it — the event type and the title of the series' latest date — for a screen that names it in words;
     * null when no event of the series is left (a series that no longer exists, or an `event:<id>` key of a deleted event).
     */
    series: { type: (typeof events.$inferSelect)["type"]; title: string } | null;
    canonicalizationVersion: number;
    createdAt: Date;
  }>;
  /**
   * The browsers remembered for this address (§811): when each was remembered, last used and expires — never the secret or its
   * fingerprint, which prove nothing to the person and are of no use to the club.
   */
  rememberedBrowsers: Array<{ deliveryEmail: string; displayName: string | null; createdAt: Date; lastUsedAt: Date; expiresAt: Date }>;
  /**
   * The club's invitations to volunteer sent to this address (§820, art. 15 GDPR): the event, the address as the club typed it, the club's
   * line in both languages, the language and the moments — every column of the row but the link's fingerprint, which proves nothing to the
   * person. Gone with the event's volunteers, thirty days after the event,
   * with the person's offer when the card deletes it, or at an Administrator's press on this screen (`eraseVolunteerInvitationsOfPerson`).
   */
  volunteerInvitations: Array<{
    eventId: string;
    eventTitle: string | null;
    deliveryEmail: string;
    messageRo: string | null;
    messageEn: string | null;
    locale: string;
    sentAt: Date;
    resentAt: Date | null;
    usedAt: Date | null;
    withdrawnAt: Date | null;
    expiresAt: Date;
  }>;
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
    /**
     * The address and the telephone number as stored. An offer found here is found by its address, so it has one; the telephone may
     * be null — a row the club typed without one (§865). A row typed with no address at all is no address's, and this page, which
     * searches by address, never lists it: it is deleted from the event's card, or by the thirty-day sweep, like every offer.
     */
    deliveryEmail: string | null;
    phone: string | null;
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
    /** «Vreau să apar pe lista publică a voluntarilor» (§821): the person's tick, or the organizers' record of it — what the event's page may name them by (art. 15 GDPR). */
    listOptIn: boolean;
    /** The privacy notice version the list tick was given under (§821); null with no tick. */
    listOptInNoticeVersion: number | null;
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
  /**
   * The results of a race entered for this person's registrations (§808; art. 15 GDPR): the race number, how the race ended, the times,
   * the positions and the category as the platform stores them, the club's note, and whether the race's results are public. Found through
   * the registration, so it is the person's own; a result row of a typed runner holds a name only the club wrote, and is not here.
   */
  results: Array<{
    registrationId: string;
    eventId: string;
    eventTitle: string | null;
    bibNumber: number;
    status: (typeof eventResults.$inferSelect)["status"];
    gunTimeMs: number | null;
    chipTimeMs: number | null;
    positionOverall: number | null;
    positionSex: number | null;
    positionCategory: number | null;
    categoryKey: string | null;
    note: string | null;
    /** The race's results are public on the event's page (`events.results_published`): the name shows only with the tick, but the row is public. */
    published: boolean;
    updatedAt: Date;
  }>;
  /**
   * The internal notes the organizers kept on this person's registrations (§777; art. 15 GDPR: an access request
   * covers them): the words as written, the moment, and the author's **role** — «Organizator», «Administrator» —
   * not their name. A colleague's name is that colleague's personal data, and what the person is entitled to know
   * is what is held about them and the kind of recipient who read it (art. 15(1)(c)), not who typed it (art. 15(4),
   * the lawyer's question, not decided here: whether a note may be withheld where it would reveal another person's
   * data). Deleted notes hold no words and are not listed; the registration's erase removes the rest.
   */
  notes: Array<{ registrationId: string; eventId: string; eventTitle: string | null; body: string; createdAt: Date; authorRole: StaffUser["role"] | null }>;
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

  // The answers «Vin!» (§811) and the browsers remembered for them, found by the same canonical address.
  const rsvpAnswers = await db
    .select({
      eventId: eventRsvps.eventId,
      eventTitle: eventTranslations.title,
      deliveryEmail: eventRsvps.deliveryEmail,
      displayName: eventRsvps.displayName,
      showName: eventRsvps.showName,
      clubMember: eventRsvps.clubMember,
      locale: eventRsvps.locale,
      privacyNoticeVersion: eventRsvps.privacyNoticeVersion,
      confirmedAt: eventRsvps.confirmedAt,
      askedAt: eventRsvps.askedAt,
      createdAt: eventRsvps.createdAt,
    })
    .from(eventRsvps)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, eventRsvps.eventId), eq(eventTranslations.locale, eventRsvps.locale)))
    .where(eq(eventRsvps.canonicalEmail, canonicalEmail))
    .orderBy(asc(eventRsvps.createdAt));
  const refusalRows = await db
    .select({ seriesKey: rsvpAskRefusals.seriesKey, canonicalizationVersion: rsvpAskRefusals.canonicalizationVersion, createdAt: rsvpAskRefusals.createdAt })
    .from(rsvpAskRefusals)
    .where(eq(rsvpAskRefusals.canonicalEmail, canonicalEmail))
    .orderBy(asc(rsvpAskRefusals.createdAt));
  // The key is the listing's (`events/domain/series.ts`): a lowercased title and an enum code. Staff read the series as the club wrote it, from its latest date.
  const askRefusals: PersonData["askRefusals"] = [];
  if (refusalRows.length > 0) {
    const dated = await db
      .select({ type: events.type, title: eventTranslations.title, startsAt: events.startsAt })
      .from(events)
      .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
      .orderBy(asc(events.startsAt));
    const latest = new Map<string, { type: (typeof events.$inferSelect)["type"]; title: string }>();
    for (const row of dated) latest.set(seriesKeyOf({ type: row.type, title: row.title }), { type: row.type, title: row.title });
    for (const row of refusalRows) askRefusals.push({ ...row, series: latest.get(row.seriesKey) ?? null });
  }
  const rememberedBrowsers = await db
    .select({
      deliveryEmail: personSessions.deliveryEmail,
      displayName: personSessions.displayName,
      createdAt: personSessions.createdAt,
      lastUsedAt: personSessions.lastUsedAt,
      expiresAt: personSessions.expiresAt,
    })
    .from(personSessions)
    .where(eq(personSessions.canonicalEmail, canonicalEmail))
    .orderBy(asc(personSessions.createdAt));

  // The club's invitations to volunteer (§820), by the same canonical address: the event's title in the invitation's language.
  const volunteerInvitations = await db
    .select({
      eventId: eventVolunteerInvitations.eventId,
      eventTitle: eventTranslations.title,
      deliveryEmail: eventVolunteerInvitations.deliveryEmail,
      messageRo: eventVolunteerInvitations.messageRo,
      messageEn: eventVolunteerInvitations.messageEn,
      locale: eventVolunteerInvitations.locale,
      sentAt: eventVolunteerInvitations.sentAt,
      resentAt: eventVolunteerInvitations.resentAt,
      usedAt: eventVolunteerInvitations.usedAt,
      withdrawnAt: eventVolunteerInvitations.withdrawnAt,
      expiresAt: eventVolunteerInvitations.expiresAt,
    })
    .from(eventVolunteerInvitations)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, eventVolunteerInvitations.eventId), eq(eventTranslations.locale, eventVolunteerInvitations.locale)))
    .where(eq(eventVolunteerInvitations.canonicalEmail, canonicalEmail))
    .orderBy(asc(eventVolunteerInvitations.sentAt));

  // The offers to volunteer (§754), found by the same canonical address: the event's title in Romanian, the role as the club wrote it.
  const offerRows = await db
    .select({
      id: eventVolunteers.id,
      eventId: eventVolunteers.eventId,
      eventTitle: eventTranslations.title,
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
      listOptIn: eventVolunteers.listOptIn,
      listOptInNoticeVersion: eventVolunteers.listOptInNoticeVersion,
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
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, eventVolunteers.eventId), eq(eventTranslations.locale, "ro")))
    // The agreement's version number (§758), through the row's own reference.
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .where(eq(eventVolunteers.canonicalEmail, canonicalEmail))
    .orderBy(asc(eventVolunteers.createdAt));
  // The roles each offer chose (§761) and the roles given (§837), every one of them: an access request is complete (art. 15 GDPR).
  const linkedRoles = (link: typeof eventVolunteerRoleChoices | typeof eventVolunteerRoleAssignments) =>
    offerRows.length > 0
      ? db
          .select({
            volunteerId: link.volunteerId,
            nameRo: eventVolunteerRoles.nameRo,
            nameEn: eventVolunteerRoles.nameEn,
            categoryRo: eventVolunteerCategories.nameRo,
            categoryEn: eventVolunteerCategories.nameEn,
            position: eventVolunteerRoles.position,
          })
          .from(link)
          .innerJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, link.roleId))
          .leftJoin(eventVolunteerCategories, eq(eventVolunteerCategories.id, eventVolunteerRoles.categoryId))
          .where(inArray(link.volunteerId, offerRows.map((offer) => offer.id)))
          .orderBy(asc(eventVolunteerRoles.position), asc(eventVolunteerRoles.createdAt), asc(eventVolunteerRoles.id))
      : [];
  const choiceRows = await linkedRoles(eventVolunteerRoleChoices);
  const givenRows = await linkedRoles(eventVolunteerRoleAssignments);
  // A role is named as a role is named alone (§774): «Direcționare (Traseu)», so the same name under two categories is two roles to read;
  // several roles given are joined by «, » (§837), none is null.
  const volunteerOffers = offerRows.map(({ id, ...offer }) => {
    const chosen = choiceRows.filter((choice) => choice.volunteerId === id);
    const given = givenRows.filter((role) => role.volunteerId === id);
    return {
      ...offer,
      roleNameRo: given.length > 0 ? given.map((role) => roleLabel(role, "ro")).join(", ") : null,
      roleNameEn: given.length > 0 ? given.map((role) => roleLabel(role, "en")).join(", ") : null,
      chosenRolesRo: chosen.map((choice) => roleLabel(choice, "ro")),
      chosenRolesEn: chosen.map((choice) => roleLabel(choice, "en")),
    };
  });

  const groupRuns = await groupRunDeclarationsOf(db, canonicalEmail);

  // The results entered for these registrations (§808): this person's own rows, by their registrations.
  const results =
    registrationIds.length > 0
      ? await db
          .select({
            registrationId: eventResults.registrationId,
            eventId: eventResults.eventId,
            eventTitle: eventTranslations.title,
            bibNumber: eventResults.bibNumber,
            status: eventResults.status,
            gunTimeMs: eventResults.gunTimeMs,
            chipTimeMs: eventResults.chipTimeMs,
            positionOverall: eventResults.positionOverall,
            positionSex: eventResults.positionSex,
            positionCategory: eventResults.positionCategory,
            categoryKey: eventResults.categoryKey,
            note: eventResults.note,
            published: events.resultsPublished,
            updatedAt: eventResults.updatedAt,
          })
          .from(eventResults)
          .innerJoin(events, eq(events.id, eventResults.eventId))
          .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, eventResults.eventId), eq(eventTranslations.locale, "ro")))
          .where(inArray(eventResults.registrationId, registrationIds))
          .orderBy(asc(eventResults.createdAt), asc(eventResults.id))
      : [];

  // The internal notes on these registrations (§777): live ones only, oldest first as the rest of this page, the
  // author as a role. `registrationIds` is this person's own registrations, so nobody else's note is read.
  const noteRows =
    registrationIds.length > 0
      ? await db
          .select({
            registrationId: registrationNotes.registrationId,
            body: registrationNotes.body,
            createdAt: registrationNotes.createdAt,
            authorRole: staffUsers.role,
          })
          .from(registrationNotes)
          .leftJoin(staffUsers, eq(staffUsers.id, registrationNotes.authorStaffUserId))
          .where(and(inArray(registrationNotes.registrationId, registrationIds), isNull(registrationNotes.deletedAt)))
          .orderBy(asc(registrationNotes.createdAt), asc(registrationNotes.id))
      : [];
  const notes = noteRows.map((note) => {
    const registration = rows.find((row) => row.registration.id === note.registrationId);
    return { ...note, eventId: registration?.registration.eventId ?? "", eventTitle: registration?.eventTitle ?? null };
  });

  const aboutThePerson = [
    ...(participant ? [eq(auditLogs.participantId, participant.id)] : []),
    ...(registrationIds.length > 0 ? [and(eq(auditLogs.entityType, "registration"), inArray(auditLogs.entityId, registrationIds))] : []),
  ];
  // The trail names the colleague who acted, as it always did — except for a note: the notes above carry the author as a
  // role and never a name (§777), so the rows for adding and deleting one keep the when and drop the who.
  const noteActions = new Set<string>(["registration.note_added", "registration.note_deleted"]);
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
        ).map((entry) => (noteActions.has(entry.action) ? { ...entry, actorName: null } : entry))
      : [];

  return {
    canonicalEmail,
    participant: participant ?? null,
    registrations: rows.map((row) => ({ ...row.registration, eventTitle: row.eventTitle })),
    declarationAcceptances: acceptances,
    messages,
    announcementRequests,
    rsvpAnswers: rsvpAnswers.map((answer) => ({ ...answer, clubMember: parseClubMember(answer.clubMember) })),
    askRefusals,
    rememberedBrowsers,
    volunteerInvitations,
    volunteerOffers,
    groupRunDeclarations: groupRuns,
    results: results.map((row) => ({ ...row, registrationId: row.registrationId as string })),
    notes,
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
 * Erase the answers «Vin!» and the remembered browsers of one canonical address (§811, art. 17 GDPR): the person asked, and an Administrator
 * — the role that reads everything held about a person (`assertAdministrator`) — presses. The rows go whole, the links with them
 * (`on delete cascade`), the public count is expired, and one audit row keeps the counts (`participant.rsvps_erased`), never the
 * address. Registrations, declarations and the rest are not touched: they have their own erase (BR-REQ-037-06).
 */
export async function eraseRsvpsOfPerson<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  canonicalEmail: string,
  now: Date,
): Promise<{ answers: number; browsers: number }> {
  assertAdministrator(actor);
  const counts = await db.transaction(async (tx) => {
    const answers = await tx.delete(eventRsvps).where(eq(eventRsvps.canonicalEmail, canonicalEmail)).returning({ id: eventRsvps.id });
    const browsers = await tx.delete(personSessions).where(eq(personSessions.canonicalEmail, canonicalEmail)).returning({ id: personSessions.id });
    // The «Nu mă mai întreba» links hold the address too (§823): they go with the answers. The refusals themselves stay — they are the objection.
    await tx.delete(rsvpRefuseTokens).where(eq(rsvpRefuseTokens.canonicalEmail, canonicalEmail));
    const result = { answers: answers.length, browsers: browsers.length };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "participant.rsvps_erased",
      entityType: "participant",
      entityId: null,
      metadata: result,
      now,
    });
    return result;
  });
  if (counts.answers > 0) revalidatePublicContent("places");
  return counts;
}

/**
 * Erase the club's invitations to volunteer sent to one canonical address (§820, art. 17 GDPR), on the person's request, by an Administrator
 * (`assertAdministrator`). The rows go whole — the address, the club's line in both languages and the link's fingerprint, so a link already in
 * an inbox stops working — whatever became of each invitation: an unused or withdrawn one holds an address and a line and nothing else, and
 * a person's offer (if there is one) is not touched, it has its own delete on the event's «Voluntari» card. One audit row keeps the count
 * (`participant.volunteer_invitations_erased`), never the address.
 */
export async function eraseVolunteerInvitationsOfPerson<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  canonicalEmail: string,
  now: Date,
): Promise<{ invitations: number }> {
  assertAdministrator(actor);
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(eventVolunteerInvitations)
      .where(eq(eventVolunteerInvitations.canonicalEmail, canonicalEmail))
      .returning({ id: eventVolunteerInvitations.id });
    const result = { invitations: deleted.length };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "participant.volunteer_invitations_erased",
      entityType: "participant",
      entityId: null,
      metadata: result,
      now,
    });
    return result;
  });
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
      rsvpAnswers: data.rsvpAnswers.length,
      askRefusals: data.askRefusals.length,
      rememberedBrowsers: data.rememberedBrowsers.length,
      volunteerOffers: data.volunteerOffers.length,
      volunteerInvitations: data.volunteerInvitations.length,
      groupRunDeclarations: data.groupRunDeclarations.length,
      results: data.results.length,
      notes: data.notes.length,
      auditRows: data.auditTrail.length,
    },
    now,
  });
  return data;
}
