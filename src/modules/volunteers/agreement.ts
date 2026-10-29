import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers, type VolunteerAgreementMethod } from "@/db/schema/event-volunteers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { recordAuditEvent } from "@/modules/audit/repository";
import { isLegalDocumentBody, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { MINIMUM_AGE_MERGE_FIELD, mergeFieldsIn, minimumAgeMergeValue, namesVolunteerRoleChoices, type MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { type SignatureTrace, traceColumns } from "@/modules/legal-documents/domain/signature-trace";
import { findCurrentApprovedDocument, noticeDescribesVolunteerAgreement, volunteerAgreementInForce } from "@/modules/legal-documents/repository";
import { DEFAULT_TOKEN_HOURS } from "@/modules/notifications/domain/token-lifetime";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  agreementMinimumAge,
  agreementRolesStamp,
  agreementRoleWords,
  type CategoryContact,
  categoryContactOf,
  compareRoles,
  isVolunteerMinor,
  refusedFields,
  roleLabel,
  type RoleWords,
  tasksWords,
  volunteerAgreementAcceptSchema,
} from "./domain/volunteer";

/**
 * The volunteer agreement (§758, amending §754; the owner, 2026-10-13: «trebuie să avem și un document gen
 * „contract de voluntariat” simplu, unde zicem că nu sunt plătiți, că trebuie să respecte atribuțiunile»).
 *
 * One approved legal text (`VOLUNTEER_AGREEMENT`, `legal-documents/templates/volunteer-agreement.ts`) that every
 * volunteer accepts before being listed, in one of three ways:
 *
 * - **on the event page's form** — the tick «Am citit și accept contractul de voluntariat», with the age tick,
 *   recorded by `submitVolunteer` in the sign-up's own transaction (`agreementAcceptance` below);
 * - **from a link** — for a person an organizer entered by hand: «Trimite linkul contractului» queues one email
 *   (`requestVolunteerAgreement`); the link is minted when the email leaves (`mintVolunteerAgreementLink`), only
 *   its SHA-256 kept on the row, single use, and the page it opens never writes (AGENTS.md §12.8): reading it is
 *   `readVolunteerAgreementLink`, accepting is the page's POST, `acceptVolunteerAgreementByLink`;
 * - **on paper at the desk** — the organizers print the agreement filled for that person (`agreement-pdf.ts`),
 *   the person signs it, and «Semnat pe hârtie» records it (`recordPaperVolunteerAgreement`), naming who recorded it.
 *
 * Every way records the same five facts on the volunteer's row: the version accepted, when, how, in which
 * language, and the SHA-256 of the exact text read with its blanks filled (§556's `signedTextHash`) — with the
 * blanks themselves kept (`agreement_facts`), so the PDF prints what was accepted whatever the role or the event
 * become afterwards (§57's rule for a signed declaration).
 */

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayManage(actor: Actor): void {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an event's volunteers`);
  }
}

// ---------------------------------------------------------------------------------------------
// The blanks
// ---------------------------------------------------------------------------------------------

/**
 * The agreement's blanks as one acceptance fills them: the person, the role given or the roles chosen (§761), the
 * event, the age and the moment.
 */
export const AGREEMENT_FACT_FIELDS = [
  "volunteer",
  "volunteerRole",
  "volunteerTasks",
  "volunteerRoleChoices",
  "volunteerChoiceTasks",
  "volunteerGuardian",
  "event",
  "eventDate",
  "eventLocation",
  "minimumAge",
  "signedAt",
] as const;

export type AgreementFacts = Record<(typeof AGREEMENT_FACT_FIELDS)[number], string>;

/**
 * The blanks added after acceptances were already kept (§761, §768): a row accepted before reads them as "" — its text
 * named none of them (`{{volunteerGuardian}}` is the guardian's name, "" for an adult, which drops the minors' clause).
 */
const LATER_FACT_FIELDS: ReadonlySet<string> = new Set(["volunteerRoleChoices", "volunteerChoiceTasks", "volunteerGuardian"]);

const agreementFactsSchema = z.object(
  Object.fromEntries(AGREEMENT_FACT_FIELDS.map((field) => [field, LATER_FACT_FIELDS.has(field) ? z.string().default("") : z.string()])) as Record<
    (typeof AGREEMENT_FACT_FIELDS)[number],
    z.ZodString
  >,
);

