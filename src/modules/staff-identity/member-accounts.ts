import type { InviteOutcome } from "./zitadel-users";

/**
 * «Adaugă mai mulți membri» (§NNN): the sign-in accounts, one per member, after the transaction.
 *
 * A press may carry up to `MEMBER_ROWS_MAX` people and each account is two calls to Zitadel, each
 * bounded by `ZITADEL_CALL_TIMEOUT_MS`. So the calls run a few at a time — never fifty at once
 * against the provider, never one by one for minutes — and every member ends with a line of the
 * report, whatever happened to the others: `created` (a new account, its invitation sent),
 * `invited` (the account was there, the invitation sent again), `failed` with the provider's or the
 * network's words, or `unconfigured` (no key: nothing was asked). Pure over the invite function it
 * is given, so the batching and the report are tested without a network.
 */

/** How many members' accounts are asked for at once. */
export const MEMBER_ACCOUNTS_CONCURRENCY = 3;

export type MemberAccountOutcome = "created" | "invited" | "failed" | "unconfigured";

/** One member's line: the row's id (never the address — the audit row carries this), the outcome, the reason. */
export type MemberAccountLine = { staffUserId: string; outcome: MemberAccountOutcome; reason?: string };

/** The provider's answer as the report words it. */
export function accountLineOf(staffUserId: string, invite: InviteOutcome): MemberAccountLine {
  switch (invite.kind) {
    case "invited":
      return { staffUserId, outcome: "created" };
    case "exists":
      return { staffUserId, outcome: "invited" };
    case "unconfigured":
      return { staffUserId, outcome: "unconfigured" };
    case "failed":
      return { staffUserId, outcome: "failed", reason: invite.reason.slice(0, 200) };
  }
}

/**
 * Every member's account, `concurrency` at a time, in the order given. An invite function that
 * throws is that member's `failed`, never the whole press's.
 */
export async function createMemberAccounts<M extends { id: string }>(
  members: readonly M[],
  invite: (member: M) => Promise<InviteOutcome>,
  concurrency: number = MEMBER_ACCOUNTS_CONCURRENCY,
): Promise<MemberAccountLine[]> {
  const lines: MemberAccountLine[] = new Array(members.length);
  let next = 0;
  const worker = async () => {
    while (next < members.length) {
      const index = next++;
      const member = members[index];
      try {
        lines[index] = accountLineOf(member.id, await invite(member));
      } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        lines[index] = { staffUserId: member.id, outcome: "failed", reason: reason.slice(0, 200) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, members.length)) }, worker));
  return lines;
}

/** The report's counts, for the banner and the audit row. */
export function countAccountLines(lines: readonly MemberAccountLine[]): Record<MemberAccountOutcome, number> {
  const counts: Record<MemberAccountOutcome, number> = { created: 0, invited: 0, failed: 0, unconfigured: 0 };
  for (const line of lines) counts[line.outcome] += 1;
  return counts;
}
