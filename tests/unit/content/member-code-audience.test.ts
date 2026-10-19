import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { discountCodeFieldsSchema } from "@/modules/content/member-codes/fields";
import TierChips from "@/modules/content/member-tiers/ui/TierChips";
import { RecallProvider, type Recall } from "@/shared/forms/recall";

/**
 * §811, amended by §NNN — every discount code says who it is for: one or more levels, or «Toți membrii», chosen explicitly. Never by
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

describe("§811 the chips' refusal sentence", () => {
  const WORDS = { ro: ro.Admin.members.codes, en: en.Admin.members.codes } as const;
  const TIERS = [
    { id: LEVEL, label: "Fondator" },
    { id: OTHER, label: "Membru" },
  ];
  const chips = (words: (typeof WORDS)[keyof typeof WORDS], recall: Recall | null) =>
    renderToStaticMarkup(
      createElement(
        RecallProvider,
        { value: recall ?? { values: null, fields: [], generation: 0, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<typeof RecallProvider>,
        createElement(TierChips, {
          name: "tierIds",
          allName: "forAll",
          legend: words.forTiers,
          hint: words.forTiersHelp,
          allLabel: words.forAllMembers,
          noneMessage: words.forTiersNone,
          bothMessage: words.forTiersBoth,
          tiers: TIERS,
          checkedIds: [],
          allChecked: false,
        }),
      ),
    );
  const refused = (values: Record<string, string[]>): Recall => ({ values, fields: ["tierIds"], generation: 1, fieldError: "Verifică acest câmp.", scope: "code-new" });
  const refusalOf = (html: string) => /data-testid="tier-chips-refusal"[^>]*>([^<]*)</.exec(html)?.[1] ?? /<span[^>]*data-testid="tier-chips-refusal"[^>]*>([^<]*)</.exec(html)?.[1];
  const ticked = (html: string) => (html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []).filter((box) => box.includes("checked")).map((box) => /value="([^"]+)"/.exec(box)?.[1]);

  for (const locale of ["ro", "en"] as const) {
    const words = WORDS[locale];

    it(`says «both» when «Toți membrii» and a level were posted, and puts the posted chips back (${locale})`, () => {
      const html = chips(words, refused({ forAll: ["1"], tierIds: [LEVEL] }));
      expect(refusalOf(html)).toContain(words.forTiersBoth);
      expect(refusalOf(html)).not.toContain(words.forTiersNone);
      expect(ticked(html).sort()).toEqual(["1", LEVEL].sort());
      expect(html).toContain('id="field-code-new-tierIds"');
    });

    it(`says «none» when nothing was posted (${locale})`, () => {
      const html = chips(words, refused({}));
      expect(refusalOf(html)).toContain(words.forTiersNone);
      expect(refusalOf(html)).not.toContain(words.forTiersBoth);
      expect(ticked(html)).toEqual([]);
      expect(html).toContain('id="field-code-new-tierIds"');
    });

    it(`says nothing of a refusal on a first paint (${locale})`, () => {
      const html = chips(words, null);
      expect(html).not.toContain("tier-chips-refusal");
      expect(html).toContain(words.forTiersHelp);
    });
  }

  it("falls back to the field's own error for a post that chose well but named an unknown level", () => {
    const html = chips(WORDS.ro, refused({ tierIds: ["nu-e-un-id"] }));
    expect(refusalOf(html)).toContain("Verifică acest câmp.");
  });
});
