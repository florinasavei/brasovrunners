import { describe, expect, it } from "vitest";
import { isRefused, labelOf, missingControls, sameEntries, type WatchedControl } from "@/shared/ui/missing-controls";

/**
 * §NNN — the list of what is still missing above the registration form's send button
 * (BR-REQ-041-01; the refusal summary's short names, §47). The naming rules, without a browser:
 * a control is a plain object with the members the watcher reads.
 */
function control({
  name,
  id = "",
  label,
  ariaLabel,
  language,
  valid = false,
  willValidate = true,
}: {
  name?: string;
  id?: string;
  label?: string;
  ariaLabel?: string;
  language?: string;
  valid?: boolean;
  willValidate?: boolean;
}): WatchedControl {
  const attributes: Record<string, string | undefined> = { name, "aria-label": ariaLabel };
  return {
    id,
    willValidate,
    validity: { valid } as ValidityState,
    labels: label === undefined ? [] : [{ textContent: label }],
    getAttribute: (attribute: string) => attributes[attribute] ?? null,
    closest: ((selector: string) =>
      selector === "[data-language]" && language
        ? ({ getAttribute: (attribute: string) => (attribute === "data-language" ? language : null) } as unknown as Element)
        : null) as Element["closest"],
  };
}

describe("§NNN what is still missing, named", () => {
  it("strips MUI's trailing asterisk from a label", () => {
    expect(labelOf(control({ label: "Prenume *" }))).toBe("Prenume");
    expect(labelOf(control({ label: "Prenume *" }))).toBe("Prenume");
    expect(labelOf(control({ label: "Nume de familie" }))).toBe("Nume de familie");
  });

  it("falls back to aria-label, and says the language inside a language tab", () => {
    expect(labelOf(control({ ariaLabel: "Am citit condițiile" }))).toBe("Am citit condițiile");
    expect(labelOf(control({ label: "Titlu *", language: "EN" }))).toBe("EN: Titlu");
    expect(labelOf(control({}))).toBeNull();
  });

  it("prefers the caller's short name over the label", () => {
    const entries = missingControls(
      [control({ name: "rulesAcknowledged", id: "f-rules", label: "Am citit și sunt de acord cu condițiile concursului *" })],
      { rulesAcknowledged: "Condițiile concursului" },
    );
    expect(entries).toEqual([{ key: "rulesAcknowledged", label: "Condițiile concursului", id: "f-rules" }]);
  });

  it("lists one entry per posted name: a phone's digits and its country are one question", () => {
    const entries = missingControls(
      [
        control({ name: "phone", id: "f-phone", label: "Telefon *" }),
        control({ name: "phone", id: "f-phone-country", label: "Țara" }),
        control({ name: "firstName", id: "f-firstName", label: "Prenume *" }),
      ],
      {},
    );
    expect(entries.map((entry) => entry.key)).toEqual(["phone", "firstName"]);
    expect(entries[0]).toEqual({ key: "phone", label: "Telefon", id: "f-phone" });
  });

  it("skips a control that will not validate (a disabled fieldset) and a valid one", () => {
    const hidden = control({ name: "guardianName", id: "f-guardian", label: "Părinte *", willValidate: false });
    const filled = control({ name: "lastName", id: "f-lastName", label: "Nume *", valid: true });
    expect(isRefused(hidden)).toBe(false);
    expect(isRefused(filled)).toBe(false);
    expect(isRefused(control({ name: "x" }))).toBe(true);
    expect(missingControls([hidden, filled], {})).toEqual([]);
  });

  it("skips a control with nothing to call it, and one with no validity at all", () => {
    const fieldset = { ...control({ name: "group" }), validity: undefined };
    expect(missingControls([control({ id: "f-anon" }), fieldset], {})).toEqual([]);
  });

  it("keys a nameless control by its id, and gives no id when it has none", () => {
    expect(missingControls([control({ id: "f-x", label: "X" }), control({ label: "Y" })], {})).toEqual([
      { key: "f-x", label: "X", id: "f-x" },
      { key: "Y", label: "Y", id: null },
    ]);
  });

  it("compares lists by value, so the same list is not a render", () => {
    const a = [{ key: "a", label: "A", id: "f-a" }];
    expect(sameEntries(a, [{ key: "a", label: "A", id: "f-a" }])).toBe(true);
    expect(sameEntries(a, [{ key: "a", label: "B", id: "f-a" }])).toBe(false);
    expect(sameEntries(a, [])).toBe(false);
  });
});
