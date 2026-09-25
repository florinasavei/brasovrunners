import { afterEach, describe, expect, it, vi } from "vitest";
import { DEADLINE_RULES, DEFAULT_DEADLINES, deadlinesSettingSchema, publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";

/**
 * §421 — a public participant list closes by itself, the club's number of days after the event
 * ("Termene", `publicListDays`), whatever the event's switch says. The list is a disclosure
 * (§32, AGENTS.md §10.10), and a disclosure with no end kept names public until the three-year
 * deletion. Checked at request time by the component that draws every page of the list, because
 * the public cache (§333) expires on writes and the passing of a date is not one.
 *
 * Beside `public-surface.test.ts`, which asks what the list's queries may return; this asks when
 * the page may ask them at all.
 */
const reads = vi.hoisted(() => ({
  cachedDeadlines: vi.fn(),
  cachedStartListCounts: vi.fn(),
  cachedListStatesDisclosed: vi.fn(),
  cachedFirstStatesNoticeVersion: vi.fn(),
  cachedStartListOthersCounts: vi.fn(),
  cachedStartListOthersPage: vi.fn(),
  cachedStartListPage: vi.fn(),
}));
vi.mock("@/modules/public-cache/reads", () => reads);

const DAY = 24 * 60 * 60_000;
const startsAt = new Date("2026-11-21T08:00:00.000Z");
const endsAt = new Date("2026-11-21T14:00:00.000Z");

afterEach(() => {
  vi.clearAllMocks();
});

describe("§421 the public list's period", () => {
  it("is thirty days by default, one to 365, and counts from the end when the event has one", () => {
    expect(DEFAULT_DEADLINES.publicListDays).toBe(30);
    expect(DEADLINE_RULES.publicListDays).toMatchObject({ unit: "days", min: 1, max: 365 });
    expect(publicListClosesAt({ startsAt, endsAt }, DEFAULT_DEADLINES)).toEqual(new Date(endsAt.getTime() + 30 * DAY));
    expect(publicListClosesAt({ startsAt, endsAt: null }, { publicListDays: 7 })).toEqual(new Date(startsAt.getTime() + 7 * DAY));
  });

  it("takes a year at most on a «Termene» save, and refuses a day more or none", () => {
    const valid = { ...DEFAULT_DEADLINES };
    expect(deadlinesSettingSchema.safeParse({ ...valid, publicListDays: 365 }).success).toBe(true);
    expect(deadlinesSettingSchema.safeParse({ ...valid, publicListDays: 366 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...valid, publicListDays: 0 }).success).toBe(false);
    expect(publicListClosesAt({ startsAt, endsAt }, { publicListDays: 365 })).toEqual(new Date(endsAt.getTime() + 365 * DAY));
  });

  it("is open up to the instant it closes, and shut after it", () => {
    const closes = publicListClosesAt({ startsAt, endsAt }, { publicListDays: 10 });
    expect(publicListStillOpen({ startsAt, endsAt }, closes, { publicListDays: 10 })).toBe(true);
    expect(publicListStillOpen({ startsAt, endsAt }, new Date(closes.getTime() + 1), { publicListDays: 10 })).toBe(false);
  });

  it("the list component draws nothing, and reads no name, once the period has passed — on every page of it", async () => {
    reads.cachedDeadlines.mockResolvedValue({ ...DEFAULT_DEADLINES, publicListDays: 5 });
    const { default: StartList } = await import("@/modules/events/ui/StartList");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(endsAt.getTime() + 5 * DAY + 60_000));
    try {
      const event = { id: "00000000-0000-4000-8000-000000000001", participantListVisibility: "NAMES", startsAt, endsAt } as unknown as Parameters<typeof StartList>[0]["event"];
      expect(await StartList({ event })).toBeNull();
      expect(await StartList({ event, page: "2" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(reads.cachedStartListCounts).not.toHaveBeenCalled();
    expect(reads.cachedStartListPage).not.toHaveBeenCalled();
    expect(reads.cachedStartListOthersPage).not.toHaveBeenCalled();
  });
});
