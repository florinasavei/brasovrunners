import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { registrationSubmissionSchema, staffRegistrationSubmissionSchema } from "@/modules/registrations/fields";
import { isSexChoice, SEX_CHOICES, sexCell, sexShown, withoutRetiredSex } from "@/modules/registrations/domain/sex";
import SexField from "@/modules/registrations/ui/SexField";
import { fieldId } from "@/shared/forms/outcome";

/**
 * §554 (amending §510) — «Sex» on the public registration form is two answers, «Masculin» and
 * «Feminin», each with its glyph, as two radio cards the server draws: real `<input type="radio"
 * name="sex" required>`, nothing pre-chosen, so a reader without JavaScript answers and the browser
 * refuses a form without an answer. «Prefer să nu spun» is gone from the form, the catalogues and
 * every schema; the enum keeps it for the rows stored with it.
 */
const answers = { MALE: "Masculin", FEMALE: "Feminin" } as const;

function render(defaultValue?: string, error = false) {
  return renderToStaticMarkup(
    createElement(SexField, { id: fieldId("sex"), name: "sex", label: "Sex", answers, defaultValue, error, helperText: "Pentru clasamentele pe categorii." }),
  );
}

/** Each radio `<input …>` with its value, id and whether it is checked. */
function radios(html: string) {
  return [...html.matchAll(/<input([^>]*)>/g)]
    .map(([, attributes]) => attributes)
    .filter((attributes) => attributes.includes('type="radio"'))
    .map((attributes) => ({
      value: /value="([^"]*)"/.exec(attributes)?.[1],
      id: /id="([^"]*)"/.exec(attributes)?.[1],
      name: /name="([^"]*)"/.exec(attributes)?.[1],
      required: /\srequired(=""|\s|$)/.test(attributes),
      checked: /\schecked(=""|\s|$)/.test(attributes),
    }));
}

describe("§554 «Sex»: two answers with their glyphs", () => {
  it("offers exactly two answers, Masculin then Feminin — never «Prefer să nu spun»", () => {
    expect(SEX_CHOICES).toEqual(["MALE", "FEMALE"]);
    const html = render();
    const list = radios(html);
    expect(list.map((radio) => radio.value)).toEqual(["MALE", "FEMALE"]);
    expect(list.every((radio) => radio.name === "sex" && radio.required)).toBe(true);
    // Nothing pre-chosen (§510), and nothing a reader without JavaScript cannot reach.
    expect(list.some((radio) => radio.checked)).toBe(false);
    expect(html).not.toContain('type="hidden"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("UNSPECIFIED");
    // The refusal summary's link lands on the first answer (§47).
    expect(list[0].id).toBe(fieldId("sex"));
    expect(new Set(list.map((radio) => radio.id)).size).toBe(2);
  });

  it("draws each answer's own glyph beside its word", () => {
    const html = render();
    const cards = [...html.matchAll(/<label[^>]*>(.*?)<\/label>/g)].map(([, inner]) => inner);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain('data-testid="MaleIcon"');
    expect(cards[0]).toContain("Masculin");
    expect(cards[1]).toContain('data-testid="FemaleIcon"');
    expect(cards[1]).toContain("Feminin");
    // Decoration: the word is the answer's name.
    expect(cards.every((card) => /<svg[^>]*aria-hidden="true"/.test(card))).toBe(true);
  });

  it("is a fieldset named by its legend, with the helper under it (§546)", () => {
    const html = render();
    expect(html).toMatch(/<fieldset[^>]*data-testid="sex-field"/);
    expect(html).toMatch(/<legend[^>]*>Sex/);
    expect(html).toContain(`id="${fieldId("sex")}-helper-text"`);
    expect(html).toContain(`aria-describedby="${fieldId("sex")}-helper-text"`);
  });

  it("keeps a refused submission's answer (§142), and ignores anything that is not one — the retired answer included", () => {
    expect(radios(render("FEMALE")).filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["FEMALE"]);
    for (const stray of ["", "OTHER", "UNSPECIFIED", undefined]) {
      expect(radios(render(stray)).some((radio) => radio.checked)).toBe(false);
    }
    // A refusal says so under the answers, in the error's colour, as the summary names the one field.
    expect(render(undefined, true)).toMatch(/<p[^>]*class="[^"]*Mui-error[^"]*"[^>]*id="field-sex-helper-text"/);
    expect(render()).not.toMatch(/class="[^"]*Mui-error/);
  });

  it("is refused by the domain rule at every door, and a missing answer on the public form", () => {
    const base = { sex: "UNSPECIFIED" };
    expect(registrationSubmissionSchema.shape.sex.safeParse(base.sex).success).toBe(false);
    expect(registrationSubmissionSchema.shape.sex.safeParse(undefined).success).toBe(false);
    for (const answer of SEX_CHOICES) expect(registrationSubmissionSchema.shape.sex.safeParse(answer).success).toBe(true);
    // A staff entry may leave it out (a paper entry, §510), never give the retired answer.
    const staffSex = staffRegistrationSubmissionSchema.shape.sex;
    expect(staffSex.safeParse(undefined).success).toBe(true);
    expect(staffSex.safeParse("UNSPECIFIED").success).toBe(false);
    expect(isSexChoice("UNSPECIFIED")).toBe(false);
  });

  it("shows a stored «Prefer să nu spun» as no answer, and a kept one is dropped rather than refused", () => {
    expect(sexShown("UNSPECIFIED")).toBeNull();
    expect(sexShown(null)).toBeNull();
    expect(sexShown("MALE")).toBe("MALE");
    expect(sexCell("UNSPECIFIED")).toBe("");
    expect(sexCell("FEMALE")).toBe("Female");
    expect(sexCell("MALE")).toBe("Male");
    expect(withoutRetiredSex({ sex: "UNSPECIFIED", city: "Brașov" })).toEqual({ city: "Brașov" });
    expect(withoutRetiredSex({ sex: "MALE", city: "Brașov" })).toEqual({ sex: "MALE", city: "Brașov" });
  });

  it("has the two words in both catalogues, and no word left for the retired answer", () => {
    expect(ro.Registration.sexOptions).toEqual({ FEMALE: "Feminin", MALE: "Masculin" });
    expect(en.Registration.sexOptions).toEqual({ FEMALE: "Female", MALE: "Male" });
    expect(ro.Admin.registrations.sexOptions).toEqual({ MALE: "Masculin", FEMALE: "Feminin" });
    expect(en.Admin.registrations.sexOptions).toEqual({ MALE: "Male", FEMALE: "Female" });
    for (const catalogue of [ro, en]) {
      expect(JSON.stringify(catalogue)).not.toContain("UNSPECIFIED");
      expect("sexMissing" in catalogue.Registration).toBe(false);
      expect("sexChoose" in catalogue.Registration).toBe(false);
    }
  });

  it("is what the form draws, and the §47 summary and the §422 list name it «Sex» like any field", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/register/page.tsx"), "utf8");
    expect(page).toContain("<SexField");
    expect(page).not.toContain("sexMissing");
    expect(page).not.toContain("UNSPECIFIED");
  });
});
