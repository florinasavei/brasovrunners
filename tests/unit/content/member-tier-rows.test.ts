import { describe, expect, it } from "vitest";
import { parseTierPosition, tierFieldsSchema, TIER_DESCRIPTION_MAX, TIER_NAME_MAX } from "@/modules/content/member-tiers/fields";
import { NEW_TIER_ROW_KEY, orderTierRows, postedTierRows, TIER_ROW_BOXES, tierBox } from "@/modules/content/member-tiers/tier-rows";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";

/**
 * §NNN — the pure parts of «Niveluri de membru»: the names the card's one form posts under, the ordering rule of §791 for a
 * list without categories, the typed number, what a level's boxes must hold, and the translate allowlist's entry for them.
 */
describe("§NNN the card's posted names", () => {
  it("groups the boxes by their level's key, in the order the first box appears, and leaves other names alone", () => {
    const rows = postedTierRows([
      ["uiLocale", "ro"],
      ["tiers[a].nameRo", "Membru"],
      ["tiers[b].nameRo", "Fondator"],
      ["tiers[a].nameEn", "Member"],
      ["tiers[a].was", "1"],
      ["tiers[a].mystery", "ignored"],
      ["roles[a].nameRo", "not a tier"],
      ["tiers[new].nameRo", ""],
    ]);
    expect(rows.map((row) => row.key)).toEqual(["a", "b", "new"]);
    expect(rows[0]).toEqual({ key: "a", id: "a", fields: { nameRo: "Membru", nameEn: "Member", was: "1", hidden: "" } });
    expect(rows[2].id).toBeNull();
    expect(tierBox("a", "nameEn")).toBe("tiers[a].nameEn");
    expect(TIER_ROW_BOXES).toContain("was");
    expect(NEW_TIER_ROW_KEY).toBe("new");
  });

  it("reads the unticked «Ascuns» of a row that posted its names as not hidden, and leaves a row with no names to keep the level's tick", () => {
    const [named, bare, ticked] = postedTierRows([
      ["tiers[a].nameRo", "A"],
      ["tiers[b].position", "2"],
      ["tiers[c].nameRo", "C"],
      ["tiers[c].hidden", "on"],
    ]);
    expect(named.fields.hidden).toBe("");
    expect("hidden" in bare.fields).toBe(false);
    expect(ticked.fields.hidden).toBe("on");
  });

  it("ignores a value that is not a string (a file)", () => {
    expect(postedTierRows([["tiers[a].nameRo", new Blob(["x"])]])).toEqual([]);
  });
});

describe("§NNN the order the numbers typed ask for (§791's rule)", () => {
  const rows = (typed: Record<string, number | null>, extra: { key: string; typed: number | null }[] = []) => [
    ...["a", "b", "c"].map((key, index) => ({ key, was: index + 1, typed: typed[key] ?? null })),
    ...extra.map((row) => ({ ...row, was: null })),
  ];

  it("keeps the order when nobody typed a number", () => {
    expect(orderTierRows(rows({}))).toEqual(["a", "b", "c"]);
  });

  it("puts a level that took a lower number before the one that holds it", () => {
    expect(orderTierRows(rows({ c: 1 }))).toEqual(["c", "a", "b"]);
    expect(orderTierRows(rows({ c: 2 }))).toEqual(["a", "c", "b"]);
  });

  it("puts a level that took a higher number after the one that holds it", () => {
    expect(orderTierRows(rows({ a: 3 }))).toEqual(["b", "c", "a"]);
    expect(orderTierRows(rows({ a: 2 }))).toEqual(["b", "a", "c"]);
  });

  it("puts a number past the end last, and a number the level already had nowhere", () => {
    expect(orderTierRows(rows({ a: 9 }))).toEqual(["b", "c", "a"]);
    expect(orderTierRows(rows({ b: 2 }))).toEqual(["a", "b", "c"]);
  });

  it("puts a new level last unless a number was typed, then before the level that holds it", () => {
    expect(orderTierRows(rows({}, [{ key: "new", typed: null }]))).toEqual(["a", "b", "c", "new"]);
    expect(orderTierRows(rows({}, [{ key: "new", typed: 2 }]))).toEqual(["a", "new", "b", "c"]);
    expect(orderTierRows(rows({}, [{ key: "new", typed: 1 }]))).toEqual(["new", "a", "b", "c"]);
  });

  it("is stable: two levels that ask the same place keep the order they had", () => {
    expect(orderTierRows(rows({ b: 1, c: 1 }))).toEqual(["b", "c", "a"]);
  });
});

