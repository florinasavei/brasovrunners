import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { PARTNER_NAME_MAX, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canKeepRegistrationNotes, canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «De la parteneri» (the decision «De la parteneri»; the owner, 2026-11-11: who came through a partner or a sponsor, by the
 * partner's name): the organizers' own label on a person — a registration, a line of «Lista internă (doar notițe)», an
 * invitation by email. One nullable column on each (`partner_name`): a name present means «de la parteneri», none means not.
 *
 * Every screen that sets it shows one tick, «E de la parteneri», with the box «Numele partenerului sau sponsorului»: the box is
 * what is stored, the tick without a name is refused at the box (`PARTNER_NAME_MISSING`), and unticking clears the name
 * (`parsePartnerMark`). The box suggests the names already written at the event (`listPartnerSuggestions`).
 *
 * **A label, and nothing else.** No state, no place, no count, no email, no declaration: nothing here is read by the allocator,
 * the capacity formula, a public page, the race-day desk, an email or the file given to sponsors — only by the backoffice's
 * list, the registration's page, the internal list, the invitations, the registrations' Excel and CSV and «Toate datele unei
 * persoane» (`tests/unit/registrations/partner-never-leaves.test.ts`).
 *
 * **The trail** names who, when, which registration and whether a name is now present (`registration.partner_set`,
 * `{ partner }`) — never the name typed.
 */
type Actor = Pick<StaffUser, "id" | "role">;

export { PARTNER_NAME_MAX };

/** The box's name on every form that sets the mark; a refusal names it. */
export const PARTNER_NAME_FIELD = "partnerName";
/** The tick's name: posted `on` when ticked. */
export const PARTNER_TICK_FIELD = "partner";

/** How many earlier names the box suggests at most. */
export const PARTNER_SUGGESTIONS_MAX = 50;

/** What a form posts for the mark: the tick and the box, as they came. */
export type PartnerMarkInput = { partner: unknown; partnerName: unknown };

/** The tick and the box from a posted form, for `parsePartnerMark`. */
export function partnerMarkOf(form: FormData): PartnerMarkInput {
  return { partner: form.get(PARTNER_TICK_FIELD), partnerName: form.get(PARTNER_NAME_FIELD) };
}

/**
 * A name ready to store, or null for none: trimmed, at most `PARTNER_NAME_MAX` characters (refused naming the box otherwise).
 * The one normalisation the services apply to whatever reaches them, so a caller that did not parse a form stores the same.
 */
export function normalizePartnerName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return null;
  if ([...name].length > PARTNER_NAME_MAX) {
    throw new DomainError("VALIDATION_ERROR", `a partner's name holds at most ${PARTNER_NAME_MAX} characters`, [PARTNER_NAME_FIELD]);
  }
  return name;
}

/**
 * The tick and the box as one value: unticked is null (the name cleared), ticked is the name — refused naming the box when it
 * is empty (`PARTNER_NAME_MISSING`: «Scrie numele partenerului sau sponsorului, sau debifează …»). A name typed under an
 * unticked box is not kept: the tick is what says «de la parteneri».
 */
export function parsePartnerMark(input: PartnerMarkInput): string | null {
  const ticked = input.partner === "on" || input.partner === "1" || input.partner === true;
  if (!ticked) return null;
  const name = normalizePartnerName(input.partnerName);
  if (name === null) throw new DomainError("PARTNER_NAME_MISSING", "«E de la parteneri» needs the partner's or sponsor's name", [PARTNER_NAME_FIELD]);
  return name;
}

/** Where a name written from the start came from: a line of the internal list, or an invitation sent with it. */
export type PartnerMarkVia = "reserve" | "invitation";

/**
 * The name written on one registration inside the caller's transaction — the one body of the registration page's form
 * (`setRegistrationPartner`), of a line's moves (`reserve-list.ts`, through `admin-service.ts#enterOnWaitlistByStaff`) and of an
 * invitation taken up (`invitations.ts#acceptInvitation`, `service.ts#markInvitationAdopted`), so they can never write it
 * differently. One statement that changes the row only where it says otherwise — a second press writes nothing and no row —
 * then one audit row `registration.partner_set`, `{ partner }` (whether a name is now present) and, from a line or an
 * invitation, `via`. Never the name. Who may is the caller's to assert: `actorStaffUserId` is whoever the trail names.
 */
export async function writeRegistrationPartnerName<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  actorStaffUserId: string | null,
  registrationId: string,
  partnerName: string | null,
  now: Date,
  via?: PartnerMarkVia,
): Promise<{ changed: boolean; eventId: string }> {
  const name = normalizePartnerName(partnerName);
  const [changed] = await tx
    .update(registrations)
    .set({ partnerName: name, updatedAt: now })
    .where(and(eq(registrations.id, registrationId), sql`${registrations.partnerName} IS DISTINCT FROM ${name}`))
    .returning({ id: registrations.id, eventId: registrations.eventId });
  if (!changed) {
    const [exists] = await tx.select({ eventId: registrations.eventId }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
    if (!exists) throw new DomainError("NOT_FOUND", "no such registration");
    return { changed: false, eventId: exists.eventId };
  }
  await recordAuditEvent(tx, {
    actorStaffUserId,
    action: "registration.partner_set",
    entityType: "registration",
    entityId: changed.id,
    metadata: via ? { partner: name !== null, via } : { partner: name !== null },
    now,
  });
  return { changed: true, eventId: changed.eventId };
}

/**
 * «Salvează» under «E de la parteneri» on a registration's page: the tick and the box, set, changed or cleared. The
 * Administrator's alone (`canManageRegistrations`), asserted here as at the action's door (BR-REQ-060-01); the Organizer reads
 * the chip and gets no form. Any state, a cancelled row too — the label waits for a restart, which keeps it. No lock: it is
 * read by nothing that decides a place. A save that finds the name as asked writes nothing and no row.
 */
export async function setRegistrationPartner<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  input: PartnerMarkInput,
  now: Date,
): Promise<{ changed: boolean; eventId: string; partnerName: string | null }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not mark a registration as from a partner`);
  }
  const name = parsePartnerMark(input);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");
  const written = await db.transaction((tx) => writeRegistrationPartnerName(tx, actor.id, registrationId, name, now));
  return { ...written, partnerName: name };
}

/** One earlier name, and when it was written: the input of `suggestPartnerNames`. */
export type WrittenPartnerName = { name: string; at: Date };

/**
 * The names the box suggests: each once whatever its capitals (the newest spelling kept), newest first, at most `limit`.
 * The order a tie keeps is the input's.
 */
export function suggestPartnerNames(written: readonly WrittenPartnerName[], limit: number = PARTNER_SUGGESTIONS_MAX): string[] {
  const newestFirst = written
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.index - b.index);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of newestFirst) {
    if (names.length === limit) break;
    const key = entry.name.trim().toLocaleLowerCase("ro");
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    names.push(entry.name.trim());
  }
  return names;
}

/**
 * The partners' names already written at one event — on its registrations, its internal list's lines and its invitations — for
 * the box's native suggestions, so one partner keeps one spelling. Whoever may set the mark somewhere at the event reads them:
 * the Organizer and above (`canKeepRegistrationNotes`, the internal list's own rule), asserted here (BR-REQ-060-01). Three
 * small reads of one event's rows that carry a name, one row per name (`DISTINCT ON`) before the window; when each was written is the row's last write (an invitation's send).
 */
export async function listPartnerSuggestions<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<string[]> {
  if (!canKeepRegistrationNotes(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's partners`);
  if (!isUuid(eventId)) return [];
  // One row per name whatever its capitals, its newest write and that write's spelling — in SQL, before the window — so one
  // partner with hundreds of rows never pushes an older partner's name out of the box's suggestions.
  const onRegistrationsDistinct = db
    .selectDistinctOn([sql`lower(${registrations.partnerName})`], { name: registrations.partnerName, at: registrations.updatedAt })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), isNotNull(registrations.partnerName)))
    .orderBy(sql`lower(${registrations.partnerName})`, desc(registrations.updatedAt))
    .as("on_registrations");
  const onRegistrations = await db.select({ name: onRegistrationsDistinct.name, at: onRegistrationsDistinct.at }).from(onRegistrationsDistinct).orderBy(desc(onRegistrationsDistinct.at)).limit(PARTNER_SUGGESTIONS_MAX);
  const onLinesDistinct = db
    .selectDistinctOn([sql`lower(${eventReserveEntries.partnerName})`], { name: eventReserveEntries.partnerName, at: eventReserveEntries.updatedAt })
    .from(eventReserveEntries)
    .where(and(eq(eventReserveEntries.eventId, eventId), isNotNull(eventReserveEntries.partnerName)))
    .orderBy(sql`lower(${eventReserveEntries.partnerName})`, desc(eventReserveEntries.updatedAt))
    .as("on_lines");
  const onLines = await db.select({ name: onLinesDistinct.name, at: onLinesDistinct.at }).from(onLinesDistinct).orderBy(desc(onLinesDistinct.at)).limit(PARTNER_SUGGESTIONS_MAX);
  const onInvitationsDistinct = db
    .selectDistinctOn([sql`lower(${eventInvitations.partnerName})`], { name: eventInvitations.partnerName, at: eventInvitations.createdAt })
    .from(eventInvitations)
    .where(and(eq(eventInvitations.eventId, eventId), isNotNull(eventInvitations.partnerName)))
    .orderBy(sql`lower(${eventInvitations.partnerName})`, desc(eventInvitations.createdAt))
    .as("on_invitations");
  const onInvitations = await db.select({ name: onInvitationsDistinct.name, at: onInvitationsDistinct.at }).from(onInvitationsDistinct).orderBy(desc(onInvitationsDistinct.at)).limit(PARTNER_SUGGESTIONS_MAX);
  const written = [...onRegistrations, ...onLines, ...onInvitations].filter((row): row is WrittenPartnerName => row.name !== null);
  return suggestPartnerNames(written);
}
