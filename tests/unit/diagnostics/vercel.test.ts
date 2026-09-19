import { describe, expect, it } from "vitest";
import { readVercelMonth, VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";

/** `DECISIONS.md` §101 — the month's deployments and build minutes, from the one list a token can read. */
const NOW = new Date("2026-09-19T10:00:00.000Z");
const MONTH_START = Date.UTC(2026, 8, 1);
const minute = 60_000;

const deployment = (uid: string, createdAt: number, buildMinutes: number, state = "READY") => ({
  uid,
  createdAt,
  buildingAt: createdAt + 5_000,
  ready: createdAt + 5_000 + buildMinutes * minute,
  readyState: state,
});

describe("Vercel's month", () => {
  it("is unconfigured without a token and a project id, and never calls out", async () => {
    let called = false;
    const result = await readVercelMonth({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: undefined, VERCEL_TEAM_ID: undefined }, NOW, () => {
      called = true;
      throw new Error("must not be called");
    });
    expect(result).toEqual({ ok: false, reason: "unconfigured" });
    expect(called).toBe(false);
  });

  it("sums build minutes and counts deployments across pages, today's apart, failures apart", async () => {
    const urls: string[] = [];
    const today = Date.UTC(2026, 8, 19, 8);
    const pages: Record<string, unknown> = {
      first: {
        deployments: [deployment("a", today, 2), deployment("b", today - 60 * minute, 3, "ERROR")],
        pagination: { next: MONTH_START + 5 * 24 * 3600_000 },
      },
      second: {
        // A row repeated on the page boundary, and one from last month that `since` should have excluded.
        deployments: [deployment("b", today - 60 * minute, 3, "ERROR"), deployment("c", MONTH_START + 24 * 3600_000, 4), deployment("z", MONTH_START - 1, 9)],
        pagination: { next: null },
      },
    };
    const result = await readVercelMonth(
      { VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: "team_1" },
      NOW,
      async (input, init) => {
        const url = String(input);
        urls.push(url);
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer t");
        const body = url.includes("until=") ? pages.second : pages.first;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("projectId=prj_1");
    expect(urls[0]).toContain("teamId=team_1");
    expect(urls[0]).toContain(`since=${MONTH_START}`);
    expect(result.month.deployments).toBe(3);
    expect(result.month.deploymentsToday).toBe(2);
    expect(result.month.errored).toBe(1);
    expect(result.month.buildMinutes).toBe(9);
    expect(result.month.lastReadyAt?.getTime()).toBe(today + 5_000 + 2 * minute);
    expect(result.month.periodStart.getTime()).toBe(MONTH_START);
    expect(VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH).toBe(6_000);
  });

  it("reports a refusal and a network failure as reasons, not as figures", async () => {
    const refused = await readVercelMonth({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: undefined }, NOW, async () => new Response("{}", { status: 403 }));
    expect(refused).toEqual({ ok: false, reason: "HTTP 403" });
    const down = await readVercelMonth({ VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: undefined }, NOW, async () => {
      throw new TypeError("fetch failed");
    });
    expect(down).toEqual({ ok: false, reason: "TypeError" });
  });
});
