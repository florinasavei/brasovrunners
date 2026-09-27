import { describe, expect, it } from "vitest";
import {
  countAccountLines,
  createMemberAccounts,
  MEMBER_ACCOUNTS_CONCURRENCY,
} from "@/modules/staff-identity/member-accounts";
import { MEMBER_ROWS_MAX, parseMemberRows } from "@/modules/staff-identity/domain/member-rows";
import { inviteZitadelUser, type InviteOutcome } from "@/modules/staff-identity/zitadel-users";

/**
 * §524 «Adaugă mai mulți membri» — the accounts after the transaction: a few at a time, every
 * member one line of the report, a failure never the whole press's.
 */
const members = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `id-${index}` }));

describe("§524 the members' sign-in accounts, batched and reported", () => {
  it("never runs more than three at once, and answers every member in the order given", async () => {
    let inFlight = 0;
    let peak = 0;
    const lines = await createMemberAccounts(members(10), async (member) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return Number(member.id.slice(3)) % 2 === 0 ? { kind: "invited" } : { kind: "exists" };
    });
    expect(MEMBER_ACCOUNTS_CONCURRENCY).toBe(3);
    expect(peak).toBe(3);
    expect(lines.map((line) => line.staffUserId)).toEqual(members(10).map((member) => member.id));
    expect(lines.slice(0, 2)).toEqual([
      { staffUserId: "id-0", outcome: "created" },
      { staffUserId: "id-1", outcome: "invited" },
    ]);
  });

  it("reports a refusal, a throw and a missing key per member, and counts them", async () => {
    const answers: Record<string, InviteOutcome | Error> = {
      a: { kind: "invited" },
      b: { kind: "failed", reason: "403 membership not found" },
      c: new TypeError("fetch failed"),
      d: { kind: "unconfigured" },
    };
    const lines = await createMemberAccounts(
      ["a", "b", "c", "d"].map((id) => ({ id })),
      async (member) => {
        const answer = answers[member.id];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    );
    expect(lines).toEqual([
      { staffUserId: "a", outcome: "created" },
      { staffUserId: "b", outcome: "failed", reason: "403 membership not found" },
      { staffUserId: "c", outcome: "failed", reason: "TypeError: fetch failed" },
      { staffUserId: "d", outcome: "unconfigured" },
    ]);
    expect(countAccountLines(lines)).toEqual({ created: 1, invited: 0, failed: 2, unconfigured: 1 });
  });

  it("does nothing for nobody", async () => {
    expect(await createMemberAccounts([], async () => ({ kind: "invited" }))).toEqual([]);
  });

  it("caps one press at fifty rows", () => {
    expect(MEMBER_ROWS_MAX).toBe(50);
    expect(parseMemberRows(Array.from({ length: 60 }, (_, i) => `m${i}@x.ro`).join("\n"))).toHaveLength(60);
  });

  it("bounds every call to the provider, and a provider that hangs is that member's failure", async () => {
    const hanging = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const outcome = await inviteZitadelUser(
      { email: "a@x.ro", displayName: "A", locale: "ro" },
      { issuer: "https://id.example.test", token: "pat", fetch: hanging, timeoutMs: 20 },
    );
    expect(outcome.kind).toBe("failed");
    expect((outcome as { reason: string }).reason).toContain("TimeoutError");
  });
});
