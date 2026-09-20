import type { Locale } from "@/i18n/routing";
import { env } from "@/shared/config/env";

/**
 * The invitation (`DECISIONS.md` §123): when a colleague is added on Echipa, their Zitadel
 * account is created and Zitadel emails them the link to set a password — through the
 * club's own sending domain, which Zitadel's mail already uses (`SETUP.md` §35). The owner,
 * 2026-09-19: "I tried to invite myself and I did not receive the code … I should have seen
 * that email in the Zitadel console!"
 *
 * Zitadel's User API v2, called with a service user's personal access token
 * (`ZITADEL_MANAGEMENT_PAT`, `SETUP.md` §37). Two calls: create the human user with the
 * address verified — the invitation proves the mailbox — then an invite code that Zitadel
 * sends. An account that already exists is left alone and reported as such; a missing token
 * is not an error but "not configured", so the row is still added and the page says what to
 * do by hand. Nothing here decides who is staff: `staff_users` does (`AGENTS.md` §13).
 */

export type InviteOutcome =
  | { kind: "invited" }
  | { kind: "exists" }
  | { kind: "unconfigured" }
  | { kind: "failed"; reason: string };

/** What the other three verbs answer (§171): done, nothing to act on, no key, or a reason. */
export type AccountOutcome =
  | { kind: "done" }
  | { kind: "missing" }
  | { kind: "unconfigured" }
  | { kind: "failed"; reason: string };

type Deps = {
  fetch?: typeof fetch;
  issuer?: string;
  token?: string;
};

/** The issuer and the key, or nothing — every call below starts here. */
function connection(deps: Deps): { issuer: string; headers: Record<string, string>; call: typeof fetch } | null {
  const issuer = (deps.issuer ?? env.AUTH_ZITADEL_ISSUER ?? "").replace(/\/$/, "");
  const token = deps.token ?? env.ZITADEL_MANAGEMENT_PAT;
  if (!issuer || !token) return null;
  return {
    issuer,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    call: deps.fetch ?? fetch,
  };
}

export function isZitadelInviteConfigured(): boolean {
  return Boolean(env.ZITADEL_MANAGEMENT_PAT && env.AUTH_ZITADEL_ISSUER);
}

export async function inviteZitadelUser(
  person: { email: string; displayName: string; locale: Locale },
  deps: Deps = {},
): Promise<InviteOutcome> {
  const connected = connection(deps);
  if (!connected) return { kind: "unconfigured" };
  const { issuer, headers, call } = connected;

  const [givenName, ...rest] = person.displayName.trim().split(/\s+/);
  const familyName = rest.join(" ") || givenName;

  const created = await call(`${issuer}/v2/users/human`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: person.email,
      profile: { givenName, familyName, displayName: person.displayName, preferredLanguage: person.locale },
      email: { email: person.email, isVerified: true },
    }),
  });

  /**
   * An account that is already there still needs its invitation (§171; the owner: "I need to
   * invite users to create accounts man! and set passwords and stuff").
   *
   * A 409 used to end the story: the row joined the allowlist, the screen said "they already
   * have an account", and nobody ever sent them the link that lets them set a password. That is
   * the common case, not the rare one — the same person is added, removed and added again, or
   * was created in the Zitadel console by hand. So an existing account falls through to the
   * same invitation the new one gets, and the outcome still says "exists" so the screen can
   * word it honestly.
   */
  if (created.status === 409) {
    const again = await resendZitadelInvite(person.email, deps);
    return again.kind === "invited" ? { kind: "exists" } : again;
  }
  if (!created.ok) return { kind: "failed", reason: await reasonOf(created) };
  const { userId } = (await created.json()) as { userId: string };

  const invited = await call(`${issuer}/v2/users/${userId}/invite_code`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sendCode: { applicationName: "Brașov Runners" } }),
  });
  if (!invited.ok) return { kind: "failed", reason: await reasonOf(invited) };
  return { kind: "invited" };
}

/**
 * The account behind an address, or nothing (§171).
 *
 * Shared by every verb below, because each of them is "find the person, then do one thing to
 * them", and a lookup that disagreed between two of them would be the same defect twice.
 */
