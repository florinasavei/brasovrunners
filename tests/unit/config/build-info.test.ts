import { describe, expect, it } from "vitest";
import { formatLastUpdated, formatVersion, type BuildInfo } from "@/shared/config/build-info";

/**
 * The build badge's two pure functions. They run against values `next.config.ts` inlines at
 * build time, and every one of those can be absent — a shallow clone, a source archive with
 * no `.git`, a host that strips git — so the interesting cases here are the missing ones.
 */
const FULL: BuildInfo = {
  baseline: "BR-V1.16-2026-09-04",
  commit: "a1b2c3d",
  committedAt: "2026-09-04T18:30:00.000Z",
};

describe("formatVersion", () => {
  it("names the baseline and the commit, without the baseline's own date", () => {
    // The badge shows a date of its own; two dates that can disagree read as a bug.
    expect(formatVersion(FULL)).toBe("BR-V1.16 · a1b2c3d");
  });

  it("falls back to the baseline alone when there is no git checkout", () => {
    expect(formatVersion({ ...FULL, commit: "" })).toBe("BR-V1.16");
  });

  it("falls back to the commit alone when the changelog could not be read", () => {
    expect(formatVersion({ ...FULL, baseline: "" })).toBe("a1b2c3d");
  });

  it("says dev when it knows nothing, rather than rendering an empty badge", () => {
    expect(formatVersion({ baseline: "", commit: "", committedAt: "" })).toBe("dev");
  });
});

describe("formatLastUpdated", () => {
  it("formats in Romanian for ro", () => {
    const formatted = formatLastUpdated("ro", FULL);
    expect(formatted).toBeTruthy();
    expect(formatted).toContain("2026");
    expect(formatted).toContain("4");
  });

  it("formats in English for en", () => {
    expect(formatLastUpdated("en", FULL)).toContain("Sep");
  });

  it("fixes the timezone to the club's, so one build reads the same date to every reader", () => {
    // 22:30 UTC is already the next day in Bucharest (UTC+3 in September).
    const lateEvening: BuildInfo = { ...FULL, committedAt: "2026-09-04T22:30:00.000Z" };
    expect(formatLastUpdated("en", lateEvening)).toContain("5");
  });

  it("returns null when there is no date, so the badge shows the version alone", () => {
    expect(formatLastUpdated("ro", { ...FULL, committedAt: "" })).toBeNull();
  });

  it("returns null for an unparseable date rather than rendering Invalid Date", () => {
    expect(formatLastUpdated("ro", { ...FULL, committedAt: "not-a-date" })).toBeNull();
  });
});
