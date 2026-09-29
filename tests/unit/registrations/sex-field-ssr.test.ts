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
 * §NNN (amending §554, which amended §510) — «Sex» on the public registration form is a dropdown
 * again, «Feminin» first and «Masculin» second: a native `<select name="sex" required>` the server
 * draws behind an empty, disabled «Alege…», nothing pre-chosen, so a reader without JavaScript
 * answers from the phone's own list and the browser refuses a form without an answer. The glyphs
 * live in the island's list and in front of the chosen answer, never in a native option. «Prefer
 * să nu spun» stays gone from the form, the catalogues and every schema (§554); the enum keeps it
 * for the rows stored with it.
 */
const answers = { FEMALE: "Feminin", MALE: "Masculin" } as const;

function render(defaultValue?: string, error = false) {
  return renderToStaticMarkup(
    createElement(SexField, {
      id: fieldId("sex"),
      name: "sex",
      label: "Sex",
      placeholder: "Alege…",
      answers,
      defaultValue,
      error,
      helperText: "Pentru clasamentele pe categorii.",
    }),
  );
}

/** The opening `<select …>` tag of the field. */
function selectTag(html: string): string {
  const match = html.match(/<select[^>]*name="sex"[^>]*>/);
  expect(match, 'a native <select name="sex">').not.toBeNull();
  return match![0];
}

/** Each `<option …>` with its value, words and whether it is chosen or disabled. */
function options(html: string) {
  return [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attributes, words]) => ({
    value: /value="([^"]*)"/.exec(attributes)?.[1],
    words,
    selected: /\sselected(=""|\s|$)/.test(attributes),
    disabled: /\sdisabled(=""|\s|$)/.test(attributes),
  }));
}

describe("§NNN «Sex»: a dropdown, Feminin first", () => {
  it("offers an empty «Alege…», then Feminin, then Masculin — never «Prefer să nu spun»", () => {
    expect(SEX_CHOICES).toEqual(["FEMALE", "MALE"]);
    const html = render();
    const list = options(html);
    expect(list.map((option) => option.value)).toEqual(["", "FEMALE", "MALE"]);
    expect(list.map((option) => option.words)).toEqual(["Alege…", "Feminin", "Masculin"]);
    // The placeholder is chosen and cannot be chosen back: nothing pre-chosen (§510).
    expect(list[0]).toMatchObject({ selected: true, disabled: true });
    expect(list.slice(1).some((option) => option.selected)).toBe(false);
    expect(html).not.toContain("UNSPECIFIED");
    expect(html).not.toContain('type="radio"');
  });

  it("is a native required select carrying the field's id, where the refusal summary's link lands (§47)", () => {
    const tag = selectTag(render());
    expect(tag).toContain(`id="${fieldId("sex")}"`);
    expect(tag).toMatch(/\srequired(=""|\s|>)/);
    // Nothing a reader without JavaScript cannot reach: no hidden input, no overlay button yet.
    const html = render();
    expect(html).not.toContain('type="hidden"');
    expect(html).not.toContain("aria-haspopup");
    expect(tag).not.toContain("aria-hidden");
    expect(tag).not.toContain("tabindex");
  });

  it("keeps a refused submission's answer (§142), and ignores anything that is not one — the retired answer included", () => {
    expect(options(render("FEMALE")).filter((option) => option.selected).map((option) => option.value)).toEqual(["FEMALE"]);
    expect(options(render("MALE")).filter((option) => option.selected).map((option) => option.value)).toEqual(["MALE"]);
    for (const stray of ["", "OTHER", "UNSPECIFIED", undefined]) {
      expect(options(render(stray)).filter((option) => option.selected).map((option) => option.value)).toEqual([""]);
    }
  });

  it("wears the chosen answer's glyph in the closed field, and none while unanswered", () => {
    expect(render("FEMALE")).toContain('data-testid="FemaleIcon"');
    expect(render("FEMALE")).not.toContain('data-testid="MaleIcon"');
    expect(render("MALE")).toContain('data-testid="MaleIcon"');
    expect(render()).not.toMatch(/data-testid="(Female|Male)Icon"/);
    // Decoration: the word is the answer's name.
    expect(render("FEMALE")).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="FemaleIcon"|<svg[^>]*data-testid="FemaleIcon"[^>]*aria-hidden="true"/);
  });

  it("marks a refusal on the select — aria-invalid, and the helper under it in the error's colour", () => {
    expect(selectTag(render(undefined, true))).toContain('aria-invalid="true"');
    expect(selectTag(render())).toContain('aria-invalid="false"');
    expect(render(undefined, true)).toMatch(/<p[^>]*class="[^"]*Mui-error[^"]*"[^>]*id="field-sex-helper-text"/);
    expect(selectTag(render())).toContain(`aria-describedby="${fieldId("sex")}-helper-text"`);
    expect(render()).not.toMatch(/class="[^"]*Mui-error/);
  });

  it("is refused by the domain rule at every door, and a missing answer on the public form", () => {
    expect(registrationSubmissionSchema.shape.sex.safeParse("UNSPECIFIED").success).toBe(false);
    expect(registrationSubmissionSchema.shape.sex.safeParse(undefined).success).toBe(false);
    expect(registrationSubmissionSchema.shape.sex.safeParse("").success).toBe(false);
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

  it("has the placeholder and the two words in both catalogues, and no word left for the retired answer", () => {
    expect(ro.Registration.sexOptions).toEqual({ FEMALE: "Feminin", MALE: "Masculin" });
    expect(en.Registration.sexOptions).toEqual({ FEMALE: "Female", MALE: "Male" });
    expect(ro.Registration.sexChoose).toBe("Alege…");
    expect(en.Registration.sexChoose).toBe("Choose…");
    expect(ro.Admin.registrations.sexOptions).toEqual({ MALE: "Masculin", FEMALE: "Feminin" });
    expect(en.Admin.registrations.sexOptions).toEqual({ MALE: "Male", FEMALE: "Female" });
    for (const catalogue of [ro, en]) {
      expect(JSON.stringify(catalogue)).not.toContain("UNSPECIFIED");
      expect("sexMissing" in catalogue.Registration).toBe(false);
    }
  });

  it("is what the form draws, Feminin first, and the §47 summary and the §422 list name it «Sex» like any field", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/register/page.tsx"), "utf8");
    expect(page).toContain("<SexField");
    expect(page).toContain('placeholder={t("sexChoose")}');
    expect(page).toMatch(/answers=\{\{ FEMALE: t\("sexOptions\.FEMALE"\), MALE: t\("sexOptions\.MALE"\) \}\}/);
    expect(page).not.toContain("sexMissing");
    expect(page).not.toContain("UNSPECIFIED");
  });

  it("is a client island over the native select, its list drawing each answer's glyph in the form's order", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/registrations/ui/SexField.tsx"), "utf8");
    expect(source.startsWith('"use client";')).toBe(true);
    expect(source).toContain("select: { native: true }");
    // A choice goes through the select the form posts, with a real change event (§463).
    expect(source).toContain("chooseInSelect(selectRef.current, answer)");
    expect(source).toMatch(/SEX_CHOICES\.map\(\(answer\) => \{\s*const Option = SEX_GLYPHS\[answer\]/);
  });
});
