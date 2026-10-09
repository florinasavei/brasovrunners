import { describe, expect, it } from "vitest";
import {
  filterPickerOptions,
  GENERAL_VALUE,
  PICKER_NATIVE_MAX,
  pickerChipsShown,
  pickerFilters,
  pickerKind,
  pickerNoEventFound,
  type PickerOption,
} from "@/modules/feedback/domain/event-picker";

/**
 * BR-REQ-070-04, `DECISIONS.md` §680 (amending §676) — «Evenimentul» filtered as one types: the pure
 * rules the island and the server page share. Case and diacritics do not matter, every word typed must
 * be found in the title or the day, a chip narrows to its kind, «Altceva / în general» is the first row
 * while the box is empty or nothing typed matches an event and steps out while something does (so Enter
 * picks the first match), and eight rows or fewer mount no island at all.
 */
const GENERAL: PickerOption = { value: GENERAL_VALUE, label: "Altceva / în general", kind: "other", day: null, when: null };

const EVENTS: PickerOption[] = [
  { value: "crosul-brasovului", label: "Crosul Brașovului", kind: "race", day: "2026-10-04", when: "sâmbătă, 4 oct. 2026" },
  { value: "happy-monday-2026-10-05", label: "Happy Monday", kind: "group", day: "2026-10-05", when: "luni, 5 oct. 2026" },
  { value: "happy-monday-2026-09-28", label: "Happy Monday", kind: "group", day: "2026-09-28", when: "luni, 28 sept. 2026" },
  { value: "drumetie-pe-tampa", label: "Drumeție pe Tâmpa", kind: "other", day: "2026-09-20", when: "duminică, 20 sept. 2026" },
  { value: "semimaratonul-tampa", label: "Semimaratonul Tâmpa", kind: "race", day: "2026-10-25", when: "duminică, 25 oct. 2026" },
];

const ALL = [GENERAL, ...EVENTS];
const values = (options: readonly PickerOption[]) => options.map((option) => option.value);

