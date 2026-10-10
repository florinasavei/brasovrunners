import { describe, expect, it } from "vitest";
import { buildCanvasRows, type CanvasCard, cardsOffCanvas } from "@/modules/content/team/domain/canvas";
import { isTeamLevel, TEAM_LEVEL_MAX, TEAM_LEVEL_MIN, TEAM_LEVELS, teamMemberFieldsSchema } from "@/modules/content/team/fields";

/**
 * §NNN — «Echipa» as a canvas with levels: the pure layout over the shown cards' levels, and what
 * «Nivel» accepts. Fixtures say «Președinte», «Sfătuitor», «Rol A»: no person's name, no real role.
 */

type Card = CanvasCard & { id: string };
const card = (id: string, level: number | null): Card => ({ id, level });
const ids = (cards: readonly Card[]) => cards.map((c) => c.id);

describe("§NNN buildCanvasRows", () => {
  it("makes one row per whole number, ascending, the .0 cards as leads and the .5 cards beside, each in the list's order", () => {
    const rows = buildCanvasRows([card("Rol B", 2), card("Președinte", 1), card("Sfătuitor", 1.5), card("Rol A", 2), card("Rol D", 3), card("Rol C", 2.5)]);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3]);
    expect(ids(rows[0]!.lead)).toEqual(["Președinte"]);
    expect(ids(rows[0]!.beside)).toEqual(["Sfătuitor"]);
    // The list's order, not the alphabet: Rol B was listed before Rol A.
    expect(ids(rows[1]!.lead)).toEqual(["Rol B", "Rol A"]);
    expect(ids(rows[1]!.beside)).toEqual(["Rol C"]);
    expect(ids(rows[2]!.lead)).toEqual(["Rol D"]);
    expect(rows[2]!.beside).toEqual([]);
  });

  it("keeps a lone .5 as a row of small cards with no lead, and skips a row nobody is on", () => {
    expect(buildCanvasRows([card("Sfătuitor", 1.5)])).toEqual([{ level: 1, lead: [], beside: [card("Sfătuitor", 1.5)] }]);
    expect(buildCanvasRows([card("Președinte", 1), card("Rol A", 4)]).map((row) => row.level)).toEqual([1, 4]);
  });

  it("leaves a card without a level off the canvas, in the list's order, and makes no row when nobody has one", () => {
    const cards = [card("Rol A", null), card("Președinte", 1), card("Rol B", null)];
    expect(ids(buildCanvasRows(cards)[0]!.lead)).toEqual(["Președinte"]);
    expect(ids(cardsOffCanvas(cards))).toEqual(["Rol A", "Rol B"]);
    expect(buildCanvasRows([card("Rol A", null), card("Rol B", null)])).toEqual([]);
    expect(buildCanvasRows([])).toEqual([]);
  });
});

describe("§NNN «Nivel» as the save keeps it", () => {
  const base = { name: "Președinte", roleRo: "", roleEn: "", bioRo: "", bioEn: "", photoAssetId: "" };
  const issuesOf = (value: unknown) => {
    const parsed = teamMemberFieldsSchema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  };
  const levelOf = (level: unknown) => teamMemberFieldsSchema.parse({ ...base, level }).level;

  it("is nothing by default, and nothing for an empty box", () => {
    expect(teamMemberFieldsSchema.parse(base).level).toBeNull();
    expect(levelOf("")).toBeNull();
    expect(levelOf("  ")).toBeNull();
    expect(levelOf(null)).toBeNull();
  });

  it("takes a whole or half step from 1 to 9, as the select posts it, as a fixture's number, or with a comma", () => {
    expect(levelOf("1")).toBe(1);
    expect(levelOf("1.5")).toBe(1.5);
    expect(levelOf("1,5")).toBe(1.5);
    expect(levelOf(2.5)).toBe(2.5);
    expect(levelOf("9")).toBe(9);
    expect(levelOf(" 3 ")).toBe(3);
  });

  it("refuses a quarter step, a level off the scale and a word, naming the box and keeping the rest", () => {
    for (const bad of ["1.25", "0.5", "9.5", "10", "0", "-1", "abc", "1.5.5"]) {
      expect(issuesOf({ ...base, level: bad }), bad).toEqual(["level"]);
    }
  });

  it("knows its scale: seventeen steps from 1 to 9, half by half", () => {
    expect(TEAM_LEVEL_MIN).toBe(1);
    expect(TEAM_LEVEL_MAX).toBe(9);
    expect(TEAM_LEVELS).toHaveLength(17);
    expect(TEAM_LEVELS.slice(0, 4)).toEqual([1, 1.5, 2, 2.5]);
    expect(TEAM_LEVELS.at(-1)).toBe(9);
    expect(TEAM_LEVELS.every(isTeamLevel)).toBe(true);
    expect(isTeamLevel(1.25)).toBe(false);
    expect(isTeamLevel(Number.NaN)).toBe(false);
  });
});
