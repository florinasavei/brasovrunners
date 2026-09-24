import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RunnerLoader, { RunnerLoaderStyles } from "@/shared/ui/RunnerLoader";
import SubmitButton from "@/shared/ui/SubmitButton";

/**
 * BR-REQ-041-01 (§NNN) — a save button's press adds no CSS to the page.
 *
 * MUI's styles here sit in cascade layers, and Chromium answers a layered rule added to a live
 * page by recomputing every element's style and every line's layout. The runner that takes a
 * pending button's glyph was two such rules, written inside the press — most of the owner's
 * "blocked UI updates for 352ms". The figure is now drawn with the page, hidden, with the props
 * the pending one takes, so its classes are in the server's HTML and the press reuses them.
 *
 * What is checked: the hidden figure carries exactly the classes the pending one renders with, for
 * each button size; every button that swaps in the runner draws the hidden one with the same
 * props; and the submit buttons mount no touch ripple (the ripple's own styles were the other rule
 * a page's first press wrote).
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** Every emotion class in a piece of markup, in order. */
const classesOf = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(" ")).filter((name) => /^(css|mui)-/.test(name));

/** The markup of the hidden figure inside a rendered button. */
function hiddenFigure(html: string): string {
  const start = html.indexOf("data-runner-styles");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

describe("BR-REQ-041-01 the pending runner's styles are drawn with the page (§NNN)", () => {
  it("draws the hidden figure with the very classes the pending figure takes", () => {
    for (const size of [18, 20, 22, 24]) {
      const pending = classesOf(renderToStaticMarkup(createElement(RunnerLoader, { size, color: "inherit" })));
      const hidden = classesOf(renderToStaticMarkup(createElement(RunnerLoaderStyles, { size, color: "inherit" })));
      expect(pending.length).toBeGreaterThan(0);
      expect(hidden).toEqual(pending);
    }
  });

  it("hides it inline — no class of its own, no room taken", () => {
    const html = renderToStaticMarkup(createElement(RunnerLoaderStyles, { size: 20, color: "inherit" }));
    expect(html).toMatch(/^<span style="display:none" data-runner-styles="">/);
  });

  it("is drawn at rest by the submit button, at the size its runner takes when pressed", () => {
    const sizes = { small: 18, medium: 20, large: 22 } as const;
    for (const [size, px] of Object.entries(sizes) as Array<[keyof typeof sizes, number]>) {
      const html = renderToStaticMarkup(createElement("form", null, createElement(SubmitButton, { label: "Salvează", pendingLabel: "Se salvează…", size })));
      const expected = classesOf(renderToStaticMarkup(createElement(RunnerLoader, { size: px, color: "inherit" })));
      expect(classesOf(hiddenFigure(html)).slice(0, expected.length)).toEqual(expected);
    }
  });

  it("gives every button that swaps in the runner the hidden one with the same props", () => {
    const submit = read("src/shared/ui/SubmitButton.tsx");
    expect(submit).toContain("<RunnerLoader size={GLYPH_PX[size]} color=\"inherit\" />");
    expect(submit).toContain("<RunnerLoaderStyles size={GLYPH_PX[size]} color=\"inherit\" />");
    const publish = read("src/modules/content/events/ui/CreateAndPublishButton.tsx");
    expect(publish).toContain("<RunnerLoader size={20} color=\"inherit\" />");
    expect(publish).toContain("<RunnerLoaderStyles size={20} color=\"inherit\" />");
    const step = read("src/modules/events/ui/CalendarStepLink.tsx");
    expect(step).toContain("<RunnerLoader size={24} color=\"inherit\" />");
    expect(step).toContain("<RunnerLoaderStyles size={24} color=\"inherit\" />");
  });

  it("mounts no touch ripple on the submit buttons — the keyboard's focus ripple stays", () => {
    for (const file of ["src/shared/ui/SubmitButton.tsx", "src/modules/content/events/ui/CreateAndPublishButton.tsx"]) {
      const source = read(file);
      expect(source).toMatch(/\n\s+disableTouchRipple\r?\n/);
      expect(source).not.toContain("disableRipple");
    }
  });
});