/** The row's `agreement_facts`, or null for a row with none (not accepted) or one nobody could read. */
export function readAgreementFacts(value: unknown): AgreementFacts | null {
  const parsed = agreementFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A role as the agreement names it: its words in both languages. */
export type AgreementRole = RoleWords;

/**
 * A role of one person as the agreement and the emails read it: its words, the words of the category it sits under (§774, for
 * «Direcționare (Traseu)») and that category's contact person, null while the category has none or the role sits under none.
 */
export type AgreementRoleRow = RoleWords & { id: string; contact?: CategoryContact | null };

/** The roles one person's agreement names: the ones the organizers gave them (§837: one or several; none while nobody has) and the ones they chose. */
export type AgreementRoles = { assigned: AgreementRoleRow[]; chosen: AgreementRoleRow[] };

export { tasksWords };

/**
 * One volunteer's roles as the agreement names them (§761): the roles given (`event_volunteer_role_assignments`, §837) and
 * the roles chosen (`event_volunteer_role_choices`), each in the club's order — read in the caller's transaction.
 */
export async function volunteerRoles<T extends Record<string, unknown>>(db: Database<T>, volunteer: { id: string }): Promise<AgreementRoles> {
  const columns = {
    id: eventVolunteerRoles.id,
    nameRo: eventVolunteerRoles.nameRo,
    nameEn: eventVolunteerRoles.nameEn,
    // The role's plain words (§765): what the sentence «Ce presupune rolul» and the emails say, one line per paragraph.
    descriptionRo: eventVolunteerRoles.descriptionWordsRo,
    descriptionEn: eventVolunteerRoles.descriptionWordsEn,
    position: eventVolunteerRoles.position,
    createdAt: eventVolunteerRoles.createdAt,
    // The heading the role sits under and its contact person (§774), through a left join: a role under none has nulls.
    categoryRo: eventVolunteerCategories.nameRo,
    categoryEn: eventVolunteerCategories.nameEn,
    contactName: eventVolunteerCategories.contactName,
    contactPhone: eventVolunteerCategories.contactPhone,
    contactEmail: eventVolunteerCategories.contactEmail,
  };
  const chosen = await db
    .select(columns)
    .from(eventVolunteerRoleChoices)
    .innerJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteerRoleChoices.roleId))
    .leftJoin(eventVolunteerCategories, eq(eventVolunteerCategories.id, eventVolunteerRoles.categoryId))
    .where(eq(eventVolunteerRoleChoices.volunteerId, volunteer.id));
  const assigned = await db
    .select(columns)
    .from(eventVolunteerRoleAssignments)
    .innerJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteerRoleAssignments.roleId))
    .leftJoin(eventVolunteerCategories, eq(eventVolunteerCategories.id, eventVolunteerRoles.categoryId))
    .where(eq(eventVolunteerRoleAssignments.volunteerId, volunteer.id));
  const words = (row: (typeof chosen)[number]): AgreementRoleRow => ({
    id: row.id,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    descriptionRo: row.descriptionRo,
    descriptionEn: row.descriptionEn,
    categoryRo: row.categoryRo,
    categoryEn: row.categoryEn,
    contact: categoryContactOf(row),
  });
  return { assigned: assigned.sort(compareRoles).map(words), chosen: chosen.sort(compareRoles).map(words) };
}

/**
 * The agreement's blanks for one person, their roles and one event, in one language — everything but the moment
 * of acceptance. The event's facts as a race's declaration fills them (`eventMergeValues`: its title, its date
 * in words, its place — the city while the place is to be announced, §328); the age is the platform's
 * (`agreementMinimumAge` of the text read: 14, or 18 for a text approved before the minors' clause), never the event's; the role is the one given, else the roles chosen — in their own
 * sentence when the text read (`body`) names `{{volunteerRoleChoices}}`, else their names alone in the role's blank
 * (`agreementRoleWords`, §761); no description in this language answers its tasks' field with "", which leaves its
 * sentence out. The values are the facts alone, so the text a person reads before accepting, the fingerprint
 * and the PDF are filled from one set and cannot differ.
 */
