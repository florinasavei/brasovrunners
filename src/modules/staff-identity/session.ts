import { hasLocale } from "next-intl";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DomainError } from "@/shared/errors/domain-error";
import { env } from "@/shared/config/env";
import { isDevStaffSwitcherEnabled } from "./dev-switcher";
import { isBackofficeRole, mustAcceptTeamAgreement, type StaffSubject } from "./domain/roles";
import { gateRequestOf, isTeamAgreementPath, localeOfPath, TEAM_AGREEMENT_REFUSAL, teamAgreementReturnTo } from "./domain/team-agreement";
import { findStaffUserById, type StaffAccount } from "./repository";
import { DEV_STAFF_COOKIE } from "./dev-staff-cookie";
import { outstandingTeamAgreement, type TeamAgreementVersion } from "./team-agreement";

/**
 * Who is signing this request, and the three helpers AGENTS.md §13.1 names.
 *
 * This is the only place a session is read. Everything below it — the CMS service, staff
 * administration, the roles table — takes the staff user as an argument, which is what allows
 * the rules to be tested without a browser and prevents a "well, the page already checked"
 * shortcut from appearing in a service function.
 *
 * `next/headers` is what keeps this on the server: importing it from a Client Component is a
 * build error, so no bundle can contain this module by accident.
 *
 * With `STAFF_AUTH_MODE=disabled` — the default everywhere until an operator turns on
 * `provider` for that environment (DECISIONS.md §26) — `getCurrentStaffUser` returns null for
 * every request, so the backoffice answers nobody. That is the correct answer while the door
 * has no lock, and it is enforced here rather than by omitting the routes.
 *
 * **Two answers since §524: the account, and the staff member.** A club member signs in through
 * the same door and holds a `staff_users` row with the role `MEMBER` — and is not staff.
 * `getCurrentAccount` answers for anybody signed in (the members' zone and the sign-in page ask
 * it); `getCurrentStaffUser`, and `requireStaff` and `requireStaffCapability` on top of it, answer
 * null for a member, exactly as for a stranger. That one line keeps every backoffice page, action
 * and route handler — a hundred callers that ask "is there a staff session" before anything else —
 * closed to a member without any of them naming the role.
 */

/** The development switcher's cookie, from a module with no request in it: the proxy reads its name too (§549). */
export { DEV_STAFF_COOKIE };

/**
 * Whoever is signed in — a member or a colleague — or null (§524). For the members' zone and the
 * sign-in page; never a door to anything staff may do, which is `getCurrentStaffUser`'s.
 */
export async function getCurrentAccount(): Promise<StaffAccount | null> {
  if (isDevStaffSwitcherEnabled()) {
    const id = (await cookies()).get(DEV_STAFF_COOKIE)?.value;
    if (!id) return null;

    // A cookie naming a staff user who has since been removed is not a session. Revoking
    // access has to take effect on the next request, not at the next sign-in.
    return (await findStaffUserById(getDb(), id)) ?? null;
  }

  if (env.STAFF_AUTH_MODE === "provider") {
    const session = await auth();
    if (!session?.staffUserId) return null;

    // Re-read the row rather than trusting the token: a role change or a revoked access
    // takes effect on the very next request, not when the session eventually expires.
    return (await findStaffUserById(getDb(), session.staffUserId)) ?? null;
  }

  return null;
}

/** The staff member signing this request, or null — and null for a member, who is no staff (§524). */
export async function getCurrentStaffUser(): Promise<StaffAccount | null> {
  const account = await getCurrentAccount();
  return account && isBackofficeRole(account.role) ? account : null;
}

/**
 * The staff member signing this request — and, since §1006, one who owes the team's undertaking nothing.
 *
 * **The team's undertaking (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»).** A colleague below the Administrator (`mustAcceptTeamAgreement`) who has not accepted the version of
 * `STAFF_DATA_AGREEMENT` in force is answered by nothing of the backoffice until they do, and it is asserted here — the one line
 * every backoffice page, action and route handler asks before anything else — never by hiding a button:
 *
 * - a page being drawn sends the reader to `/admin/acord`, the page they asked for kept as `returnTo` (a same-site path only);
 * - a Server Action and an admin route handler are refused with `FORBIDDEN`, its message saying to accept the undertaking first
 *   (`gateRequestOf` says which is which).
 *
 * No version in force, no gate: a text the club has not approved binds nobody. An Administrator's request reads nothing more.
 * The undertaking's own page and its action ask `requireStaffBeforeTeamAgreement`; sign-out asks nothing.
 */
export async function requireStaff(): Promise<StaffAccount> {
  const staffUser = await requireStaffBeforeTeamAgreement();
  await assertTeamAgreementAccepted(staffUser);
  return staffUser;
}

/**
 * The team's undertaking asked of a staff member the caller has read already (§1006): nothing when nothing is owed; otherwise a
 * page being drawn is sent to `/admin/acord` and anything else is refused with `FORBIDDEN`. `requireStaff` asks it, and so does
 * the staff preview of a draft, which reads its staff member itself to answer a stranger 404.
 */
