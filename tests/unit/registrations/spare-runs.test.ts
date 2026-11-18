import { describe, expect, it } from "vitest";
import { formatRaceNumber } from "@/modules/registrations/domain/race-number";
import { spareRunsText } from "@/modules/registrations/domain/spare-bibs";

/**
 * §NNN — the desk's line of free spares (§444) writes runs of consecutive numbers as ranges, every other number alone, lowest
 * first, each as the event's bibs print it.
 */
describe("§NNN spareRunsText", () => {
  it("writes runs as ranges and lone numbers alone", () => {
    expect(spareRunsText([155, 156, 157, 158, 159, 160, 161, 162, 163])).toBe("155–163");
    expect(spareRunsText([155, 156, 157, 158, 160, 162, 163])).toBe("155–158, 160, 162–163");
    expect(spareRunsText([7])).toBe("7");
    expect(spareRunsText([])).toBe("");
  });

  it("sorts and deduplicates what it is given", () => {
    expect(spareRunsText([12, 10, 11, 11, 20])).toBe("10–12, 20");
  });

  it("writes each number as the event prints it", () => {
    expect(spareRunsText([5, 6, 7, 9], (number) => formatRaceNumber(number, "pad3"))).toBe("005–007, 009");
  });
});