describe("BR-REQ-070-04 the feedback form's event picker filters as you type (§680)", () => {
  it("finds a title without its diacritics or its case: «crosul» finds «Crosul», «brasov» finds «Brașov»", () => {
    expect(values(filterPickerOptions(ALL, "crosul", "all"))).toEqual(["crosul-brasovului"]);
    expect(values(filterPickerOptions(ALL, "brasov", "all"))).toEqual(["crosul-brasovului"]);
    expect(values(filterPickerOptions(ALL, "CROSUL BRAȘOVULUI", "all"))).toEqual(["crosul-brasovului"]);
    expect(values(filterPickerOptions(ALL, "tampa", "all"))).toEqual(["drumetie-pe-tampa", "semimaratonul-tampa"]);
    expect(values(filterPickerOptions(ALL, "drumetie", "all"))).toEqual(["drumetie-pe-tampa"]);
  });

  it("matches the day's words too, and every word typed must be found", () => {
    expect(values(filterPickerOptions(ALL, "happy oct", "all"))).toEqual(["happy-monday-2026-10-05"]);
    expect(values(filterPickerOptions(ALL, "sept", "all"))).toEqual(["happy-monday-2026-09-28", "drumetie-pe-tampa"]);
    expect(values(filterPickerOptions(ALL, "2026-10-25", "all"))).toEqual(["semimaratonul-tampa"]);
    expect(values(filterPickerOptions(ALL, "happy tampa", "all"))).toEqual([GENERAL_VALUE]);
  });

  it("keeps the given order — pickerOrder's — and shows every row on an empty search", () => {
    expect(values(filterPickerOptions(ALL, "", "all"))).toEqual(values(ALL));
    expect(values(filterPickerOptions(ALL, "   ", "all"))).toEqual(values(ALL));
  });

  it("puts «Altceva / în general» first while the box is empty or nothing typed matches an event, whichever chip", () => {
    for (const chip of ["all", "race", "group"] as const) {
      for (const typed of ["", "   ", "nimic-de-gasit", "altceva"]) {
        expect(filterPickerOptions(ALL, typed, chip)[0]).toBe(GENERAL);
      }
    }
    // A chip that leaves nothing of what was typed brings it back too.
    expect(values(filterPickerOptions(ALL, "crosul", "group"))).toEqual([GENERAL_VALUE]);
    // Given last, still drawn first.
    expect(filterPickerOptions([...EVENTS, GENERAL], "", "all")[0]).toBe(GENERAL);
  });

  it("takes «Altceva» out while what was typed matches an event, so the first match is the row Enter picks", () => {
    // MUI highlights the value chosen whenever it is among the rows, and «Altceva» is the value by default:
    // with it in the list, «crosul» + Enter picked «Altceva» (the review of 2026-10-09).
    for (const chip of ["all", "race", "group"] as const) {
      for (const typed of ["crosul", "happy", "tampa", "oct"]) {
        const shown = filterPickerOptions(ALL, typed, chip);
        if (shown.some((option) => option.value !== GENERAL_VALUE)) expect(values(shown)).not.toContain(GENERAL_VALUE);
      }
    }
    expect(filterPickerOptions(ALL, "crosul", "all")[0].value).toBe("crosul-brasovului");
    expect(filterPickerOptions(ALL, "happy", "group")[0].value).toBe("happy-monday-2026-10-05");
    // Cleared, the box shows it first again.
    expect(filterPickerOptions(ALL, "", "all")[0]).toBe(GENERAL);
  });

  it("says «Niciun eveniment găsit» only when no event is left — «Altceva» alone", () => {
    expect(pickerNoEventFound(filterPickerOptions(ALL, "nimic-de-gasit", "all"))).toBe(true);
    expect(pickerNoEventFound(filterPickerOptions(ALL, "crosul", "all"))).toBe(false);
    expect(pickerNoEventFound(filterPickerOptions(ALL, "crosul", "group"))).toBe(true);
    expect(pickerNoEventFound(filterPickerOptions(ALL, "", "all"))).toBe(false);
  });

  it("narrows to a kind with a chip; «Toate» keeps the others (a hike) too", () => {
    expect(values(filterPickerOptions(ALL, "", "race"))).toEqual([GENERAL_VALUE, "crosul-brasovului", "semimaratonul-tampa"]);
    expect(values(filterPickerOptions(ALL, "", "group"))).toEqual([GENERAL_VALUE, "happy-monday-2026-10-05", "happy-monday-2026-09-28"]);
    expect(values(filterPickerOptions(ALL, "", "all"))).toContain("drumetie-pe-tampa");
    expect(values(filterPickerOptions(ALL, "tampa", "race"))).toEqual(["semimaratonul-tampa"]);
  });

  it("draws the chips only when both a race and a group run are among the options", () => {
    expect(pickerChipsShown(ALL)).toBe(true);
    expect(pickerChipsShown(ALL.filter((option) => option.kind !== "race"))).toBe(false);
    expect(pickerChipsShown(ALL.filter((option) => option.kind !== "group"))).toBe(false);
  });

  it("derives the kind from the event's type, with no column of its own", () => {
    expect(pickerKind("RACE")).toBe("race");
    expect(pickerKind("GROUP_RUN")).toBe("group");
    for (const type of ["HIKE", "COFFEE", "GEAR_TEST", "MEETUP", "EXTERNAL"] as const) expect(pickerKind(type)).toBe("other");
  });

  it("mounts no island for eight rows or fewer — «Altceva» counted — and does for nine", () => {
    expect(PICKER_NATIVE_MAX).toBe(8);
    const rows = (count: number): PickerOption[] => [
      GENERAL,
      ...Array.from({ length: count - 1 }, (_, index) => ({ ...EVENTS[1], value: `happy-monday-${index}` })),
    ];
    expect(pickerFilters(rows(1))).toBe(false);
    expect(pickerFilters(rows(8))).toBe(false);
    expect(pickerFilters(rows(9))).toBe(true);
  });
});