async function findZitadelUserId(email: string, deps: Deps = {}): Promise<string | undefined> {
  const connected = connection(deps);
  if (!connected) return undefined;
  const { issuer, headers, call } = connected;

  /**
   * By **email**, then by login name (§170; the owner: "uite ce pățesc când încerc să adaug un
   * coleg", against a row whose account exists).
   *
   * The search was by login name alone, and a login name is not an email address: Zitadel
   * scopes it to the organization's primary domain unless that org has "username must be
   * unique across the instance" turned off, so a colleague created as `name@gmail.com` has the
   * login name `name@gmail.com@<org>.zitadel.cloud` and an equality match on the address finds
   * nobody. The account was there the whole time; the screen said there was no account.
   *
   * `emailQuery` matches what was actually stored (`ListUsers`, User Service v2). The login
   * name query stays as the second attempt, because a service account or a person created by
   * hand with a username that is not their address is found by that and not by this.
   */
  const search = async (query: Record<string, unknown>): Promise<string | undefined | null> => {
    const found = await call(`${issuer}/v2/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: { limit: 1 }, queries: [query] }),
    });
    if (!found.ok) return null;
    const { result } = (await found.json()) as { result?: Array<{ userId: string }> };
    return result?.[0]?.userId;
  };

  return (
    (await search({ emailQuery: { emailAddress: email, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } })) ??
    (await search({ loginNameQuery: { loginName: email, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } })) ??
    undefined
  );
}

const NO_ACCOUNT = "no account with this address at the identity provider";

/** Send the invitation again to an account that exists — the previous code is replaced. */
export async function resendZitadelInvite(email: string, deps: Deps = {}): Promise<InviteOutcome> {
  const connected = connection(deps);
  if (!connected) return { kind: "unconfigured" };
  const { issuer, headers, call } = connected;

  const userId = await findZitadelUserId(email, deps);
  if (!userId) return { kind: "failed", reason: NO_ACCOUNT };

  const invited = await call(`${issuer}/v2/users/${userId}/invite_code`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sendCode: { applicationName: "Brașov Runners" } }),
  });
  if (!invited.ok) return { kind: "failed", reason: await reasonOf(invited) };
  return { kind: "invited" };
}

/**
 * "Send them a password reset" (§171; the owner: "I can also deactivate, send password resets,
 * etc").
 *
 * Zitadel emails the link and owns the code; nothing about the password is ever handled here.
 * Distinct from the invitation, which is for somebody who has never signed in: this is for
 * somebody who has and cannot get back in, and an invitation would be the wrong words in their
 * inbox.
 */
export async function sendZitadelPasswordReset(email: string, deps: Deps = {}): Promise<AccountOutcome> {
  const connected = connection(deps);
  if (!connected) return { kind: "unconfigured" };
  const { issuer, headers, call } = connected;

  const userId = await findZitadelUserId(email, deps);
  if (!userId) return { kind: "missing" };

  const sent = await call(`${issuer}/v2/users/${userId}/password_reset`, {
    method: "POST",
    headers,
    // `sendLink` with no template: Zitadel's own hosted login page receives the code, which is
    // where the password is set. A template would point at a page this platform does not have.
    body: JSON.stringify({ sendLink: { notificationType: "NOTIFICATION_TYPE_Email" } }),
  });
  if (!sent.ok) return { kind: "failed", reason: await reasonOf(sent) };
  return { kind: "done" };
}

/**
 * Switch the sign-in itself off, or back on (§171).
 *
 * Withdrawing access removes the `staff_users` row, and that alone is what stops the backoffice
 * letting somebody in — `AGENTS.md` §13, and it stays true. This is the second half the owner
 * asked for: the account at the provider, which outlives the row and can still sign in
 * *somewhere* until it is deactivated. Two separate verbs on the screen, because they answer
 * two different questions: "may they use the backoffice" and "may they sign in at all".
 */
export async function setZitadelUserActive(
  email: string,
  active: boolean,
  deps: Deps = {},
): Promise<AccountOutcome> {
  const connected = connection(deps);
  if (!connected) return { kind: "unconfigured" };
  const { issuer, headers, call } = connected;

  const userId = await findZitadelUserId(email, deps);
  if (!userId) return { kind: "missing" };

  const changed = await call(`${issuer}/v2/users/${userId}/${active ? "reactivate" : "deactivate"}`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!changed.ok) return { kind: "failed", reason: await reasonOf(changed) };
  return { kind: "done" };
}

async function reasonOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return `${response.status} ${body.message ?? ""}`.trim();
  } catch {
    return String(response.status);
  }
}