export async function agreementBlanks<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    eventId: string;
    name: string;
    roles: { assigned: readonly RoleWords[]; chosen: readonly RoleWords[] };
    locale: Locale;
    body: unknown;
    /** The parent or guardian of a volunteer under eighteen (§768): their name fills `{{volunteerGuardian}}`; none, or an adult, leaves it "" and the minors' clause out. */
    guardianName?: string | null;
  },
): Promise<{ facts: Omit<AgreementFacts, "signedAt">; timezone: string }> {
  const event = await eventMergeValues(db, input.eventId, input.locale);
  const role = agreementRoleWords(input.roles, input.locale, namesVolunteerRoleChoices(input.body));
  return {
    facts: {
      volunteer: input.name,
      volunteerRole: role.role,
      volunteerTasks: role.tasks,
      volunteerRoleChoices: role.choices,
      volunteerChoiceTasks: role.choiceTasks,
      volunteerGuardian: input.guardianName ?? "",
      event: event?.values.event ?? "",
      eventDate: event?.values.eventDate ?? "",
      eventLocation: event?.values.eventLocation ?? "",
      minimumAge: minimumAgeMergeValue(agreementMinimumAge(input.body), input.locale),
    },
    timezone: event?.timezone ?? CLUB_TIME_ZONE,
  };
}

/** The moment of acceptance inside its sentence, in the event's zone: «joi, 24 sept. 2026, la 18:05». */
export function acceptedAtWords(at: Date, locale: Locale, timeZone: string): string {
  return formatDay(at, { locale, timeZone, style: "long", withTime: true, position: "inline" });
}

/** The version's body as stored, or an empty one (an unreadable body merges to nothing, as everywhere). */
export function agreementBody(body: unknown): LegalDocumentBody {
  return isLegalDocumentBody(body) ? body : { sections: [] };
}

/** What every way of accepting writes on the volunteer's row, in one shape. */
export type AgreementAcceptanceColumns = {
  agreementDocumentId: string;
  agreementAcceptedAt: Date;
  agreementMethod: VolunteerAgreementMethod;
  agreementLocale: Locale;
  agreementTextHash: string;
  agreementFacts: AgreementFacts;
  /** The electronic acceptance's trace (§771): the IP address and browser of the press; null for «PAPER». */
  agreementIp: string | null;
  agreementUserAgent: string | null;
  agreementRecordedByStaffUserId: string | null;
  declaredAdult: boolean;
  agreementTokenHash: null;
  agreementTokenExpiresAt: null;
};

/**
 * One acceptance of the agreement in force, as the row keeps it: the version, the moment, the way, the language,
 * the blanks as filled and the fingerprint of the text with them (§556) — hashed before the row is written, in
 * the caller's transaction. Any live link dies with it (an accepted agreement needs no other way in), and the age
 * is recorded as declared: on the form and the link page by its own tick; on paper only when the version signed
 * states it — its text names `{{minimumAge}}` — since the club may have approved one that does not, and no box on
 * the desk asks it.
 */
export async function agreementAcceptance<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    eventId: string;
    name: string;
    roles: { assigned: readonly RoleWords[]; chosen: readonly RoleWords[] };
    locale: Locale;
    document: { id: string; title: string; body: unknown };
    method: VolunteerAgreementMethod;
    recordedBy?: string | null;
    /** A volunteer under eighteen (§768): the guardian's name in the text's `{{volunteerGuardian}}`, and no «declared of age» whatever the way. */
    guardianName?: string | null;
    /** The IP address and browser of the press (§771), kept for «FORM» and «LINK» and dropped for «PAPER», whatever is passed. */
    trace?: SignatureTrace;
  },
  now: Date,
): Promise<AgreementAcceptanceColumns> {
  const blanks = await agreementBlanks(db, { ...input, body: input.document.body });
  const facts: AgreementFacts = { ...blanks.facts, signedAt: acceptedAtWords(now, input.locale, blanks.timezone) };
  const trace = traceColumns(input.trace, input.method !== "PAPER");
  return {
    agreementDocumentId: input.document.id,
    agreementAcceptedAt: now,
    agreementMethod: input.method,
    agreementLocale: input.locale,
    agreementTextHash: signedTextHash({ title: input.document.title, body: agreementBody(input.document.body), values: facts }),
    agreementFacts: facts,
    agreementIp: trace.ip,
    agreementUserAgent: trace.userAgent,
    agreementRecordedByStaffUserId: input.recordedBy ?? null,
    // «Am cel puțin 18 ani»: never for a volunteer under eighteen — their parent accepts beside them (§768).
    declaredAdult: !input.guardianName && (input.method !== "PAPER" || mergeFieldsIn(input.document.body).has(MINIMUM_AGE_MERGE_FIELD)),
    agreementTokenHash: null,
    agreementTokenExpiresAt: null,
  };
}

