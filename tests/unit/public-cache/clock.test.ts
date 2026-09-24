import { describe, expect, it } from "vitest";
import { clockWindow } from "@/modules/public-cache/clock";

/**
 * §NNN — the clock as part of a public cache key. The stretch of time `now` is in must change
 * exactly when the SQL comparison behind the cached read changes its answer, on the right side
 * of the boundary millisecond, and never in between.
 */
const at = (iso: string) => new Date(iso);

describe("§NNN clockWindow", () => {
  const endings = [at("2026-10-01T10:00:00.000Z"), at("2026-10-08T10:00:00.000Z"), at("2026-10-15T10:00:00.000Z")];

  it("names the stretch by the next instant ahead, and keeps the name until that instant", () => {
    const early = clockWindow(endings, at("2026-09-24T12:00:00.000Z"), "passed");
    const later = clockWindow(endings, at("2026-09-30T23:59:59.000Z"), "passed");
    expect(early).toBe("2026-10-01T10:00:00.000Z");
    expect(later).toBe(early);
    expect(clockWindow(endings, at("2026-10-02T00:00:00.000Z"), "passed")).toBe("2026-10-08T10:00:00.000Z");
  });

  it("'passed': an event that ends at this very millisecond is still upcoming, so the stretch has not turned", () => {
    // `coalesce(ends_at, starts_at) >= now` is true at the boundary itself.
    expect(clockWindow(endings, at("2026-10-01T10:00:00.000Z"), "passed")).toBe("2026-10-01T10:00:00.000Z");
    expect(clockWindow(endings, at("2026-10-01T10:00:00.001Z"), "passed")).toBe("2026-10-08T10:00:00.000Z");
  });

  it("'reached': a version effective at this very millisecond is already in force, so the stretch has turned", () => {
    // `effective_at <= now` and `hold_expires_at > now` both change at the boundary itself.
    expect(clockWindow(endings, at("2026-10-01T09:59:59.999Z"), "reached")).toBe("2026-10-01T10:00:00.000Z");
    expect(clockWindow(endings, at("2026-10-01T10:00:00.000Z"), "reached")).toBe("2026-10-08T10:00:00.000Z");
  });

  it("says nothing but a write can change the answer once every instant is behind", () => {
    expect(clockWindow(endings, at("2026-11-01T00:00:00.000Z"), "passed")).toBe("after-last");
    expect(clockWindow([], at("2026-11-01T00:00:00.000Z"), "reached")).toBe("after-last");
  });

  it("does not depend on the order the instants arrive in, and skips an unreadable one", () => {
    const shuffled = [endings[2], new Date("not a date"), endings[0], endings[1]];
    expect(clockWindow(shuffled, at("2026-10-05T00:00:00.000Z"), "passed")).toBe("2026-10-08T10:00:00.000Z");
  });
});
