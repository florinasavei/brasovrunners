import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecallProvider } from "@/shared/forms/recall";
import RadioField from "@/shared/ui/RadioField";

/**
 * §776 — `RadioField` after a refused submit: the choice comes back as it was posted (§315, the checkbox's
 * own rule). The badge's designer needs it: «Altă dimensiune» refused for being too small came back on the
 * saved size, the boxes typed for it hidden behind a choice nobody made.
 */
const group = (props: { posted?: Record<string, string[]> | null; saved: string; disabled?: string }): string => {
  const radio = (value: string): ReactNode =>
    // Children go as the third argument (react/no-children-prop); the props type still lists them as required.
    createElement(RadioField, { key: value, name: "size", value, defaultChecked: props.saved === value, disabled: props.disabled === value } as unknown as ComponentProps<typeof RadioField>, value);
  const recall =
    props.posted === undefined || props.posted === null
      ? null
      : { values: props.posted, fields: [], generation: 1, fieldError: "" };
  const radios = ["strip90", "strip100", "custom"].map(radio);
  return renderToStaticMarkup(recall ? createElement(RecallProvider, { value: recall } as unknown as ComponentProps<typeof RecallProvider>, radios) : createElement("div", null, radios));
};

/** The values of the radios drawn checked. */
const checkedIn = (html: string): string[] => [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]).filter((input) => /\schecked(=|\s|\/|>)/.test(input)).map((input) => /value="([^"]+)"/.exec(input)![1]);

describe("RadioField", () => {
  it("draws the page's choice when no submit was refused", () => {
    expect(checkedIn(group({ saved: "strip90" }))).toEqual(["strip90"]);
  });

  it("draws the choice that was posted, not the saved one, after a refusal", () => {
    expect(checkedIn(group({ saved: "strip90", posted: { size: ["custom"] } }))).toEqual(["custom"]);
  });

  it("keeps the page's choice when the refused form posted nothing for the group", () => {
    expect(checkedIn(group({ saved: "strip100", posted: { other: ["x"] } }))).toEqual(["strip100"]);
  });

  it("keeps a disabled radio on the page's word, since the browser posts nothing for it", () => {
    expect(checkedIn(group({ saved: "strip90", disabled: "strip90", posted: { size: ["custom"] } }))).toContain("strip90");
  });
});