/** The facts as merge values: what the PDF and the link page fill the text with. */
export function agreementMergeValues(facts: Partial<AgreementFacts>): MergeValues {
  return { ...facts };
}

// ---------------------------------------------------------------------------------------------
// The link (AGENTS.md §12.8: hashed at rest, single use, GET never mutates)
// ---------------------------------------------------------------------------------------------

/**
 * A fresh link for one volunteer, minted when its email leaves (`notifications/render.ts`), never when it is
 * queued: the secret is in the email alone (§14.5), the row keeps its SHA-256 and its expiry, and a newer link
 * replaces the older one in the same statement — the newest email is the one whose link works. Null for a row
 * that has accepted since, been cancelled or deleted, or whose address is no longer the one the email goes to
 * (`recipientEmail`, the queued row's, compared through the canonicalizer, §10.4): an organizer corrected it while
 * the email waited, and whoever reads the old mailbox must not accept in the person's name. Nothing left to ask
 * there, and the email is withdrawn.
 */
export async function mintVolunteerAgreementLink<T extends Record<string, unknown>>(
  db: Database<T>,
  volunteerId: string,
  recipientEmail: string,
  now: Date,
): Promise<{ secret: string; expiresAt: Date } | null> {
  if (!isUuid(volunteerId)) return null;
  const recipient = canonicalOrNull(recipientEmail);
  if (recipient === null) return null;
  const secret = generateTokenSecret();
  const expiresAt = new Date(now.getTime() + DEFAULT_TOKEN_HOURS * 60 * 60_000);
  const [row] = await db
    .update(eventVolunteers)
    .set({ agreementTokenHash: hashTokenSecret(secret), agreementTokenExpiresAt: expiresAt })
    .where(
      and(
        eq(eventVolunteers.id, volunteerId),
        eq(eventVolunteers.canonicalEmail, recipient),
        isNull(eventVolunteers.agreementAcceptedAt),
        ne(eventVolunteers.state, "CANCELLED"),
      ),
    )
    .returning({ id: eventVolunteers.id });
  return row ? { secret, expiresAt } : null;
}

/** An address's identity (§10.4), or null for one the canonicalizer refuses — which matches no row. */
export function canonicalOrNull(address: string): string | null {
  try {
    return canonicalizeEmail(address).canonicalEmail;
  } catch {
    return null;
  }
}

/** The row a live link opens: unknown, spent, expired or cancelled all read as none — one answer (§13.2). */
async function liveLinkRow<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date, lock: boolean) {
  if (!isWellFormedTokenSecret(secret)) return undefined;
  const query = db
    .select({
      id: eventVolunteers.id,
      eventId: eventVolunteers.eventId,
      name: eventVolunteers.name,
      email: eventVolunteers.email,
      locale: eventVolunteers.locale,
      state: eventVolunteers.state,
      age: eventVolunteers.age,
      guardianName: eventVolunteers.guardianName,
      acceptedAt: eventVolunteers.agreementAcceptedAt,
      expiresAt: eventVolunteers.agreementTokenExpiresAt,
    })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.agreementTokenHash, hashTokenSecret(secret)));
  const [row] = lock ? await query.for("update").limit(1) : await query.limit(1);
  if (!row || row.acceptedAt !== null || row.state === "CANCELLED" || !row.expiresAt || row.expiresAt.getTime() <= now.getTime()) return undefined;
  return row;
}

export type AgreementLinkView =
  /** The link is good: the person, the role, the event, and the agreement in force in this language, filled. */
  | {
      status: "open";
      name: string;
      /** A volunteer under eighteen (§768): the page asks no «Am cel puțin 18 ani» — their parent or guardian accepts beside them. */
      minor: boolean;
      eventTitle: string;
      /** The role the organizers gave the person, in the page's language, or null while nobody has (§761). */
      roleName: string | null;
      /** The roles the person chose, in the page's language and the club's order: the page names them while no role is given. */
      chosenRoleNames: string[];
      document: { id: string; version: number; effectiveAt: Date; title: string; body: unknown };
      /** The blanks as accepting now would fill them; the moment stays a blank until it happens. */
      values: MergeValues;
    }
  /** No agreement in force in this language: nothing to accept until the club approves one. */
  | { status: "noAgreement" }
  /** Unknown, spent, expired, or the person was cancelled: one answer whatever the reason (§13.2). */
  | { status: "invalid" };

