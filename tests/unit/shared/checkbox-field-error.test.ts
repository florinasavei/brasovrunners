import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CheckboxField from "@/shared/ui/CheckboxField";

/**
 * §NNN — `CheckboxField`'s `error`: a refused, unticked box says so under itself.
 *
 * The golden file is the markup the component printed before `error` existed (captured from the
 * previous revision), so "every other caller byte-for-byte" is checked against what it was, not
 * against itself.
 */
type BoxProps = Omit<ComponentProps<typeof CheckboxField>, "children">;
// Children go as the third argument (react/no-children-prop); the props type still lists them as required.
const box = (props: BoxProps) => createElement(CheckboxField, props as ComponentProps<typeof CheckboxField>, "Words");
const golden = JSON.parse(readFileSync("tests/unit/shared/checkbox-field-markup.golden.json", "utf8")) as { dense: string; help: string };

describe("CheckboxField without an error", () => {
  it("prints exactly the markup it printed before", () => {
    expect(renderToStaticMarkup(box({ name: "accepted", id: "accepted", required: true, dense: true }))).toBe(golden.dense);
    expect(renderToStaticMarkup(box({ name: "x", help: "Help" }))).toBe(golden.help);
  });

  it("prints the same with a requiredMessage that has not been triggered: the browser says it, the server did not", () => {
    expect(
      renderToStaticMarkup(box({ name: "accepted", id: "accepted", required: true, dense: true, requiredMessage: "Bifează" })),
    ).toBe(golden.dense);
  });
});

describe("CheckboxField with an error", () => {
  const html = renderToStaticMarkup(box({ name: "accepted", id: "accepted", required: true, dense: true, error: "Bifează această casetă." }));

  it("draws the helper text in the error colour under the box", () => {
    expect(html).toMatch(/<p class="[^"]*MuiFormHelperText-root[^"]*Mui-error[^"]*" id="[^"]+"[^>]*>Bifează această casetă\.<\/p>/);
  });

  it("marks the input invalid and names the helper text", () => {
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain('aria-invalid="true"');
    const id = /<p[^>]*id="([^"]+)"[^>]*data-testid="checkbox-error"|<p[^>]*data-testid="checkbox-error"[^>]*id="([^"]+)"/.exec(html);
    const helperId = id?.[1] ?? id?.[2];
    expect(helperId).toBeTruthy();
    expect(input).toContain(`aria-describedby="${helperId}"`);
  });

  it("lists the box's own help as well as the error when it has both", () => {
    const both = renderToStaticMarkup(box({ name: "x", help: "Help", error: "Nope" }));
    const describedBy = /aria-describedby="([^"]+)"/.exec(both)![1].split(" ");
    expect(describedBy).toHaveLength(2);
    for (const id of describedBy) expect(both).toContain(`id="${id}"`);
    expect(both).toContain("Help");
    expect(both).toContain("Nope");
  });
});