describe("§NNN a typed «Poziția»", () => {
  it("is a whole number from 1, or nothing", () => {
    expect(parseTierPosition(undefined)).toEqual({ ok: true, value: null });
    expect(parseTierPosition("  ")).toEqual({ ok: true, value: null });
    expect(parseTierPosition("3")).toEqual({ ok: true, value: 3 });
    expect(parseTierPosition(" 12 ")).toEqual({ ok: true, value: 12 });
    for (const bad of ["0", "-1", "1.5", "abc", "1e2", "1000"]) expect(parseTierPosition(bad), bad).toEqual({ ok: false });
  });
});

describe("§NNN what a level's boxes must hold", () => {
  const ok = { nameRo: "Membru", nameEn: "Member" };

  it("needs a name in each language, one line, at most forty characters", () => {
    expect(tierFieldsSchema.safeParse(ok).success).toBe(true);
    expect(tierFieldsSchema.safeParse({ ...ok, nameEn: "  " }).success).toBe(false);
    expect(tierFieldsSchema.safeParse({ nameEn: "Member" }).success).toBe(false);
    expect(tierFieldsSchema.parse({ nameRo: "Membru   fondator\n", nameEn: "Founder   member" })).toMatchObject({ nameRo: "Membru fondator", nameEn: "Founder member" });
    expect(tierFieldsSchema.safeParse({ ...ok, nameRo: "a".repeat(TIER_NAME_MAX) }).success).toBe(true);
    expect(tierFieldsSchema.safeParse({ ...ok, nameRo: "a".repeat(TIER_NAME_MAX + 1) }).success).toBe(false);
  });

  it("takes a description in both languages or neither, at most four hundred characters, plain paragraphs", () => {
    expect(tierFieldsSchema.parse(ok)).toMatchObject({ descriptionRo: null, descriptionEn: null });
    expect(tierFieldsSchema.parse({ ...ok, descriptionRo: "Unu.\r\n\r\n\r\n\r\nDoi.", descriptionEn: "One.\n\n\n\nTwo." })).toMatchObject({ descriptionRo: "Unu.\n\nDoi.", descriptionEn: "One.\n\nTwo." });
    const one = tierFieldsSchema.safeParse({ ...ok, descriptionRo: "Doar română." });
    expect(one.success).toBe(false);
    expect(one.success ? [] : one.error.issues.map((issue) => issue.path)).toEqual([["descriptionEn"]]);
    expect(tierFieldsSchema.safeParse({ ...ok, descriptionRo: "a".repeat(TIER_DESCRIPTION_MAX), descriptionEn: "b".repeat(TIER_DESCRIPTION_MAX) }).success).toBe(true);
    expect(tierFieldsSchema.safeParse({ ...ok, descriptionRo: "a".repeat(TIER_DESCRIPTION_MAX + 1), descriptionEn: "b" }).success).toBe(false);
  });
});

describe("§NNN «Tradu din română» on a level's English boxes", () => {
  it("may fill the name and the description of a level, by the key the card posts them under, and nothing else of the row", () => {
    for (const name of ["tiers[11111111-1111-4111-8111-111111111111].nameEn", "tiers[new].nameEn", "tiers[a].descriptionEn"]) {
      expect(isTranslatableEnglishField(name), name).toBe(true);
      expect(isRichTextField(name), name).toBe(false);
    }
    for (const name of ["tiers[a].nameRo", "tiers[a].glyph", "tiers[a].position", "tiers[].nameEn", "tiers.nameEn", "tiers[a][b].nameEn", "tiers[a].nameEnX"]) {
      expect(isTranslatableEnglishField(name), name).toBe(false);
    }
  });

  it("finds the Romanian twin of each", () => {
    expect(romanianTwinCandidates("tiers[a].nameEn")).toContain("tiers[a].nameRo");
    expect(romanianTwinCandidates("tiers[new].descriptionEn")).toContain("tiers[new].descriptionRo");
  });
});