/**
 * What the link's page shows — a read, never a write (AGENTS.md §12.8: a mail scanner that opens the link
 * accepts nothing). The agreement is the one in force in the page's language, filled for this person as accepting
 * would fill it; the moment of acceptance is the blank it is until the person presses.
 */
export async function readVolunteerAgreementLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
): Promise<AgreementLinkView> {
  const row = await liveLinkRow(db, secret, now, false);
  if (!row) return { status: "invalid" };
  const document = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, locale, now);
  if (!document) return { status: "noAgreement" };
  const roles = await volunteerRoles(db, row);
  if (roles.assigned.length === 0 && roles.chosen.length === 0) return { status: "invalid" };
  const minor = isVolunteerMinor(row.age) && row.guardianName !== null;
  const blanks = await agreementBlanks(db, { eventId: row.eventId, name: row.name, roles, locale, body: document.body, guardianName: minor ? row.guardianName : null });
  const nameOf = (role: RoleWords) => roleLabel(role, locale);
  return {
    status: "open",
    name: row.name,
    minor,
    eventTitle: blanks.facts.event,
    // The roles given, «Masă, Traseu» (§837), or null while nobody gave one.
    roleName: roles.assigned.length > 0 ? roles.assigned.map(nameOf).join(", ") : null,
    chosenRoleNames: roles.chosen.map(nameOf),
    document: { id: document.id, version: document.version, effectiveAt: document.effectiveAt, title: document.title, body: document.body },
    values: agreementMergeValues(blanks.facts),
  };
}

export type AgreementAcceptOutcome = { outcome: "accepted"; volunteerId: string } | { outcome: "invalid" } | { outcome: "noAgreement" };

/**
 * «Accept contractul» on the link's page — the POST, the only write the link leads to. Refuses, as the person's
 * own fix, a tick not given (`VALIDATION_ERROR` naming `agreement` or `adult`); answers `invalid` for a link that
 * is unknown, spent, expired or whose volunteer was cancelled, and `noAgreement` while no version is in force in
 * the page's language. On a good link, in one transaction: the row locked by its hash, the acceptance written
 * (the version in force, the moment, `LINK`, the language, the fingerprint, the blanks) and the hash cleared in
 * the same statement that matches it — a second press, a second tab, finds nothing (single use) — the person's
 * copy queued (`VOLUNTEER_AGREEMENT_ACCEPTED`, the PDF attached at the send) and the act audited with no name.
 */
export async function acceptVolunteerAgreementByLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  rawInput: unknown,
  now: Date,
  /** The IP address and browser of the press (§771), read by the action: the electronic acceptance's trace. */
  trace?: SignatureTrace,
): Promise<AgreementAcceptOutcome> {
  const parsed = volunteerAgreementAcceptSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "the agreement's ticks are missing", refusedFields(parsed.error));
  const input = parsed.data;
  if (!isWellFormedTokenSecret(secret)) return { outcome: "invalid" };
  const hash = hashTokenSecret(secret);

  return db.transaction(async (tx): Promise<AgreementAcceptOutcome> => {
    const row = await liveLinkRow(tx, secret, now, true);
    if (!row) return { outcome: "invalid" };
    const minor = isVolunteerMinor(row.age) && row.guardianName !== null;
    // «Am cel puțin 18 ani» is asked of everybody but a volunteer under eighteen, whose guardian accepts beside them (§768).
    if (!minor && !input.adult) throw new DomainError("VALIDATION_ERROR", "the age tick is missing", ["adult"]);
    const document = await findCurrentApprovedDocument(tx, VOLUNTEER_AGREEMENT_KEY, input.locale, now);
    if (!document) return { outcome: "noAgreement" };
    const roles = await volunteerRoles(tx, row);
    if (roles.assigned.length === 0 && roles.chosen.length === 0) return { outcome: "invalid" };
    const acceptance = await agreementAcceptance(
      tx,
      { eventId: row.eventId, name: row.name, roles, locale: input.locale, document, method: "LINK", guardianName: minor ? row.guardianName : null, trace },
      now,
    );
    const [written] = await tx
      .update(eventVolunteers)
      .set({ ...acceptance, updatedAt: now })
      // The hash in the WHERE: the statement that spends the link is the one that matches it.
      .where(and(eq(eventVolunteers.id, row.id), eq(eventVolunteers.agreementTokenHash, hash), isNull(eventVolunteers.agreementAcceptedAt)))
      .returning({ id: eventVolunteers.id });
    if (!written) return { outcome: "invalid" };
    // The person's copy — never to a row with no address (§864). Clearing an address kills a live link (`changeVolunteer`), so a row
    // reached by a link has one; the guard is the rule said where the email is queued.
    if (row.email !== null) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "VOLUNTEER_AGREEMENT_ACCEPTED",
        locale: input.locale,
        recipientEmail: row.email,
        payload: { eventId: row.eventId, volunteerId: row.id },
        idempotencyKey: `volunteer:${row.id}:agreement-accepted`,
        now,
      });
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      action: "volunteer.agreement_accepted",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id, version: document.version, method: "LINK" },
      now,
    });
    return { outcome: "accepted", volunteerId: row.id };
  });
}

