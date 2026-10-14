import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TickButton from "@/shared/ui/TickButton";

/**
 * §766 (after §752 and §765) — `TickButton`, the house's one-press tick: a plain submit drawn as the checkbox,
 * its words beside it. The owner, 2026-10-14: «nu mai folosi niciodată» a button that flips a setting.
 */
const render = (checked: boolean, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement("form", null, createElement(TickButton, { checked, ...extra }, "Verificarea anti-bot pornită")));

describe("§766 TickButton", () => {
  it("is a submit with the checkbox role, its words as the accessible name, and the state in aria-checked and the glyph", () => {
    const ticked = render(true);
    expect(ticked).toContain('type="submit"');
    expect(ticked).toContain('role="checkbox"');
    expect(ticked).toContain('aria-checked="true"');
    expect(ticked).toContain('data-testid="CheckBoxIcon"');
    expect(ticked).toContain("Verificarea anti-bot pornită</button>");
    // The glyph is decoration: the name is the words alone.
    expect(ticked).toMatch(/<svg[^>]*aria-hidden="true"/);

    const empty = render(false);
    expect(empty).toContain('aria-checked="false"');
    expect(empty).toContain('data-testid="CheckBoxOutlineBlankIcon"');
    expect(empty).not.toContain('data-testid="CheckBoxIcon"');
    // The state is never the colour alone: the glyph and aria-checked differ, whatever the colour does.
    expect(empty).toContain("Verificarea anti-bot pornită</button>");
  });

  it("is a thumb's size, works as a plain submit, and takes the form's own attributes through", () => {
    const html = render(true, { "aria-describedby": "state-sentence", "data-testid": "the-tick" });
    expect(html).toContain('aria-describedby="state-sentence"');
    expect(html).toContain('data-testid="the-tick"');
    // No handler: a press is the form's submit, so scripts off still works.
    expect(html).not.toContain("onclick");
    expect(/<button[^>]*\sdisabled[\s=>]/.test(html)).toBe(false);
    // 44 pixels tall, the glyph 24 (the volunteers card's and the to-do list's row).
    expect(html).toContain("min-height:44px");
    expect(html).toMatch(/font-size:24px/);
  });

  it("draws no toggle glyph in either state", () => {
    for (const checked of [true, false]) {
      const html = render(checked);
      expect(html).not.toContain("ToggleOnIcon");
      expect(html).not.toContain("ToggleOffIcon");
    }
  });
});
