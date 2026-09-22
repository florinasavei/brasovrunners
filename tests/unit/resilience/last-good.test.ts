import { beforeEach, describe, expect, it, vi } from "vitest";
import { readEnvelope, writeEnvelope, isSnapshotTooOld, SNAPSHOT_MAX_AGE_HOURS } from "@/modules/resilience/domain/envelope";

/**
 * `DECISIONS.md` §281 — a public page keeps its last good answer, and serves it when the
 * database cannot be reached, so an outage costs the club a stale page rather than its site.
 *
 * The properties that matter, in the order they would hurt: nothing is ever served stale while
 * the database answers; `notFound()` is not mistaken for an outage; a copy too old to be honest
 * about is not shown at all; and a `Date` survives the round trip, because a page that receives
 * a string where it expects a date would throw on the one path that must not.
 */
vi.mock("@/shared/config/env", () => ({ env: { APP_ENV: "test", STORAGE_MODE: "fake", APP_BASE_URL: "https://example.test" } }));

const { readWithLastGood, forgetLastGood } = await import("@/modules/resilience/last-good");

const NOW = new Date("2026-09-22T10:00:00.000Z");
const DOWN = new Error("connection terminated unexpectedly");

beforeEach(() => {
  forgetLastGood();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DECISIONS.md §281 the last good copy of a public read", () => {
  it("is live while the database answers, and never serves a copy then", async () => {
    const load = vi.fn().mockResolvedValue({ title: "Crosul de toamnă" });

    const first = await readWithLastGood("events:ro", load, NOW);
    const second = await readWithLastGood("events:ro", load, new Date(NOW.getTime() + 60_000));

    expect(first.freshness).toBe("live");
    expect(second.freshness).toBe("live");
    // Twice, not once: this is not a cache in front of the database. It is a copy behind it.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves the copy, marked stale and dated, once the read throws", async () => {
    await readWithLastGood("events:ro", async () => [{ title: "Crosul de toamnă" }], NOW);

    const outage = await readWithLastGood<{ title: string }[]>(
      "events:ro",
      async () => {
        throw DOWN;
      },
      new Date(NOW.getTime() + 5 * 60_000),
    );

    expect(outage.freshness).toBe("stale");
    expect(outage.value[0].title).toBe("Crosul de toamnă");
    // When it was true, which is what the banner on the page says.
    expect(outage.takenAt).toEqual(NOW);
  });

  it("throws when there is no copy at all, so the error page says the site is having trouble", async () => {
    // Its own key: a page this instance has never served successfully, and that nothing has
    // written to the store either — which is what a first request after a deployment meets.
    await expect(
      readWithLastGood("events:never-served", async () => {
        throw DOWN;
      }, NOW),
    ).rejects.toThrow(DOWN);
  });

  it("refuses a copy older than the honesty window, rather than advertising a cancelled race", async () => {
    await readWithLastGood("events:ro", async () => ["something"], NOW);
    const tooLate = new Date(NOW.getTime() + (SNAPSHOT_MAX_AGE_HOURS + 1) * 3_600_000);

    await expect(
      readWithLastGood("events:ro", async () => {
        throw DOWN;
      }, tooLate),
    ).rejects.toThrow(DOWN);
  });

  it("puts a 404 back rather than answering it with last week's page", async () => {
    await readWithLastGood("event:ro:cros", async () => ({ title: "Cros" }), NOW);

    // What `notFound()` throws: Next recognises it by its digest, and so must this.
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });

    await expect(
      readWithLastGood("event:ro:cros", async () => {
        throw notFound;
      }, new Date(NOW.getTime() + 60_000)),
    ).rejects.toBe(notFound);
  });

  it("keeps one key's copy out of another's", async () => {
    await readWithLastGood("events:ro", async () => "romanian", NOW);

    await expect(
      readWithLastGood("events:en", async () => {
        throw DOWN;
      }, NOW),
    ).rejects.toThrow(DOWN);
  });
});

describe("DECISIONS.md §281 what is written down survives being read back", () => {
  it("returns a Date as a Date, wherever it sits", async () => {
    const written = writeEnvelope({
      takenAt: NOW,
      value: { startsAt: new Date("2026-11-21T06:00:00.000Z"), nested: [{ approvedAt: NOW }], title: "Cros" },
    });
    const back = readEnvelope<{ startsAt: Date; nested: { approvedAt: Date }[]; title: string }>(written);

    expect(back?.value.startsAt).toBeInstanceOf(Date);
    expect(back?.value.startsAt.toISOString()).toBe("2026-11-21T06:00:00.000Z");
    expect(back?.value.nested[0].approvedAt).toBeInstanceOf(Date);
    expect(back?.value.title).toBe("Cros");
    expect(back?.takenAt).toEqual(NOW);
  });

  it("reads nothing out of bytes that are not an envelope, rather than throwing", () => {
    expect(readEnvelope(null)).toBeNull();
    expect(readEnvelope("")).toBeNull();
    expect(readEnvelope("{not json")).toBeNull();
    expect(readEnvelope('{"value":1}')).toBeNull();
    expect(readEnvelope('{"takenAt":"not a date","value":1}')).toBeNull();
  });

  it("does not store what cannot be written down", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(writeEnvelope({ takenAt: NOW, value: cycle })).toBeNull();
  });

  it("measures age from when the copy was taken", () => {
    const envelope = { takenAt: NOW, value: 1 };
    expect(isSnapshotTooOld(envelope, new Date(NOW.getTime() + 11 * 3_600_000))).toBe(false);
    expect(isSnapshotTooOld(envelope, new Date(NOW.getTime() + 13 * 3_600_000))).toBe(true);
  });
});
