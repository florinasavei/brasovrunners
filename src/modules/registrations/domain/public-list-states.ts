import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * The public participant list's three groups (`DECISIONS.md` §NNN, amending §32 and §143).
 *
 * The owner, 2026-09-25: "pe lista de participanți publică trebuie să apară și statusul, ca
 * oamenii să știe că sunt pe lista de așteptare sau anulați sau ce or fi." A runner on the
 * waiting list reads the list to find out whether they are on it; until now they were not, and
 * neither was anybody who had not signed yet.
 *
 * **Three groups, never a raw state.** The page is told a group — what a reader needs — and not
 * the lifecycle's own enum, which carries distinctions (an offer, a hold) that are the club's
 * business rather than the public's:
 *
 * - `CONFIRMED` — `CONFIRMED`.
 * - `PENDING` — the address is confirmed and the declaration is still owed: `PENDING_DECLARATION`,
 *   and `WAITLIST_OFFERED`, which is the same position reached from the waiting list (a place
 *   held, a declaration to sign). The reader's question is "is this person in", and for both the
 *   answer is "registered, awaiting confirmation".
 * - `WAITLISTED` — `WAITLISTED`, in queue order, with no position printed.
 *
 * **Everything else is nobody here.** `PENDING_EMAIL_CONFIRMATION` is an address nobody has proved
 * yet — publishing it would publish whoever typed somebody else's name. `CANCELLED` and `EXPIRED`
 * are withdrawals, and a withdrawal is not announced (the owner's "anulați" is recorded as a
 * question, §NNN). An erased registration has no row at all.
 *
 * Pure and dependency-free, because the repository's filters read these lists: the words each
 * group is shown with are the catalogue's (`Event.startList.states`), read by `list-state-words.ts`.
 */
export type PublicListGroup = "CONFIRMED" | "PENDING" | "WAITLISTED";

/** The order the groups are listed in: who is running, who is about to, who is waiting. */
export const PUBLIC_LIST_GROUPS: readonly PublicListGroup[] = ["CONFIRMED", "PENDING", "WAITLISTED"];

/** The states the `PENDING` group is drawn from — the repository's filter reads this list. */
export const PENDING_LIST_STATUSES = ["PENDING_DECLARATION", "WAITLIST_OFFERED"] as const satisfies readonly RegistrationStatus[];

/** The state the `WAITLISTED` group is drawn from. */
export const WAITLISTED_LIST_STATUSES = ["WAITLISTED"] as const satisfies readonly RegistrationStatus[];

/** Which group a state is shown in, or null for a state the public list never shows. */
export function publicListGroupOf(status: RegistrationStatus): PublicListGroup | null {
  if (status === "CONFIRMED") return "CONFIRMED";
  if ((PENDING_LIST_STATUSES as readonly RegistrationStatus[]).includes(status)) return "PENDING";
  if ((WAITLISTED_LIST_STATUSES as readonly RegistrationStatus[]).includes(status)) return "WAITLISTED";
  return null;
}

/** The catalogue key under `Event.startList.states` for each group — the page and the notice read the same words. */
export const LIST_STATE_KEYS: Record<PublicListGroup, "confirmed" | "pending" | "waitlisted"> = {
  CONFIRMED: "confirmed",
  PENDING: "pending",
  WAITLISTED: "waitlisted",
};
