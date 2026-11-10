import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tickAnswer } from "@/shared/feedback/notice";
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
    // A press let through unasked sends the person's email (slice 4): `unasked` sets every «Trimite emailul» back to `on`.
    expect(source).toMatch(/if \(!spec\) return unasked\(\);[\s\S]*?event\.preventDefault\(\);/);
    // A body that counts the ticks (§532): with none ticked nothing is asked, and the server refuses.
    expect(source).toMatch(/const ticked = resolveBodyCount\(spec, valuesOf\);\s*if \(!ticked\) return unasked\(\);/);
    // A body naming the fields the press changes (§645): none moved, the press goes through unasked.
    expect(source).toMatch(/const named = resolveChangedFields\(ticked, [\s\S]*?\}\);\s*if \(!named\) return unasked\(\);/);
    // The event editor's place settings (§914): each change and what it does; none changed, a dialog only for them asks nothing.
    expect(source).toMatch(/const placed = resolvePlaceChanges\(named, valueOf\);\s*if \(!placed\) return unasked\(\);\s*event\.preventDefault\(\);/);
    // A series save's email line is summed over the dates ticked at this press, then asked (§384).
    expect(source).toMatch(/const counted = resolveEmailCount\(placed, valuesOf\);/);
    // The quieter lines true of this press alone (the design «telling the owner about every email a staff press sends», slice 3):
    // the offers a raised capacity sends, the window's re-sent links — then a typed value named in the sentences, the email line's
    // person included, is filled from the form at the press (§511), and asked.
    expect(source).toMatch(/const said = resolveAlso\(counted, valueOf\);/);
    expect(source).toMatch(/const resolved = fillFromForm\(said, valueOf, chosenOf\);\s*setAsking\(\{ spec: resolved, submitter \}\);/);
    // …and a list's chosen line in its own words («La retrimitere»): read from the `<select>` itself, never from the posted value.
    expect(source).toMatch(/const chosenOf = \(field: string\) => \{\s*const list = element\.elements\.namedItem\(field\);\s*return list instanceof HTMLSelectElement \? \(list\.selectedOptions\[0\]\?\.textContent \?\? null\) : null;/);
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
    expect(source).toMatch(/\{asking && \(\s*<ConfirmDialog\s+spec=\{asking\.spec\}\s+open\s+onCancel=\{cancelAsking\}\s+onConfirm=\{\(given\) => answer\("confirm", given\)\}/);
    // «Anulează» closes the question and tells the form, so a control that changed first shows the stored state (§647).
    expect(source).toMatch(/const cancelAsking = \(\) => \{\s*setAsking\(null\);\s*form\.current\?\.dispatchEvent\(new Event\(CONFIRM_CANCEL_EVENT\)\);\s*\};/);
    expect(source).not.toContain("@mui/material/Dialog");
  });

  it("offers a two-way question's quiet answer beside the primary one, and sets the hidden field before sending (§540)", () => {
    expect(source).toMatch(/alternative=\{asking\.spec\.choice \? \{ label: asking\.spec\.choice\.alternativeLabel, onClick: \(given\) => answer\("alternative", given\) \} : null\}/);
    expect(source).toMatch(/const chosen = choiceAnswer\(pending\.spec, which\);/);
    expect(source).toMatch(/if \(chosen\) write\(chosen\.field, chosen\.value\);/);
    expect(source).toMatch(/const write = \(field: string, value: string\) => \{\s*const input = element\.elements\.namedItem\(field\);\s*if \(input instanceof HTMLInputElement\) input\.value = value;\s*\};/);
  });

  it("asks for a tick in the dialog and writes it into the form's hidden input on «yes» alone (§888)", () => {
    expect(source).toMatch(/const ticked = which === "confirm" \? tickAnswer\(pending\.spec\) : null;/);
    expect(source).toMatch(/if \(ticked\) write\(ticked\.field, ticked\.value\);/);
    const spec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x" };
    expect(tickAnswer({ ...spec, tick: { field: "relayedByParticipantRequest", label: "Confirm…" } })).toEqual({ field: "relayedByParticipantRequest", value: "on" });
    expect(tickAnswer(spec)).toBeNull();
    // The dialog answers only once the box is ticked: its button disabled, Enter ignored, until then.
    const dialog = readFileSync(path.join(ROOT, "src/shared/feedback/ConfirmDialog.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(dialog).toMatch(/const mayConfirm = !spec\.tick \|\| ticked;/);
    expect(dialog).toMatch(/if \(mayConfirm\) confirm\(\);/);
    expect(dialog).toMatch(/onClick=\{confirm\}\s*disabled=\{!mayConfirm\}/);
  });

  it("posts «Trimite emailul» `on` unless this press's question was answered with the box unticked (the design «telling the owner about every email a staff press sends», slice 4)", () => {
    // Drawn `on` — as posted without JavaScript, which asks nothing — one hidden input per field the form's questions offer.
    expect(source).toMatch(/const optOutFields = useMemo\(\(\) => emailOptOutFields\(confirm\), \[confirm\]\);/);
    expect(source).toMatch(/\{optOutFields\.map\(\(field\) => \(\s*<input key=\{field\} type="hidden" name=\{field\} defaultValue="on" \/>/);
    // Every answer resets them all to `on` first, then writes this question's box: a dialog without the box never sends an earlier untick.
    expect(source).toMatch(/for \(const field of optOutFields\) write\(field, "on"\);\s*const optedOut = emailOptOutAnswer\(pending\.spec, given\.emailOff\);\s*if \(optedOut\) write\(optedOut\.field, optedOut\.value\);/);
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
