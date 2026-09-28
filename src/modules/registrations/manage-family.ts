import { and, eq, inArray, or } from "drizzle-orm";
import { ACTIVE_REGISTRATION_STATUSES, type Registration, registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { isUuid } from "@/shared/ids";
import { compareFamilyOrder, withFamilyRank } from "./domain/family-sitting";
import { sittingOrderFor } from "./family-sitting";
import { findRegistrationById } from "./repository";

/**
 * «Gestionează înscrierea» per person (§NNN, amending §77 and §471; the owner, 2026-09-28, walking a
 * family of three on QA: one page, one QR, and no way to tell which of the three it was, nor to
 * cancel only one of them).
 *
 * **What the page lists.** The registration the link names, and every other active registration of
 * the same address at the same event — the family the «Familie» marker already names on the same
 * page (the family branch's marker). The participant *is* the canonical address (§389), so these are
 * the rows of one participant at one event: whoever holds the link holds that inbox, and the inbox
 * reads the same people on «Înscrierile mele» (§77) with one request. Nothing about another address,
 * and nothing about the address's other events, is read (§39, AGENTS.md §19.4): the page reveals no
 * registration its reader did not make from that inbox.
 *
 * Why the per-registration link and not a redirect to «Înscrierile mele»: that page lives behind its
 * own `MANAGE_PROFILE` token, minted only on request, and swapping one link for another in a URL is
 * a token in an address bar the email never put there. The manage link already authorises its own
 * address; scoping it to the event keeps the page what the email promised — this race.
 *
 * **What a press may touch.** A registration id is not a secret. Every per-person press names one,
 * and the server accepts it only when it is the link's own registration or another registration of
 * the same participant at the same event (`managedRegistration`); anything else is refused as if the
 * link were not the holder's (§13.2's one generic answer). The hidden button is not the permission.
 */

/** One person of the page, as the per-person card draws them. */
export type ManagedPerson = {
  id: string;
  registeredName: string;
  status: RegistrationStatus;
  checkinCode: string | null;
  checkedInAt: Date | null;
  bibNumber: number | null;
  /** Off the public list (§143): the participant's own answer, per person. */
  listOptOut: boolean;
  /** The registration the link itself names. */
  own: boolean;
};

/**
 * The link's registration and the address's other active ones at its event, in the order the
 * family's forms were sent (§519, `compareFamilyOrder`). The link's own row is always listed, even
 * when it is no longer active — its page still says where it stands.
 */
export async function listManagedPeople<T extends Record<string, unknown>>(db: Database<T>, own: Registration): Promise<ManagedPerson[]> {
  const rows = await db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      status: registrations.status,
      createdAt: registrations.createdAt,
      checkinCode: registrations.checkinCode,
      checkedInAt: registrations.checkedInAt,
      bibNumber: registrations.bibNumber,
      listOptOut: registrations.listOptOut,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.participantId, own.participantId),
        eq(registrations.eventId, own.eventId),
        or(eq(registrations.id, own.id), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])),
      ),
    );
  const ordered = withFamilyRank(rows, await sittingOrderFor(db, own.participantId, own.eventId)).sort(compareFamilyOrder);
  return ordered.map((row) => ({
    id: row.id,
    registeredName: row.registeredName,
    status: row.status,
    checkinCode: row.checkinCode,
    checkedInAt: row.checkedInAt,
    bibNumber: row.bibNumber,
    listOptOut: row.listOptOut,
    own: row.id === own.id,
  }));
}

/**
 * The registration a per-person press may act on (§NNN): the link's own, or another registration of
 * the same participant at the same event. Null for anything else — a malformed id, a stranger's, the
 * address's registration at another event — which the caller answers as a refused link.
 */
export async function managedRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  own: Registration,
  registrationId: string | null | undefined,
): Promise<Registration | null> {
  if (!registrationId || registrationId === own.id) return own;
  if (!isUuid(registrationId)) return null;
  const other = await findRegistrationById(db, registrationId);
  if (!other || other.participantId !== own.participantId || other.eventId !== own.eventId) return null;
  return other;
}
