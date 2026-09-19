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

type Deps = {
  fetch?: typeof fetch;
  issuer?: string;
  token?: string;
};

export function isZitadelInviteConfigured(): boolean {
  return Boolean(env.ZITADEL_MANAGEMENT_PAT && env.AUTH_ZITADEL_ISSUER);
}

export async function inviteZitadelUser(
  person: { email: string; displayName: string; locale: Locale },
  deps: Deps = {},
): Promise<InviteOutcome> {
  const issuer = (deps.issuer ?? env.AUTH_ZITADEL_ISSUER ?? "").replace(/\/$/, "");
  const token = deps.token ?? env.ZITADEL_MANAGEMENT_PAT;
  if (!issuer || !token) return { kind: "unconfigured" };
  const call = deps.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

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

  if (created.status === 409) return { kind: "exists" };
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

/** Send the invitation again to an account that exists — the previous code is replaced. */
export async function resendZitadelInvite(email: string, deps: Deps = {}): Promise<InviteOutcome> {
  const issuer = (deps.issuer ?? env.AUTH_ZITADEL_ISSUER ?? "").replace(/\/$/, "");
  const token = deps.token ?? env.ZITADEL_MANAGEMENT_PAT;
  if (!issuer || !token) return { kind: "unconfigured" };
  const call = deps.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  const found = await call(`${issuer}/v2/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: { limit: 1 }, queries: [{ loginNameQuery: { loginName: email, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }] }),
  });
  if (!found.ok) return { kind: "failed", reason: await reasonOf(found) };
  const { result } = (await found.json()) as { result?: Array<{ userId: string }> };
  const userId = result?.[0]?.userId;
  if (!userId) return { kind: "failed", reason: "no Zitadel account with this address" };

  const invited = await call(`${issuer}/v2/users/${userId}/invite_code`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sendCode: { applicationName: "Brașov Runners" } }),
  });
  if (!invited.ok) return { kind: "failed", reason: await reasonOf(invited) };
  return { kind: "invited" };
}

async function reasonOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return `${response.status} ${body.message ?? ""}`.trim();
  } catch {
    return String(response.status);
  }
}
