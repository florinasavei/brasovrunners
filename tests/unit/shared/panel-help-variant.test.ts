import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";

/**
 * §398 — the owner, on the event editor's «Ce înseamnă fiecare tip?»: "ar trebui să fie un card
 * mai mic". `Panel`'s `help` variant is a small clickable line instead of a boxed card: no
 * border, no elevation, no heading tag — a caret and a sentence, closed by default (§336). The
 * same variant, with `legendIcon="info"`, is the field legend on `/admin/emails` (§373's
 * follow-up), "a bit different from the other accordions and with an «i» button".
 */
const markup = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

function render(el: ReactElement): string {
  return markup(renderToStaticMarkup(el));
}

describe("§398 Panel's help variant", () => {
  it("is a plain <details>, closed by default, no card frame, no heading tag", () => {
    const html = render(
      createElement(Panel, { variant: "help", collapsible: true, title: "Ce înseamnă fiecare tip?" }, createElement("p", null, "words")),
    );
    expect(html.startsWith("<details")).toBe(true);
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen/);
    expect(html).not.toMatch(/<h2|<h3|<h4/);
    expect(html).toContain("Ce înseamnă fiecare tip?");
    expect(html).toContain("words");
  });

  it("opens when openWhen says so, like every other fold", () => {
    const html = render(createElement(Panel, { variant: "help", collapsible: true, title: "t", openWhen: { attention: true } }, "x"));
    expect(html.match(/<details[^>]*>/)?.[0]).toMatch(/\sopen/);
  });

  it("draws the caret (ExpandMore) with no icon at all by default", () => {
    const html = render(createElement(Panel, { variant: "help", collapsible: true, title: "t" }, "x"));
    expect(html).toMatch(/data-testid="ExpandMoreIcon"/);
    expect(html).not.toMatch(/data-testid="InfoOutlinedIcon"/);
  });

  it('leads with an "i" (InfoOutlined) when legendIcon="info"', () => {
    const html = render(createElement(Panel, { variant: "help", collapsible: true, legendIcon: "info", title: "t" }, "x"));
    expect(html).toMatch(/data-testid="InfoOutlinedIcon"/);
    // The "i" comes before the caret, which comes before the words.
    const iAt = html.indexOf("InfoOutlinedIcon");
    const caretAt = html.indexOf("ExpandMoreIcon");
    const wordsAt = html.indexOf(">t<");
    expect(iAt).toBeLessThan(caretAt);
    expect(caretAt).toBeLessThan(wordsAt);
  });

  it("shows the aside beside the title, on the closed line", () => {
    const html = render(createElement(Panel, { variant: "help", collapsible: true, title: "16 câmpuri", aside: "4 folosite aici" }, "x"));
    expect(html).toContain("16 câmpuri");
    expect(html).toContain("4 folosite aici");
    expect(html.indexOf("16 câmpuri")).toBeLessThan(html.indexOf("4 folosite aici"));
  });

  it("the caret turns with the native [open] state alone — no script", () => {
    // The CSS selector reads the details element's own `open` attribute; nothing here is
    // wired to React state, so it keeps working with JavaScript off. Read before the `<style>`
    // tags are stripped — that is where Emotion wrote the rule.
    const raw = renderToStaticMarkup(createElement(Panel, { variant: "help", collapsible: true, title: "t" }, "x"));
    expect(raw).toMatch(/\[open\]\s*>\s*summary/);
  });
});
