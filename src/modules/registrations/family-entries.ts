import { and, asc, eq, gt, inArray, lte, min } from "drizzle-orm";
import { pendingFamilyEntries, type PendingFamilyEntry } from "@/db/schema/family-entries";
import { ACTIVE_REGISTRATION_STATUSES, registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { adultOnTheFamilyForm, withoutAnotherAdultsConsents } from "./fields";
import { composeLegalName } from "./names";

/**
 * Another person's registration waiting for the address's confirmation (§NNN, amending §389):
 * where it is kept, read and let go. The table's own comment (`db/schema/family-entries.ts`) says
 * what a row is and is not; this module is every query on it.
 */

/**
 * What of a validated public submission is kept for the confirmation (§NNN): the form as posted,
 * which `submitRegistration` reads again under the same schema when the address confirms — minus
 * what is not the other person's:
 *
 * - the address and its repetition: the registration takes the participant's, never one kept here;
 * - the anti-bot fields: the submission that wrote this passed them, and the press behind the
 *   emailed link is not a form a machine timed (§389);
 * - for another adult, the consents only that adult can give (§421, `withoutAnotherAdultsConsents`)
 *   — the health note, the socials, the public-list tick, the first-person fitness statement — so a
 *   third party's consent for an adult is never stored, not even for two days. A minor's parent
 *   consents for the child, and those are kept as the parent gave them;
 * - the adult's acknowledgement (`fitnessAcknowledged`): it is ticked on the confirmation page, by
 *   the person pressing it, not carried over from a form that never asked it.
 *
 * Adult or minor from `now`, the submission's instant, as the service decides it again on the press.
 */
export function familyEntryFields(input: Record<string, unknown>, now: Date): Record<string, unknown> {
  const kept = withoutAnotherAdultsConsents(input, now) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(kept)) {
    if (value === undefined || DROPPED.has(name)) continue;
    fields[name] = value;
  }
  return fields;
}

const DROPPED: ReadonlySet<string> = new Set(["email", "emailConfirm", "honeypot", "renderedAt", "fitnessAcknowledged"]);

/** The person an entry names: the legal name as the registration would carry it, and the birth date. */
export function personOfEntry(entry: Pick<PendingFamilyEntry, "fields">): { legalName: string; birthDate: string | null; adult: (now: Date) => boolean } {
  const fields = entry.fields;
  const first = typeof fields.firstName === "string" ? fields.firstName : "";
  const last = typeof fields.lastName === "string" ? fields.lastName : "";
  const birthDate = typeof fields.birthDate === "string" ? fields.birthDate : null;
  return { legalName: composeLegalName(first, last), birthDate, adult: (now) => adultOnTheFamilyForm(birthDate, now) };
}

/**
 * A registered runner as the email and the confirmation page name them to the address (§NNN): the
 * first name and the last name's initial — "Ana P." — enough for a family to know who is meant,
 * and no more of a name than a public list would show. The display name when the parts are missing.
 */
export function shortRunnerName(row: { firstName: string | null; lastName: string | null; displayName: string }): string {
  const first = row.firstName?.trim();
  const initial = row.lastName?.trim().slice(0, 1);
  if (first && initial) return `${first} ${initial.toLocaleUpperCase("ro-RO")}.`;
  return row.displayName;
}

/** A birth date as a person reads it on the page and in the email: "12.03.2012" — the pickers' form, never a weekday (§349). */
export function birthDateText(birthDate: string | null): string {
  const match = birthDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate) : null;
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

export async function insertFamilyEntry<T extends Record<string, unknown>>(
  db: Database<T>,
  values: {
    eventId: string;
    participantId: string;
    registrationId: string;
    locale: Locale;
    fields: Record<string, unknown>;
    expiresAt: Date;
    now: Date;
  },
): Promise<PendingFamilyEntry> {
  const [row] = await db
    .insert(pendingFamilyEntries)
    .values({
      eventId: values.eventId,
      participantId: values.participantId,
      registrationId: values.registrationId,
      locale: values.locale,
      fields: values.fields,
      expiresAt: values.expiresAt,
      createdAt: values.now,
    })
    .returning();
  return row;
}

export async function findFamilyEntryById<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<PendingFamilyEntry | undefined> {
  const [row] = await db.select().from(pendingFamilyEntries).where(eq(pendingFamilyEntries.id, id)).limit(1);
  return row;
}

/** The entry the emailed token was minted for — the one a press of it confirms. */
export async function findFamilyEntryByToken<T extends Record<string, unknown>>(db: Database<T>, tokenId: string): Promise<PendingFamilyEntry | undefined> {
  const [row] = await db.select().from(pendingFamilyEntries).where(eq(pendingFamilyEntries.actionTokenId, tokenId)).limit(1);
  return row;
}

/** The renderer, at send time: the token it just minted is the one this entry's email carries. */
export async function linkFamilyEntryToken<T extends Record<string, unknown>>(db: Database<T>, entryId: string, tokenId: string): Promise<void> {
  await db.update(pendingFamilyEntries).set({ actionTokenId: tokenId }).where(eq(pendingFamilyEntries.id, entryId));
}

export async function deleteFamilyEntry<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<void> {
  await db.delete(pendingFamilyEntries).where(eq(pendingFamilyEntries.id, id));
}

/**
 * The entries nobody confirmed in time, deleted with the personal data they hold (§NNN): run by the
 * registration maintenance job (`maintenance.ts`), which the submission wakes for the instant
 * (`wakeMaintenance`). Returns how many went.
 */
export async function purgeLapsedFamilyEntries<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const gone = await db.delete(pendingFamilyEntries).where(lte(pendingFamilyEntries.expiresAt, now)).returning({ id: pendingFamilyEntries.id });
  return gone.length;
}

/** The next entry to lapse, strictly after `now` — the purge's instant, for when the job next has work (§334). */
export async function nextFamilyEntryLapse<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ next: min(pendingFamilyEntries.expiresAt) })
    .from(pendingFamilyEntries)
    .where(gt(pendingFamilyEntries.expiresAt, now));
  const next = row?.next as unknown;
  if (next === null || next === undefined) return null;
  const date = next instanceof Date ? next : new Date(String(next));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Who the address holds at the event now, as the email and the confirmation page list them (§NNN):
 * its **active** registrations only, oldest first, each by first name and initial. Only this
 * address's own rows — the participant is the address — so nothing about anybody else's inbox is
 * ever said to this one.
 */
export async function registeredOnAddress<T extends Record<string, unknown>>(db: Database<T>, eventId: string, participantId: string): Promise<string[]> {
  const rows = await db
    .select({ firstName: registrations.firstName, lastName: registrations.lastName, displayName: registrations.displayName })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.participantId, participantId),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(asc(registrations.createdAt));
  return rows.map(shortRunnerName);
}
