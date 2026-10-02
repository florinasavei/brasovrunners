import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ActionForm from "@/shared/forms/ActionForm";
import { succeeded } from "@/shared/forms/outcome";

/**
 * `DECISIONS.md` §384 — `ActionForm` is where a form asks first and where "it worked" leaves for
 * the toast provider.
 *
 * The wiring, held down at the source: the `submit` event is the gate, `preventDefault()` on it
 * is what keeps React from running the action (`react-dom` checks `defaultPrevented` in its
 * form-action listener), the question is picked from the posted form with its submitter, and a
 * "yes" replays `requestSubmit()` with the same submitter. A returned `notice` reaches the
 * provider from an effect, after the answer painted — never inside the press (§371). The
 * browser side — the dialog opening, cancel leaving the row untouched, the toast after a save —
 * is `tests/e2e/toasts-and-confirms.spec.ts`.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = readFileSync(path.join(ROOT, "src/shared/forms/ActionFormIsland.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("§384 ActionForm asks first", () => {
  it("gates the submit event and stops the action with preventDefault when a question matches", () => {
    expect(source).toMatch(/<form ref=\{form\} action=\{formAction\}[^>]*onSubmit=\{onSubmit\}>/);
    expect(source).toMatch(/const spec = pickConfirm\(confirm, \(field\) => \{/);
    expect(source).toMatch(/if \(!spec\) return;[\s\S]*?event\.preventDefault\(\);/);
    // A body that counts the ticks (§532): with none ticked nothing is asked, and the server refuses.
    expect(source).toMatch(/const ticked = resolveBodyCount\(spec, valuesOf\);\s*if \(!ticked\) return;\s*event\.preventDefault\(\);/);
    // A series save's email line is summed over the dates ticked at this press, then asked (§384).
    expect(source).toMatch(/const counted = resolveEmailCount\(ticked, valuesOf\);/);
    // A typed value named in the sentence is filled from the form at the press (§511), then asked.
    expect(source).toMatch(/const resolved = fillFromForm\(counted, [\s\S]*?\}\);\s*setAsking\(\{ spec: resolved, submitter \}\);/);
  });

  it("reads the form with its submitter, so a two-verb form asks the right question", () => {
    expect(source).toMatch(/data = submitter \? new FormData\(element, submitter\) : new FormData\(element\);/);
  });

  it("replays the submit with the same submitter on yes, once, and asks again next time", () => {
    expect(source).toMatch(/confirmed\.current = true;/);
    expect(source).toMatch(/if \(ownButton\) element\.requestSubmit\(button\);\s*else element\.requestSubmit\(\);/);
    expect(source).toMatch(/if \(confirmed\.current\) \{\s*confirmed\.current = false;\s*return;\s*\}/);
  });

  it("draws the one ConfirmDialog only while a question is asked", () => {
    expect(source).toMatch(/\{asking && \(\s*<ConfirmDialog\s+spec=\{asking\.spec\}\s+open\s+onCancel=\{cancelAsking\}\s+onConfirm=\{\(\) => answer\("confirm"\)\}/);
    // «Anulează» closes the question and tells the form, so a control that changed first shows the stored state (§NNN).
    expect(source).toMatch(/const cancelAsking = \(\) => \{\s*setAsking\(null\);\s*form\.current\?\.dispatchEvent\(new Event\(CONFIRM_CANCEL_EVENT\)\);\s*\};/);
    expect(source).not.toContain("@mui/material/Dialog");
  });

  it("offers a two-way question's quiet answer beside the primary one, and sets the hidden field before sending (§540)", () => {
    expect(source).toMatch(/alternative=\{asking\.spec\.choice \? \{ label: asking\.spec\.choice\.alternativeLabel, onClick: \(\) => answer\("alternative"\) \} : null\}/);
    expect(source).toMatch(/const chosen = choiceAnswer\(pending\.spec, which\);/);
    expect(source).toMatch(/if \(input instanceof HTMLInputElement\) input\.value = chosen\.value;/);
  });

  it("hands a returned notice to the toast provider from an effect, and never a refusal", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(state\?\.notice\) toast\.show\(state\.notice\);\s*\}, \[state, toast\]\);/);
    expect(source).not.toMatch(/toast\.show\(\{[^}]*error/);
    expect(succeeded({ kind: "success", key: "event" })).toEqual({ notice: { kind: "success", key: "event" }, fields: [], values: {} });
  });

  it("renders as a plain form on the server — hidden when asked — with no dialog and no summary", () => {
    const action = async () => null;
    const html = renderToStaticMarkup(
      createElement(
        ActionForm,
        // The children go in as `createElement`'s third argument, which the props type cannot see
        // (`pickers-js-off.test.ts`'s own workaround for the same shape).
        {
          action,
          id: "delete-1",
          hidden: true,
          confirm: { title: "Ștergi?", body: "Definitiv.", confirmLabel: "Șterge", cancelLabel: "Renunță", destructive: true },
        } as unknown as ComponentProps<typeof ActionForm>,
        createElement("input", { type: "hidden", name: "eventId", value: "1" }),
      ),
    );
    expect(html).toMatch(/^<form id="delete-1" hidden=""[^>]*>/);
    expect(html).toContain('name="eventId"');
    expect(html).not.toContain("Ștergi?");
    expect(html).not.toContain("form-refusal");
  });
});
