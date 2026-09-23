import { listZitadelHumanAccounts, type ZitadelDeps } from "@/modules/staff-identity/zitadel-users";
import type { StaffAuthMode } from "@/shared/config/env-enums";

/**
 * Does the invitation key work — not "is it set", not "does it authenticate", but can it do
 * the one thing "Add" on Echipa needs it for (`DECISIONS.md` §288)?
 *
 * The key that cost an evening was set on both Vercel projects, authenticated on every call and
 * could do nothing: the service account had been given a role on the *project* instead of the
 * Org User Manager membership, so Zitadel showed it no users and refused it every creation.
 * Nothing on the board said so, because the board asked "is `ZITADEL_MANAGEMENT_PAT` set" and it
 * was. This asks the question the invitation asks — a user search in the organization — and
 * reads the answer with one fact the caller has that Zitadel does not: **the person reading the
 * page is signed in through Zitadel, so their account exists.** A search that cannot find them
 * is a key that cannot see accounts, whatever status code it came back with.
 *
 * The six answers, and what each one means for the club:
 *
 * - `inapplicable` — the development switcher is the provider; there is no Zitadel to ask.
 * - `unconfigured` — no key, or no issuer: the existing "not configured" state, `SETUP.md` §37.
 * - `ok` — the key found the reader; the listing comes along so Echipa can mark each row.
 * - `blind` — the key authenticates and cannot see the reader's own account: the membership is
 *   missing, exactly §288. `seen` says how many accounts it saw instead, usually none.
 * - `refused` — Zitadel refused the search, in its own words (a revoked token: 401; a token
 *   with no permission on this instance's configuration: 403).
 * - `unreachable` — no answer within the timeout, or no network: not a verdict on the key.
 *
 * Every failure is a value and the page renders whatever comes back; the timeout is inside
 * `listZitadelHumanAccounts`. Nothing is cached across requests — a check the club is asked to
 * act on must be the check of *this* page load, and the pages that call this are dynamic.
 */
export type InviteKeyCheck =
  | { kind: "inapplicable" }
  | { kind: "unconfigured" }
  | { kind: "ok"; accounts: ReadonlySet<string> }
  | { kind: "blind"; seen: number }
  | { kind: "refused"; reason: string }
  | { kind: "unreachable"; reason: string };

export async function checkInviteKey(
  input: {
    authMode: StaffAuthMode;
    /** The signed-in staff member's address: an account Zitadel must be able to show. */
    readerEmail: string;
  },
  deps: ZitadelDeps & { timeoutMs?: number } = {},
): Promise<InviteKeyCheck> {
  if (input.authMode !== "provider") return { kind: "inapplicable" };
  const listing = await listZitadelHumanAccounts(deps);
  if (listing.kind !== "listed") return listing;
  if (!listing.accounts.has(input.readerEmail.toLowerCase())) return { kind: "blind", seen: listing.count };
  return { kind: "ok", accounts: listing.accounts };
}

/**
 * Whether Echipa can say of a row that its account does not exist: only after a check that
 * found the reader, never from a listing that may be the key's blindness rather than the truth.
 */
export function hasNoAccount(check: InviteKeyCheck, email: string): boolean {
  return check.kind === "ok" && !check.accounts.has(email.toLowerCase());
}
