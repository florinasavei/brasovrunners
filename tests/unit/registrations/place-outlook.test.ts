import { describe, expect, it } from "vitest";
import { HELD_KINDS, placeOutlook, type PlaceOutlookCounts } from "@/modules/registrations/domain/place-outlook";

/**
 * «Locuri» (the owner, 2026-11-03): the free places go to the official waiting list first, then to the
 * internal list's lines; everybody left needs one supplementary place each.
 */

/** No place held by anybody who has not signed: every place taken is a confirmed one, unless a test says otherwise. */
const NOBODY_HOLDS = { declaration: 0, offered: 0, invited: 0, family: 0 };

function counts(over: Omit<PlaceOutlookCounts, keyof typeof NOBODY_HOLDS> & Partial<typeof NOBODY_HOLDS>): PlaceOutlookCounts {
  return { ...NOBODY_HOLDS, ...over };
}

describe("placeOutlook", () => {
  it("reads the race as the owner counted it on 2026-11-03", () => {
    // 166 places, 150 confirmed + 8 to sign, 7 waiting, 5 internal lines, 3 special guests.
    expect(placeOutlook(counts({ capacity: 166, occupied: 158, confirmed: 150, declaration: 8, waiting: 7, internal: 5, outside: 3 }))).toEqual({
      capacity: 166,
      occupied: 158,
      confirmed: 150,
      declaration: 8,
      offered: 0,
      invited: 0,
      family: 0,
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

  it("carries the held places by kind beside their sum (§NNN): 13 = 9 declarations + 2 offers + 2 invitations", () => {
    const outlook = placeOutlook(counts({ capacity: 180, occupied: 175, confirmed: 162, declaration: 9, offered: 2, invited: 2, waiting: 0, internal: 0, outside: 0 }));
    expect(outlook.held).toBe(13);
    expect(HELD_KINDS.map((kind) => outlook[kind])).toEqual([9, 2, 2, 0]);
    expect(HELD_KINDS.reduce((sum, kind) => sum + outlook[kind], 0)).toBe(outlook.held);
  });

  it("gives the free places to the official waiting list before the internal list", () => {
    const outlook = placeOutlook(counts({ capacity: 10, occupied: 7, confirmed: 7, waiting: 5, internal: 2, outside: 0 }));
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises]).toEqual([3, 3, 0, 4]);
  });

  it("needs no place added when the free places cover both lists", () => {
    const outlook = placeOutlook(counts({ capacity: 20, occupied: 10, confirmed: 10, waiting: 2, internal: 3, outside: 1 }));
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises, outlook.totalIfAll]).toEqual([10, 2, 3, 0, 16]);
  });

  it("counts no free place when the capacity was lowered under the places taken", () => {
    const outlook = placeOutlook(counts({ capacity: 100, occupied: 104, confirmed: 104, waiting: 2, internal: 1, outside: 0 }));
    expect([outlook.free, outlook.fromWaiting, outlook.fromInternal, outlook.raises]).toEqual([0, 0, 0, 3]);
  });
});
