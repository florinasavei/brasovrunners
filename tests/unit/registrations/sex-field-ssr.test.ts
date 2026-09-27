import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import SexField from "@/modules/registrations/ui/SexField";
import { fieldId } from "@/shared/forms/outcome";

/**
 * §510 — «Sex» on the public registration form starts unanswered and still answers without
 * JavaScript: a native, required `<select name="sex">` in the server's HTML, whose first option is
 * the empty, disabled «Alege…», chosen while there is no draft. A MUI listbox select would post
 * through a hidden input only JavaScript fills, and a required one would lock a reader without
 * JavaScript out of the whole form.
 */
const answers = { FEMALE: "Feminin", MALE: "Masculin", UNSPECIFIED: "Prefer să nu spun" } as const;

function render(defaultValue?: string) {
  return renderToStaticMarkup(
    createElement(SexField, { id: fieldId("sex"), name: "sex", label: "Sex", placeholder: "Alege…", answers, defaultValue }),
  );
}

/** Each `<option …>` tag with its value and whether it is selected. */
function options(html: string) {
  return [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attributes, text]) => ({
    value: /value="([^"]*)"/.exec(attributes)?.[1],
    selected: /\sselected(=""|\s|$)/.test(attributes),
    disabled: /\sdisabled(=""|\s|$)/.test(attributes),
    text,
  }));
}

describe("§510 «Sex» as the server renders it", () => {
  it("is a native, required select with the placeholder first and chosen, and no answer selected", () => {
    const html = render();
    const tag = html.match(/<select[^>]*name="sex"[^>]*>/)?.[0];
    expect(tag, 'a native <select name="sex">').toBeDefined();
    expect(tag).toContain(`id="${fieldId("sex")}"`);
    expect(tag).toContain("required");
    // Nothing a reader without JavaScript cannot reach: no hidden input carries the answer.
    expect(html).not.toContain('type="hidden"');

    const list = options(html);
    expect(list.map((option) => option.value)).toEqual(["", "FEMALE", "MALE", "UNSPECIFIED"]);
    expect(list[0]).toMatchObject({ text: "Alege…", disabled: true, selected: true });
    expect(list.slice(1).some((option) => option.selected)).toBe(false);
    expect(list.slice(1).map((option) => option.text)).toEqual(["Feminin", "Masculin", "Prefer să nu spun"]);
  });

  it("keeps a refused submission's answer (§142), and ignores anything that is not one", () => {
    expect(options(render("FEMALE")).filter((option) => option.selected).map((option) => option.value)).toEqual(["FEMALE"]);
    for (const stray of ["", "OTHER", undefined]) {
      expect(options(render(stray)).filter((option) => option.selected).map((option) => option.value)).toEqual([""]);
    }
  });

  it("has the placeholder and the summary's sentence in both catalogues", () => {
    expect(ro.Registration.sexChoose).toBe("Alege…");
    expect(en.Registration.sexChoose).toBe("Choose…");
    expect(ro.Registration.sexMissing).toBe("Alege sexul — poți alege „Prefer să nu spun”");
    expect(en.Registration.sexMissing).toBeTruthy();
  });

  it("is what the form draws, and the §47 summary and the §422 list name it by that sentence", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/register/page.tsx"), "utf8");
    expect(page).toContain("<SexField");
    expect(page).toContain('name === "sex" ? t("sexMissing")');
    expect(page).toContain('sex: t("sexMissing")');
  });
});
