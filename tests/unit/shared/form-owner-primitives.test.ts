import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetachedFields } from "@/shared/forms/DetachedActionFormIsland";
import RecallField, { NeverKeptField, RecallCheckbox, RecallHidden, RecallRadio } from "@/shared/forms/recall";

/**
 * §763 (BR-REQ-050-02) — the house primitives write `form=` on their own control when they are
 * drawn under `DetachedFields`, and only then: «Puncte pe traseu» inside «Traseul» posts with a
 * form of its own through that attribute (`form-owner.tsx`). The card itself uses some of these;
 * the rest are what another detached card would reach for, and nothing else pins them.
 */
const FORM = "detached-test-form";

function controlsOf(markup: string): string[] {
  return [...markup.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((match) => match[0]);
}

const primitives = () => [
  createElement(RecallField, { key: "a", name: "recall.field", label: "A" }),
  createElement(NeverKeptField, { key: "b", name: "never.kept", label: "B" }),
  createElement(RecallHidden, { key: "c", name: "recall.hidden", value: "1" }),
  createElement(RecallCheckbox, { key: "d", name: "recall.checkbox" }),
  createElement(RecallRadio, { key: "e", name: "recall.radio", value: "x" }),
];

describe("§763 the primitives name the detached form", () => {
  it("every named control carries form=<id> under DetachedFields", () => {
    const markup = renderToStaticMarkup(createElement(DetachedFields as ComponentType<{ form: string }>, { form: FORM }, ...primitives()));
    const named = controlsOf(markup).filter((tag) => /\sname="/.test(tag));
    expect(named.map((tag) => /name="([^"]*)"/.exec(tag)?.[1])).toEqual(["recall.field", "never.kept", "recall.hidden", "recall.checkbox", "recall.radio"]);
    for (const tag of named) expect(tag, tag).toContain(`form="${FORM}"`);
  });

  it("writes no form attribute outside it: a box of the save form posts with the form around it", () => {
    const markup = renderToStaticMarkup(createElement("div", null, ...primitives()));
    for (const tag of controlsOf(markup)) expect(tag, tag).not.toMatch(/\sform="/);
  });
});
