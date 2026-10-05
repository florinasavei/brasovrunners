import { and, asc, eq, gt } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";

/**
 * Who the club's members are, for «Bife de membru fără cont de membru» (§645), and which ticked
 * registrations name nobody among them.
 *
 * **A member is any live account on the team's allowlist** (`staff_users`), whatever its role: the
 * members' zone made a club member a `MEMBER` row (§524), and the colleagues who run the backoffice
 * are members of the club too — an Administrator who ticked the box on the race's form is telling the
 * truth. A revoked account is a deleted row (`revokeStaffUser`), so it counts as nobody; an invited
 * account that has not signed in yet is still the club's member and counts.
 *
 * **Compared through the canonicalizer** (`AGENTS.md` §10.4): each account's address goes through
 * `canonicalizeEmail` and meets `participants.canonical_email`, the participant's stored identity —
 * never a raw string against a typed address. An account address the canonicalizer refuses matches
 * nobody, rather than failing the whole preview.
 *
 * The same set makes a registration «Membru (verificat)» on the list, its page and the export
 * (§662, `domain/membership.ts`): one definition of who the club's members are, for the sweep and the chip.
 *
 * What it cannot see, and the screen says so: a member who registered with another address than
 * the one on their account. They appear among the candidates, and the Administrator leaves them out
 * by hand (the preview's untick).
 */
export async function memberCanonicalEmails<T extends Record<string, unknown>>(db: Database<T>): Promise<Set<string>> {
  const rows = await db.select({ email: staffUsers.email }).from(staffUsers);
  const canonical = new Set<string>();
  for (const { email } of rows) {
    try {
      canonical.add(canonicalizeEmail(email).canonicalEmail);
    } catch {
      // Not an address the participants' canonicalizer accepts: nobody's identity, so no match.
    }
  }
  return canonical;
}

/** One ticked registration whose address matches no member account: what the preview lists. */
export type MemberTickCandidate = {
  id: string;
  registeredName: string;
  status: RegistrationStatus;
  eventId: string;
  eventTitle: string | null;
  /**
   * The address masked (`maskAddress`): enough to recognise a member who registered with a family or
   * work address, never the whole address on a page of many people.
   */
  maskedEmail: string;
};

/**
 * `an•••@example.org`: the first two characters of the mailbox, then the domain whole — the part
 * that tells a work or family address apart. A mailbox of one or two characters keeps only the first.
 */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "•••";
  const mailbox = address.slice(0, at);
  const kept = mailbox.length > 2 ? mailbox.slice(0, 2) : mailbox.slice(0, 1);
  return `${kept}•••${address.slice(at)}`;
}

/**
 * The sweep's scope is the list's (§645): one event when the list is about one, otherwise every event
 * that has not started — the members' race the owner is cleaning before, and the next runs, never a
 * season already run.
 */
export type MemberTickScope = { eventId?: string };

/**
 * Every ticked registration in the scope whose participant's canonical address is no member
 * account's. Real rows only: a test registration is counted in nothing the club is given (§30), and
 * its tick can still be changed on its own row. Any status — a cancelled row's tick is as false as a
 * confirmed one's; an erased row no longer exists. Ordered by event, then name, so the preview reads
 * like the start list.
 */
export async function listMemberTickCandidates<T extends Record<string, unknown>>(
  db: Database<T>,
  scope: MemberTickScope,
  now: Date,
): Promise<MemberTickCandidate[]> {
  const members = await memberCanonicalEmails(db);
  const rows = await db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      status: registrations.status,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      participantEmail: participants.deliveryEmail,
      canonicalEmail: participants.canonicalEmail,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, registrations.locale)),
    )
    .where(
      and(
        eq(registrations.clubMemberDeclared, true),
        eq(registrations.kind, "REAL"),
        scope.eventId ? eq(registrations.eventId, scope.eventId) : gt(events.startsAt, now),
      ),
    )
    .orderBy(asc(events.startsAt), asc(registrations.registeredName), asc(registrations.id));
  return rows
    .filter((row) => !members.has(row.canonicalEmail))
    .map((row) => ({
      id: row.id,
      registeredName: row.registeredName,
      status: row.status,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      maskedEmail: maskAddress(row.participantEmail),
    }));
}