export async function assertTeamAgreementAccepted(staffUser: StaffSubject & { id: string }): Promise<void> {
  if (await owedThisRequest(staffUser)) await refuseUntilTeamAgreementAccepted();
}

/**
 * The version of the undertaking an account has not accepted, asked of the database once per request (§1006) however many doors
 * ask it — the layout's bare shell, the page's `requireStaff`, a page that asks the door again —, as `deadlinesForThisRequest` is
 * read once per backoffice render. React scopes `cache` to the render of one request; outside a render — a Server Action's body, a
 * route handler, a test — it calls through every time, so a press that has just written the acceptance is never answered from a
 * moment before it. Keyed by the account's id.
 */
const outstandingThisRequest = cache(
  (staffUserId: string): Promise<TeamAgreementVersion | null> => outstandingTeamAgreement(getDb(), staffUserId, new Date()),
);

/**
 * The version this colleague owes: none, with no query, for a role that is not asked (`mustAcceptTeamAgreement`); else the
 * request's one read.
 */
async function owedThisRequest(staffUser: StaffSubject & { id: string }): Promise<TeamAgreementVersion | null> {
  return mustAcceptTeamAgreement(staffUser) ? outstandingThisRequest(staffUser.id) : null;
}

/**
 * The staff session alone, before the team's undertaking (§1006): for `/admin/acord` and its «Accept și intru» only — the one page
 * and the one action a colleague who owes the undertaking may reach. Everything else asks `requireStaff`.
 */
export async function requireStaffBeforeTeamAgreement(): Promise<StaffAccount> {
  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    throw new DomainError(
      "UNAUTHENTICATED",
      `no staff session; STAFF_AUTH_MODE=${env.STAFF_AUTH_MODE}`,
    );
  }
  return staffUser;
}

/**
 * The undertaking's address for a reader who was going to `path` (§1006), in the path's own language: `/ro/admin/acord?returnTo=…`,
 * or without a way back when the path is none a reader may be sent to (`teamAgreementReturnTo`).
 */
function teamAgreementHref(path: string): string {
  const prefix = localeOfPath(path);
  const locale = hasLocale(routing.locales, prefix) ? prefix : routing.defaultLocale;
  const returnTo = teamAgreementReturnTo(path);
  return getPathname({ locale, href: { pathname: "/admin/acord", query: returnTo ? { returnTo } : {} } });
}

/** The refusal of a request from a colleague who owes the undertaking: a page is sent to it, anything else is FORBIDDEN. */
async function refuseUntilTeamAgreementAccepted(): Promise<never> {
  const request = gateRequestOf(await headers());
  if (request.kind === "page" && !isTeamAgreementPath(request.path)) redirect(teamAgreementHref(request.path));
  throw new DomainError("FORBIDDEN", TEAM_AGREEMENT_REFUSAL);
}

/**
 * What a layout drawing the backoffice's shell asks (§1006): the version of the team's undertaking this colleague owes, if any —
 * the shell then draws no tabs, only who is signed in and the sign-out. **A layout never redirects for it**: the client router
 * keeps a layout's answer with the layout and replays it on every navigation beneath it, so a layout's redirect to
 * `/admin/acord` — a page under that same layout — is replayed on the undertaking's own page, a loop of requests and a page that
 * never shows (the first end-to-end run met it from the sign-in, 2026-11-19); and Next lets neither a layout nor the proxy tell
 * a page drawn for the router from a whole document. The page under it sends the reader, through its own `requireStaff`: a
 * page is fetched afresh on every navigation.
 */
export async function teamAgreementOwedFor(staffUser: StaffSubject & { id: string }): Promise<TeamAgreementVersion | null> {
  return owedThisRequest(staffUser);
}

/**
 * The door of every staff action: "may this person do *this*", asked by name.
 *
 * The argument is one of the capabilities in `domain/roles.ts` — `canManagePlatform`,
 * `canWriteLegalTexts`, `canManageStaff`, … — never a role. The door used to take a bare rank
 * (`requireStaffRole("ADMIN")`), which let a page ask `canWriteLegalTexts` while its action asked
 * "at least ADMIN": two answers to one question that could drift apart with nothing noticing.
 * Now the page, the action and the service all name the same predicate, and
 * `tests/unit/staff/no-raw-role-checks.test.ts` refuses a raw role comparison anywhere else.
 * The rules that depend on the content itself ("their own drafts", "not a Superadministrator's
 * row") are the services' to assert after this one has answered.
 *
 * **The predicate is handed the actor, not the role, since §687.** Every single-role predicate takes
 * a `StaffSubject` — a role or an actor with the permissions granted to that person — so one asking
 * the role alone answers as it did, and a grant-aware one (`canManageShop`) reads the grants the
 * session carried. Still a predicate, never a rank: the parameter's type says so.
 */
export async function requireStaffCapability(capability: (subject: StaffSubject) => boolean): Promise<StaffAccount> {
  const staffUser = await requireStaff();
  if (!capability(staffUser)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${staffUser.role} may not ${capability.name || "do this"}`,
    );
  }
  return staffUser;
}
