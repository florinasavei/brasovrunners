import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DifficultyRow, { DIFFICULTY_ROW_SX } from "@/modules/content/events/ui/DifficultyRow";
import DifficultyStepField, { STEP_FRAME } from "@/modules/content/events/ui/DifficultyStepField";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §537 — «Dificultate» and «Treapta» on one centred axis (the owner, 2026-09-28:
 * «partea asta nu e centrată!»). `KindBox` renders the row on the create page and in the editor
 * alike (§406), so the row itself is what is pinned here.
 */
const words = (catalogue: typeof ro) => ({
  label: catalogue.Admin.editor.fields.difficultyStep,
  help: catalogue.Admin.editor.difficultyStepHelp,
  scale: Object.values(catalogue.Admin.editor.difficultyScale).join("\n"),
  choices: catalogue.Admin.editor.difficultySteps,
});

const render = (catalogue: typeof ro) =>
  renderToStaticMarkup(
    createElement(DifficultyRow, {
      band: createElement("span", { "data-testid": "band-slot" }, "band"),
      step: createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, words: words(catalogue) }),
    }),
  );

describe("§537 the difficulty row is centred", () => {
  it("is one grid, both outlines from the cells' top edge, stacked below sm in the same order", () => {
    expect(DIFFICULTY_ROW_SX.display).toBe("grid");
    // Top-aligned: the two 56-px outlines start at the cell's top, so their centres meet and the
    // select's helper text after a refused save cannot move the toggle.
    expect(DIFFICULTY_ROW_SX.alignItems).toBe("start");
    // The step column is the toggle's own width; the band takes the rest.
    expect(DIFFICULTY_ROW_SX.gridTemplateColumns.sm).toBe("minmax(0, 1fr) max-content");
    // From sm: the band beside the step, the help line in a row of its own under the step.
    expect(DIFFICULTY_ROW_SX.gridTemplateAreas.sm).toBe('"band step" ". help"');
    // Below sm: band, step, help — each full width.
    expect(DIFFICULTY_ROW_SX.gridTemplateAreas.xs).toBe('"band" "step" "help"');
    expect(DIFFICULTY_ROW_SX.gridTemplateColumns.xs).toBe("minmax(0, 1fr)");

    const html = render(ro);
    expect(html).toContain("align-items:start");
    expect(html).toContain("grid-template-areas");
    // The help line wraps inside the toggle's width rather than widening the column.
    expect(html).toMatch(/width:0;min-width:100%/);
  });

  it("puts the toggle and its «?» in the step cell and the help line in the help cell", () => {
    const html = render(ro);
    // The step field's root drops out of the layout, so its parts are the grid's cells.
    expect(html).toMatch(/display:contents/);
    expect(html).toMatch(/grid-area:step/);
    expect(html).toMatch(/grid-area:help/);
    expect(html).toMatch(/grid-area:band/);
    const control = html.indexOf('data-testid="difficulty-step-control"');
    const question = html.indexOf('data-testid="difficulty-scale-help"');
    const help = html.indexOf(ro.Admin.editor.difficultyStepHelp);
    // The «?» beside the toggle, before the help line — which never shares the toggle's cell.
    expect(control).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(control);
    expect(help).toBeGreaterThan(question);
  });

  it("draws the label in the outline's edge, as the select's, so the two outlines are the same 56 px", () => {
    const html = render(ro);
    expect(html).toContain("<fieldset");
    expect(html).toMatch(new RegExp(`<legend[^>]*id="[^"]+-label"[^>]*>${ro.Admin.editor.fields.difficultyStep}</legend>`));
    // The visible outline: the fieldset less the half-legend above its edge, which the margin takes back.
    expect(STEP_FRAME.height + STEP_FRAME.marginTop).toBe(56);
    expect(STEP_FRAME.legendLine / 2).toBe(-STEP_FRAME.marginTop);
    // Each segment still a 44-px target (BR-REQ-041-01 criterion 6).
    expect(STEP_FRAME.segmentHeight).toBeGreaterThanOrEqual(44);
    expect(html).toContain("min-width:56px");
  });

  it("keeps the radio group's name and description, in both languages", () => {
    for (const catalogue of [ro, en] as const) {
      const html = render(catalogue as typeof ro);
      expect(html).toMatch(/<fieldset[^>]*role="radiogroup"/);
      const labelledBy = /role="radiogroup" aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(html).toContain(`<legend class="`);
      expect(html).toContain(`id="${labelledBy}"`);
      const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`<span id="${describedBy}">${catalogue.Admin.editor.difficultyStepHelp}</span>`);
      expect(html.match(/type="radio"/g)).toHaveLength(3);
    }
  });
});
