import { describe, expect, it, vi } from "vitest";
import { atTheClock } from "../../helpers/clock";

const instant = new Date("2020-06-01T00:00:00Z");

describe("atTheClock (§NNN)", () => {
  it("keeps the date frozen until a thenable that is not a Promise settles", async () => {
    const thenable = {
      then(resolve: (value: number) => void) {
        setTimeout(() => resolve(Date.now()), 5);
      },
    };
    const seen = await atTheClock(instant, () => thenable as unknown as PromiseLike<number>);
    expect(seen).toBe(instant.getTime());
    expect(Date.now()).toBeGreaterThan(instant.getTime());
  });

  it("returns a plain value and puts the real clock back", () => {
    expect(atTheClock(instant, () => Date.now())).toBe(instant.getTime());
    expect(Date.now()).toBeGreaterThan(instant.getTime());
  });

  it("switches an outer file-level fake clock back to real: it must not nest", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      atTheClock(instant, () => 1);
      expect(vi.isFakeTimers()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