// ---------------------------------------------------------------------------------------------
// The organizers' two verbs
// ---------------------------------------------------------------------------------------------

/** The volunteer of this event, locked for the change; NOT_FOUND for another event's or none. */
async function lockedVolunteer<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, id: string) {
  const [row] = await tx
    .select()
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.id, id), eq(eventVolunteers.eventId, eventId)))
    .for("update")
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "the volunteer is not there");
  return row;
}

function assertIds(...ids: readonly string[]): void {
  if (ids.some((id) => !isUuid(id))) throw new DomainError("NOT_FOUND", "the event or the volunteer is not there");
}

/**
 * «Trimite linkul contractului» (§758): one email to a volunteer who has not accepted the agreement, with the
 * agreement in force and the single-use link to accept it — minted at the send, so a press queues a message and
 * never a secret (§14.5). Refuses an actor who may not (FORBIDDEN), a volunteer not of this event (NOT_FOUND), one
 * who has accepted (`VOLUNTEER_AGREEMENT_ACCEPTED`) or was cancelled (CONFLICT), and any press while no agreement
 * is in force in every language (`VOLUNTEER_AGREEMENT_MISSING`) or while the privacy notice in force does not
 * describe its acceptance (`VOLUNTEER_AGREEMENT_NOTICE`, `{{volunteerAgreement}}`: the link leads to an acceptance
 * the notice must name), and a row with no address (`VOLUNTEER_NO_EMAIL`, §864: the card draws no button for it — the
 * agreement is signed on paper — so only a forged or stale post reaches this). Each press is its own email (a resend
 * is a new trigger, §12.11) and the newest link replaces the older one when it leaves.
 */
export async function requestVolunteerAgreement<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: string },
  now: Date,
): Promise<void> {
  assertMayManage(actor);
  assertIds(request.eventId, request.id);
  if (!(await volunteerAgreementInForce(db, now))) throw new DomainError("VOLUNTEER_AGREEMENT_MISSING", "no volunteer agreement is in force");
  await assertNoticeDescribesAgreement(db, now);
  await db.transaction(async (tx) => {
    const row = await lockedVolunteer(tx, request.eventId, request.id);
    if (row.agreementAcceptedAt) throw new DomainError("VOLUNTEER_AGREEMENT_ACCEPTED", "the volunteer has accepted the agreement");
    if (row.state === "CANCELLED") throw new DomainError("CONFLICT", "a cancelled volunteer is not asked to accept");
    if (row.email === null) throw new DomainError("VOLUNTEER_NO_EMAIL", "the volunteer has no address: the agreement is signed on paper");
    await tx.update(eventVolunteers).set({ agreementRequestedAt: now, updatedAt: now }).where(eq(eventVolunteers.id, row.id));
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "VOLUNTEER_AGREEMENT_REQUEST",
      locale: row.locale,
      recipientEmail: row.email,
      payload: { eventId: row.eventId, volunteerId: row.id },
      idempotencyKey: `volunteer:${row.id}:agreement-request:${now.getTime()}`,
      requestedByStaffUserId: actor.id,
      now,
    });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.agreement_requested",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id },
      now,
    });
  });
}

