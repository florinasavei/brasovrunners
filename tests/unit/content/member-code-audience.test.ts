import { describe, expect, it } from "vitest";
import { discountCodeFieldsSchema } from "@/modules/content/member-codes/fields";

/**
 * §811, amended — every discount code says who it is for: one or more levels, or «Toți membrii», chosen explicitly. Never by
 * leaving the chips empty, never both. The schema is the one place that says so; the service stores «Toți membrii» as no limit.
 */
const BASE = { partnerName: "Magazinul", code: "BVR15", descriptionRo: "15% la încălțăminte.", descriptionEn: "15% off shoes." };
const LEVEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const issuesOf = (input: Record<string, unknown>) => {
  const parsed = discountCodeFieldsSchema.safeParse({ ...BASE, ...input });
  return parsed.success ? null : parsed.error.issues.map((issue) => issue.path.join("."));
};

describe("§811 a code names who it is for", () => {
  it("refuses a post that chose nobody, on the chips' box", () => {
    expect(issuesOf({})).toEqual(["tierIds"]);
    expect(issuesOf({ tierIds: [] })).toEqual(["tierIds"]);
    expect(issuesOf({ tierIds: [], forAll: false })).toEqual(["tierIds"]);
    expect(issuesOf({ tierIds: [], forAll: "" })).toEqual(["tierIds"]);
  });

  it("refuses «Toți membrii» together with levels, on the same box", () => {
    expect(issuesOf({ tierIds: [LEVEL], forAll: true })).toEqual(["tierIds"]);
    expect(issuesOf({ tierIds: [LEVEL], forAll: "1" })).toEqual(["tierIds"]);
  });

  it("reads «Toți membrii» as a tick, from the checkbox's value or a boolean, with no level in the list", () => {
    for (const forAll of [true, "1", "true", "on"]) {
      const parsed = discountCodeFieldsSchema.parse({ ...BASE, forAll });
      expect(parsed.forAll).toBe(true);
      expect(parsed.tierIds).toEqual([]);
    }
  });

  it("keeps the levels ticked, once each and in lower case", () => {
    const parsed = discountCodeFieldsSchema.parse({ ...BASE, tierIds: [OTHER, LEVEL.toUpperCase(), OTHER] });
    expect(parsed.forAll).toBe(false);
    expect(parsed.tierIds).toEqual([OTHER, LEVEL]);
  });

  it("still refuses a level that is no id, on the same box", () => {
    expect(issuesOf({ tierIds: ["nu-e-un-id"] })).toEqual(["tierIds"]);
  });

  it("keeps the other refusals as they were: one language of the description", () => {
    expect(issuesOf({ forAll: true, descriptionEn: "" })).toEqual(["descriptionEn"]);
  });
});
