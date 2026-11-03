import { describe, expect, it } from "vitest";
import { placeOutlook } from "@/modules/registrations/domain/place-outlook";

/**
 * «Locuri» (the owner, 2026-11-03): the free places go to the official waiting list first, then to the
 * internal list's lines; everybody left needs one supplementary place each.
 */
describe("placeOutlook", () => {
  it("reads the race as the owner counted it on 2026-11-03", () => {
    // 166 places, 150 confirmed + 8 to sign, 7 waiting, 5 internal lines, 3 special guests.
    expect(placeOutlook({ capacity: 166, occupied: 158, confirmed: 150, waiting: 7, internal: 5, outside: 3 })).toEqual({
      capacity: 166,
      occupied: 158,
      confirmed: 150,
      waiting: 7,
      internal: 5,
      outside: 3,
      free: 8,
      held: 8,
      fromWaiting: 7,
      fromInternal: 1,
      raises: 4,
      totalIfAll: 173,
    });
  });

  it("gives the free places to the official waiting list before the internal list", () => {
    const outlook = placeOutlook({ capacity: 10, occupied: 7, confirmed: 7, waiting: 5, internal: 2, outside: 0 });
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises]).toEqual([3, 3, 0, 4]);
  });

  it("needs no place added when the free places cover both lists", () => {
    const outlook = placeOutlook({ capacity: 20, occupied: 10, confirmed: 10, waiting: 2, internal: 3, outside: 1 });
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises, outlook.totalIfAll]).toEqual([10, 2, 3, 0, 16]);
  });

  it("counts no free place when the capacity was lowered under the places taken", () => {
    const outlook = placeOutlook({ capacity: 100, occupied: 104, confirmed: 104, waiting: 2, internal: 1, outside: 0 });
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises]).toEqual([0, 0, 0, 3]);
  });
});
