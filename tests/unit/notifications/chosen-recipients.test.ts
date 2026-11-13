import { describe, expect, it } from "vitest";
import { type ChoosablePerson, matchingPeople, pickedPeople, recalledPicks, tallyPicks, withPick } from "@/modules/notifications/ui/chosen-recipients";

/**
 * §945 — «Doar anumiți participanți» on «Trimite un mesaj participanților», the composer's list without the browser:
 * who a typed name finds, which ticks a refused send hands back, and what one tick changes. All people are made up.
 */
const PEOPLE: readonly ChoosablePerson[] = [
  { id: "a", name: "Ana-Maria Popescu", state: "Confirmată", test: false },
  { id: "i", name: "Ion O’Neil", state: "Pe lista de așteptare", test: false },
  { id: "s", name: "Ștefan Țurcanu", state: "Confirmată", test: false },
  { id: "t", name: "Test Unu", state: "Confirmată", test: true },
];
const ids = (people: readonly ChoosablePerson[]) => people.map((person) => person.id);

describe("§945 finding somebody on the list by name", () => {
  it("finds everybody while nothing is typed, spaces included", () => {
    expect(matchingPeople(PEOPLE, "")).toBe(PEOPLE);
    expect(ids(matchingPeople(PEOPLE, "   "))).toEqual(["a", "i", "s", "t"]);
  });

  it("forgives case, diacritics, spacing and an apostrophe's shape, as every name here is compared", () => {
    expect(ids(matchingPeople(PEOPLE, "stef"))).toEqual(["s"]);
    expect(ids(matchingPeople(PEOPLE, "ȚURCANU"))).toEqual(["s"]);
    expect(ids(matchingPeople(PEOPLE, "turcanu"))).toEqual(["s"]);
    expect(ids(matchingPeople(PEOPLE, "  ana-maria  "))).toEqual(["a"]);
    expect(ids(matchingPeople(PEOPLE, "o'neil"))).toEqual(["i"]);
  });

  it("finds a name by any of its words, in any order — and by every word typed, never by one alone", () => {
    expect(ids(matchingPeople(PEOPLE, "popescu ana"))).toEqual(["a"]);
    expect(ids(matchingPeople(PEOPLE, "an"))).toEqual(["a", "s"]);
    expect(ids(matchingPeople(PEOPLE, "ana ion"))).toEqual([]);
    expect(ids(matchingPeople(PEOPLE, "zoe"))).toEqual([]);
  });

  it("looks in the name alone: a state's word finds nobody", () => {
    expect(ids(matchingPeople(PEOPLE, "confirmată"))).toEqual([]);
  });
});

describe("§945 the ticks", () => {
  it("start empty, and come back after a refused send as it posted them — kept to the people still on the list", () => {
    expect([...recalledPicks(PEOPLE, undefined)]).toEqual([]);
    expect([...recalledPicks(PEOPLE, [])]).toEqual([]);
    // «gone» cancelled between the page and the press: no longer listed, no longer ticked.
    expect([...recalledPicks(PEOPLE, ["s", "gone", "a", "s"])].sort()).toEqual(["a", "s"]);
  });

  it("change by one box at a time, into a new set", () => {
    const none: ReadonlySet<string> = new Set();
    const one = withPick(none, "a", true);
    expect(one).not.toBe(none);
    expect([...none]).toEqual([]);
    expect([...withPick(one, "a", true)]).toEqual(["a"]);
    expect([...withPick(withPick(one, "s", true), "a", false)]).toEqual(["s"]);
    expect([...withPick(one, "nobody", false)]).toEqual(["a"]);
  });

  it("are said back and posted in the list's order, whatever order they were ticked in", () => {
    const picked = withPick(withPick(withPick(new Set<string>(), "t", true), "a", true), "s", true);
    expect(pickedPeople(PEOPLE, picked).map((person) => person.name)).toEqual(["Ana-Maria Popescu", "Ștefan Țurcanu", "Test Unu"]);
    expect(pickedPeople(PEOPLE, new Set(["gone"]))).toEqual([]);
  });

  it("are counted as the page counts everybody: the real people — the number typed at «Scrie la câți trimiți» — and the test registrations apart", () => {
    expect(tallyPicks(PEOPLE, new Set())).toEqual({ real: 0, test: 0, listed: 3 });
    expect(tallyPicks(PEOPLE, new Set(["a", "s"]))).toEqual({ real: 2, test: 0, listed: 3 });
    expect(tallyPicks(PEOPLE, new Set(["a", "t"]))).toEqual({ real: 1, test: 1, listed: 3 });
    // A tick on nobody listed counts nobody.
    expect(tallyPicks(PEOPLE, new Set(["gone", "t"]))).toEqual({ real: 0, test: 1, listed: 3 });
    expect(tallyPicks([], new Set(["a"]))).toEqual({ real: 0, test: 0, listed: 0 });
  });
});
