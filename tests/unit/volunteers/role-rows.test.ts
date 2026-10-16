import { describe, expect, it } from "vitest";
import { NEW_ROLE_ROW_PREFIX, newRoleRowKey, postedRoleRows, ROLE_ROW_BOXES, roleBox, roleColourBoxesOf } from "@/modules/volunteers/role-rows";

/**
 * §791 — the names the «Roluri» card's one form posts under, spelled once for the card that draws them, the action that reads them and the
 * service that names a refused box: `roles[<key>].<box>`, a saved role's key its id, a blank row's `new-<category id>` or `new-none`.
 */
const ID = "d1111111-1111-4111-8111-111111111111";
const OTHER = "d2222222-2222-4222-8222-222222222222";
const CATEGORY = "c1111111-1111-4111-8111-111111111111";

describe("the names", () => {
  it("spells a box by its row's key, in the house's dotted way, so the translate buttons and the twin folds find their Romanian twin by suffix", () => {
    expect(roleBox(ID, "nameRo")).toBe(`roles[${ID}].nameRo`);
    expect(roleBox(newRoleRowKey(CATEGORY), "nameEn")).toBe(`roles[new-${CATEGORY}].nameEn`);
    expect(newRoleRowKey(null)).toBe("new-none");
    expect(roleColourBoxesOf(ID)).toEqual({ choice: `roles[${ID}].colourChoice`, typed: `roles[${ID}].colourTyped` });
    expect(ROLE_ROW_BOXES).toContain("position");
    expect(NEW_ROLE_ROW_PREFIX).toBe("new-");
  });
});

describe("the rows of a post", () => {
  it("groups the boxes by their row, in the order the rows first appear, a saved role's key its id", () => {
    const rows = postedRoleRows([
      ["uiLocale", "ro"],
      [roleBox(ID, "nameRo"), "Apă"],
      [roleBox(OTHER, "nameRo"), "Sosire"],
      [roleBox(ID, "nameEn"), "Water"],
      [roleBox(ID, "position"), "2"],
      ["$ACTION_ID_abc", ""],
    ]);
    expect(rows.map((row) => [row.key, row.id])).toEqual([[ID, ID], [OTHER, OTHER]]);
    expect(rows[0].fields).toEqual({ nameRo: "Apă", nameEn: "Water", position: "2" });
  });

  it("reads a blank row's category from its key unless the row posts its own «Categoria», and gives it no saved role", () => {
    const [under, none, chosen] = postedRoleRows([
      [roleBox(newRoleRowKey(CATEGORY), "nameRo"), "Nou"],
      [roleBox(newRoleRowKey(null), "nameRo"), "Altul"],
      [roleBox(newRoleRowKey(CATEGORY), "categoryId"), ""],
      [roleBox("new-other", "nameRo"), "Al treilea"],
      [roleBox("new-other", "categoryId"), CATEGORY],
    ]);
    expect(under).toMatchObject({ key: `new-${CATEGORY}`, id: null, fields: { categoryId: "", nameRo: "Nou" } });
    expect(none).toMatchObject({ id: null, fields: { categoryId: "", nameRo: "Altul" } });
    expect(chosen).toMatchObject({ id: null, fields: { categoryId: CATEGORY } });
  });

  it("reads the unticked «Nelimitat» as not ticked — the house's tick posts nothing — only for a row that drew its number box", () => {
    const rows = postedRoleRows([
      [roleBox(ID, "needed"), "3"],
      [roleBox(OTHER, "needed"), ""],
      [roleBox(OTHER, "unlimited"), "on"],
      [roleBox("e3333333-3333-4333-8333-333333333333", "nameEn"), "Only a name"],
    ]);
    expect(rows[0].fields.unlimited).toBe("");
    expect(rows[1].fields.unlimited).toBe("on");
    expect("unlimited" in rows[2].fields).toBe(false);
  });

  it("leaves alone what is not a row's box — another form's name, a file, a name with a box the row does not have", () => {
    expect(
      postedRoleRows([
        ["nameRo", "Altă formă"],
        [`roles[${ID}].shell`, "x"],
        [`roles[${ID}].nameRo`, new Blob(["x"])],
        [`roles[].nameRo`, "x"],
        [`roles[${ID}]nameRo`, "x"],
      ]),
    ).toEqual([]);
  });
});
