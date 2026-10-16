import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { decodeRoleBaseline, descriptionDigest, encodeRoleBaseline, roleBaselineOf } from "@/modules/volunteers/role-baseline";
import { ROLE_ROW_BOXES } from "@/modules/volunteers/role-rows";

/**
 * §791 — what the «Roluri» card's form remembers of each role (`role-baseline.ts`), posted back in the hidden `was` box so «Salvează toate
 * rolurile» compares the boxes with the role as DRAWN, never with the role as stored by the time the press arrives.
 */
const role = { nameRo: "Apă", nameEn: "Water", needed: 3, categoryId: "c1111111-1111-4111-8111-111111111111", colour: "#1b5e20", descriptionRoJson: null, descriptionEnJson: null };
const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("the baseline of a role", () => {
  it("round-trips through the box, with the place among the category's roles", () => {
    const baseline = roleBaselineOf(role, 2);
    expect(baseline).toMatchObject({ nameRo: "Apă", nameEn: "Water", needed: 3, colour: "#1b5e20", rank: 2 });
    expect(decodeRoleBaseline(encodeRoleBaseline(baseline))).toEqual(baseline);
    expect(decodeRoleBaseline(encodeRoleBaseline(roleBaselineOf({ ...role, needed: null, categoryId: null, colour: null }, 1)))).toMatchObject({ needed: null, categoryId: null, colour: null });
    expect(ROLE_ROW_BOXES).toContain("was");
  });

  it("reads nothing from a box that is missing, not JSON or not a baseline — the row is then read against the stored role", () => {
    for (const bad of [undefined, null, "", "x", "[]", "null", "{}", JSON.stringify({ ...roleBaselineOf(role, 1), rank: "1" }), JSON.stringify({ ...roleBaselineOf(role, 1), needed: 1.5 }), JSON.stringify({ ...roleBaselineOf(role, 1), nameRo: 3 }), "x".repeat(5000)]) {
      expect(decodeRoleBaseline(bad), String(bad).slice(0, 20)).toBeNull();
    }
  });

  it("digests a description by its content, not by the order its keys come back from the database in", () => {
    const one = para("Stai la km 5.");
    const reordered = { content: one.content, type: "doc" };
    expect(descriptionDigest(reordered)).toBe(descriptionDigest(one));
    expect(descriptionDigest(para("Stai la km 6."))).not.toBe(descriptionDigest(one));
    expect(descriptionDigest(null)).toBe(descriptionDigest(undefined));
    expect(descriptionDigest(null)).not.toBe(descriptionDigest(one));
  });

  it("has words for a role changed meanwhile and one deleted meanwhile, in both languages, in the sentence's own shape", () => {
    for (const messages of [ro, en]) {
      for (const problem of [messages.Admin.volunteers.role.problems.stale, messages.Admin.volunteers.role.problems.gone]) {
        expect(problem.length).toBeGreaterThan(10);
        expect(problem.length).toBeLessThanOrEqual(200);
        expect(problem).not.toMatch(/[.]$/);
      }
    }
    expect("categoryHelp" in ro.Admin.volunteers.role).toBe(false);
    expect("categoryHelp" in en.Admin.volunteers.role).toBe(false);
  });
});
