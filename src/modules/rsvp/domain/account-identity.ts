import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { cleanDisplayName, identityOf, type RsvpIdentity } from "./identity";

/**
 * The identity a signed-in member answers «Vin!» as, from the members' zone (§822; §812 reserved the source `account` for it).
 *
 * **The account is the only thing the identity is made from** — its address and its name, read on the server from the session, never
 * from the form (BR-REQ-060-01). The form brings one thing, the person's own tick «Vreau să apar cu numele», and that tick is honoured
 * only when there is a name to show: an account whose name is empty after cleaning shows nothing, whatever was posted (§143, §396).
 * `source: "account"` is verified (`identityOf`): the address is the sign-in provider's, so the answer is counted at once and no email
 * is sent. A name still reaches the page only through `publicRsvpName`, which asks the notice that was in force at the press.
 *
 * **The member mark is the account's role** (§831; the owner, 2026-10-19: «organizatorii și administratorii sunt peste membri»): the identity carries
 * the session's `role` and the service makes the answer `ACCOUNT` for a role at least a member (`accountClubMember`) — every role of the club's accounts —
 * whatever the form posted. The form has no member tick for an account: the zone says «Membru» as a fact.
 */
/** `role` is the session's (`StaffAccount.role`): an account read without it is marked by nothing (§831). */
export type RsvpAccount = { email: string; displayName: string | null; role?: StaffRole };

/** The name the account would show, cleaned the way every typed name is, or null when it has none. */
export function accountPublicName(account: Pick<RsvpAccount, "displayName">): string | null {
  return cleanDisplayName(account.displayName);
}

/** The account's identity for one press: `tick` is the person's «Vreau să apar cu numele», off unless the form carried it. */
export function accountIdentity(account: RsvpAccount, locale: "ro" | "en", tick: boolean): RsvpIdentity {
  const name = accountPublicName(account);
  // The account's name is the person's to show, never to keep: it is taken only with the tick (§143, §396), so an unticked press stores
  // none, and a stale tab cannot swap a name the person typed on the event's own page for the one an Administrator typed in «Echipa».
  const shown = tick && name !== null;
  return identityOf("account", { email: account.email, displayName: shown ? name : null, showName: shown, locale, role: account.role });
}