/** The privacy notice in force names `{{volunteerAgreement}}` in every language, or the verb is refused (§758). */
async function assertNoticeDescribesAgreement<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<void> {
  if (!(await noticeDescribesVolunteerAgreement(db, now))) {
    throw new DomainError("VOLUNTEER_AGREEMENT_NOTICE", "the privacy notice in force does not describe the volunteer agreement");
  }
}

/**
 * What the desk printed: the version the «PDF de semnat» carried and the roles it named — the role given, or the
 * roles chosen (`agreementRolesStamp`, §761) — the card posts both.
 */
export type PrintedAgreement = { documentId: string; roles: string };

/**
 * «Semnat pe hârtie» (§758): the person signed the printed agreement at the desk, and an organizer records it —
 * the version in force in the row's language (the one the desk's PDF prints), the moment of the press, `PAPER`,
 * and who recorded it; the signed sheet stays with the club, and the person is sent their copy by email
 * (`VOLUNTEER_AGREEMENT_ACCEPTED`, the PDF attached at the send), as after the link — unless the row has no address
 * (§864): the paper is that row's one way, and nothing is sent. Refuses as
 * `requestVolunteerAgreement` does — a missing address excepted —, and — `VOLUNTEER_AGREEMENT_REPRINT` — when the version in force or the
 * person's role is no longer the one the card printed (`printed`): what the row records must be what the sheet
 * says, so a new version approved, or a role changed, between the print and the press asks for a new sheet. The
 * staff member records the person's signature; they never sign for the person (CLAUDE.md: no staff-signed
 * declaration — the same line for this agreement).
 */
export async function recordPaperVolunteerAgreement<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; id: string; printed: PrintedAgreement },
  now: Date,
): Promise<void> {
  assertMayManage(actor);
  assertIds(request.eventId, request.id);
  await assertNoticeDescribesAgreement(db, now);
  await db.transaction(async (tx) => {
    const row = await lockedVolunteer(tx, request.eventId, request.id);
    if (row.agreementAcceptedAt) throw new DomainError("VOLUNTEER_AGREEMENT_ACCEPTED", "the volunteer has accepted the agreement");
    if (row.state === "CANCELLED") throw new DomainError("CONFLICT", "a cancelled volunteer is not recorded");
    const document = await findCurrentApprovedDocument(tx, VOLUNTEER_AGREEMENT_KEY, row.locale, now);
    if (!document) throw new DomainError("VOLUNTEER_AGREEMENT_MISSING", "no volunteer agreement is in force");
    const roles = await volunteerRoles(tx, row);
    const stamp = agreementRolesStamp(roles.assigned.map((role) => role.id), roles.chosen.map((role) => role.id));
    if (document.id !== request.printed.documentId || stamp !== request.printed.roles) {
      throw new DomainError("VOLUNTEER_AGREEMENT_REPRINT", "the version in force or the roles changed since the sheet was printed");
    }
    if (roles.assigned.length === 0 && roles.chosen.length === 0) throw new DomainError("NOT_FOUND", "the volunteer has no role");
    const acceptance = await agreementAcceptance(
      tx,
      {
        eventId: row.eventId,
        name: row.name,
        roles,
        locale: row.locale,
        document,
        method: "PAPER",
        recordedBy: actor.id,
        guardianName: isVolunteerMinor(row.age) ? row.guardianName : null,
      },
      now,
    );
    await tx.update(eventVolunteers).set({ ...acceptance, updatedAt: now }).where(eq(eventVolunteers.id, row.id));
    // The person's copy (§758): the agreement they signed, by email — the club keeps the sheet. A row with no address (§864) gets
    // none, and nothing is queued for it: the signed sheet is the record, and the card's PDF prints it again on asking.
    if (row.email !== null) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "VOLUNTEER_AGREEMENT_ACCEPTED",
        locale: row.locale,
        recipientEmail: row.email,
        payload: { eventId: row.eventId, volunteerId: row.id },
        idempotencyKey: `volunteer:${row.id}:agreement-accepted`,
        requestedByStaffUserId: actor.id,
        now,
      });
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.agreement_recorded",
      entityType: "event",
      entityId: row.eventId,
      metadata: { volunteerId: row.id, version: document.version, method: "PAPER" },
      now,
    });
  });
}
