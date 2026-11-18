import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import ConfirmDialog, { ConfirmDialogActions } from "@/shared/feedback/ConfirmDialog";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ToastProvider from "@/shared/feedback/ToastProvider";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";

/**
 * `DECISIONS.md` §384 — the one confirmation dialog and the one toast provider, as the source
 * writes them and as the server renders them.
 *
 * Source-level for the rules a Node render cannot exercise (MUI's `Dialog` is a portal, which
 * renders nothing on the server): the safe button takes the focus, Enter goes through
 * `confirmOnKey`, Escape and the backdrop cancel through MUI's `onClose`, and a destructive
 * question wears the error colour. The keyboard itself is walked in the browser by
 * `tests/e2e/toasts-and-confirms.spec.ts`.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("§384 ConfirmDialog", () => {
  const source = read("src/shared/feedback/ConfirmDialog.tsx");

  it("focuses the safe button on open, so a stray Space — or Enter in a destructive dialog — cancels", () => {
    expect(source).toMatch(/<Button onClick=\{onCancel\} autoFocus/);
    expect(source).not.toMatch(/onClick=\{onConfirm\}[^>]*autoFocus/);
  });

  it("lets Enter confirm only a dialog that is not destructive, and stops the focused cancel from taking the key", () => {
    // A question with the email's two answers (§976) is answered by neither: Enter reaches the focused «Renunță».
    expect(source).toMatch(/if \(confirmOnKey\(event\.key, spec\.destructive, emailChoice\) !== "confirm"\) return;/);
    expect(source).toContain("const emailChoice = spec.emailOptOut !== undefined;");
    // `confirm` is `onConfirm` with the email's road written first (§841), so Enter and the button agree.
    // A dialog that asks for a tick (§888) answers Enter only once it is ticked, as its button does.
    expect(source).toMatch(/event\.preventDefault\(\);\s*if \(mayConfirm\) confirm\(\);/);
    expect(source).toContain("const confirm = withRoad(onConfirm);");
  });

  it("swallows a held Enter's repeats, so the press that opened the dialog neither confirms nor cancels it", () => {
    expect(source).toMatch(/if \(event\.repeat\) \{\s*if \(event\.key === "Enter"\) event\.preventDefault\(\);\s*return;\s*\}\s*if \(confirmOnKey/);
  });

  it("cancels on Escape and on the backdrop — MUI's onClose is the cancel", () => {
    expect(source).toMatch(/<Dialog\s+open=\{open\}\s+onClose=\{onCancel\}/);
  });

  it("colours a destructive question red and names the email it will queue on a line of its own", () => {
    expect(source).toContain('color={spec.destructive ? "error" : "primary"}');
    expect(source).toMatch(/\{spec\.email && \([\s\S]*?data-testid="confirm-email"/);
  });

  it("says what else the press sends after the road, quieter, each line as the builder worded it (the design «telling the owner about every email a staff press sends», slice 3)", () => {
    expect(source).toMatch(/\{spec\.also\?\.map\(\(line, index\) => \([\s\S]*?key=\{`\$\{index\}:\$\{line\.text\}`\}[\s\S]*?variant="body2"[\s\S]*?data-testid="confirm-also"/);
    // After the road's block, so the road speaks of the bold email line above it.
    expect(source.indexOf('data-testid="confirm-also"')).toBeGreaterThan(source.indexOf('data-testid="confirm-road-why"'));
  });

  it("lets a several-verb form's button take the builder's words whole, counted and filtered at the press", () => {
    const button = read("src/shared/ui/ConfirmSubmitButton.tsx");
    expect(button).toContain('const spec: ConfirmSpec = { title, body, confirmLabel, cancelLabel, ...mail, destructive: color === "error" };');
    expect(button).toMatch(/const counted = resolveEmailCount\(spec, valuesOf\);\s*setOpen\(resolveAlso\(counted, /);
  });

  it("renders no dialog on the server (a portal), so a hidden row form costs no dialog markup", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        spec: { title: "Ștergi?", body: "Definitiv.", confirmLabel: "Șterge", cancelLabel: "Renunță", destructive: true },
        open: true,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    // MUI writes its styles; the dialog itself waits for the browser.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Ștergi?");
    expect(renderToStaticMarkup(createElement(ConfirmDialog, { spec: null, open: false, onCancel: () => undefined, onConfirm: () => undefined }))).toBe("");
  });
});

/**
 * §976 — a question that may send the person their email ends in two answers that each say whether it leaves (the owner,
 * 2026-11-18: «vreau mereu sa confirm daca trimit un mail»), amending slice 4's box ticked in advance. The row of answers
 * is drawn apart from the portal (`ConfirmDialogActions`), so the server renders it here as the browser draws it.
 */
describe("§976 the email's two answers", () => {
  const source = read("src/shared/feedback/ConfirmDialog.tsx");
  const noop = () => undefined;
  const draw = (spec: ConfirmSpec, mayConfirm = true, alternative: { label: string; onClick: () => void } | null = null) =>
    renderToStaticMarkup(createElement(ConfirmDialogActions, { spec, mayConfirm, onCancel: noop, confirm: noop, confirmWithoutEmail: noop, alternative }));
  /** Each `<button …>…</button>` of the row, by its test id. */
  const buttons = (html: string) =>
    Object.fromEntries([...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => [/data-testid="([^"]+)"/.exec(match[1])?.[1] ?? "", { attributes: match[1], text: match[2].replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "") }]));
  const words = (catalogue: typeof ro | typeof en, many = false) => ({
    field: "sendEmail",
    sendLabel: many ? catalogue.Admin.confirm.mail.sendButtonMany : catalogue.Admin.confirm.mail.sendButton,
    skipLabel: many ? catalogue.Admin.confirm.mail.skipButtonMany : catalogue.Admin.confirm.mail.skipButton,
  });
  const cancel: ConfirmSpec = {
    title: "Anulezi înscrierea?",
    body: "b",
    confirmLabel: "Anulează înscrierea",
    cancelLabel: "Renunță",
    destructive: true,
    email: "Pleacă 1 email către Ana Pop: „Înscriere anulată”.",
    emailOptOut: words(ro),
  };

  it("draws no box: the confirm becomes «{action} și trimite emailul», contained, and an outlined «{action} fără email» beside «Renunță»", () => {
    expect(source).not.toContain("confirm-send-email");
    const row = buttons(draw(cancel));
    expect(Object.keys(row)).toEqual(["confirm-dialog-cancel", "confirm-dialog-skip-email", "confirm-dialog-confirm"]);
    expect(row["confirm-dialog-cancel"].text).toBe("Renunță");
    expect(row["confirm-dialog-confirm"].text).toBe("Anulează înscrierea și trimite emailul");
    expect(row["confirm-dialog-skip-email"].text).toBe("Anulează înscrierea fără email");
    // The sending answer keeps the press's colour and glyph; the other is outlined, in the same colour.
    expect(row["confirm-dialog-confirm"].attributes).toMatch(/MuiButton-contained/);
    expect(row["confirm-dialog-confirm"].attributes).toMatch(/MuiButton-colorError/);
    expect(row["confirm-dialog-skip-email"].attributes).toMatch(/MuiButton-outlined/);
    expect(row["confirm-dialog-skip-email"].attributes).not.toMatch(/MuiButton-contained/);
    expect(source).toContain('startIcon={spec.choice ? <SendIcon fontSize="small" /> : <CheckIcon fontSize="small" />}');
    expect(source).toContain('startIcon={<CancelScheduleSendIcon fontSize="small" />}');
  });

  it("words them in English, and in the plural for a counted press — the bulk cancel", () => {
    const english = buttons(draw({ ...cancel, confirmLabel: "Cancel the registration", cancelLabel: "Back", emailOptOut: words(en) }));
    expect(english["confirm-dialog-confirm"].text).toBe("Cancel the registration and send the email");
    expect(english["confirm-dialog-skip-email"].text).toBe("Cancel the registration without the email");
    const bulk = buttons(draw({ ...cancel, confirmLabel: "Anulează înscrierile", emailOptOut: words(ro, true) }));
    expect(bulk["confirm-dialog-confirm"].text).toBe("Anulează înscrierile și trimite emailurile");
    expect(bulk["confirm-dialog-skip-email"].text).toBe("Anulează înscrierile fără emailuri");
    const bulkEnglish = buttons(draw({ ...cancel, confirmLabel: "Cancel the registrations", emailOptOut: words(en, true) }));
    expect(bulkEnglish["confirm-dialog-confirm"].text).toBe("Cancel the registrations and send the emails");
    expect(bulkEnglish["confirm-dialog-skip-email"].text).toBe("Cancel the registrations without the emails");
  });

  it("words the publication's alert its own way", () => {
    for (const [catalogue, verb, send, skip] of [
      [ro, "Publică", "Publică și anunță abonații", "Publică fără anunț"],
      [en, "Publish", "Publish and tell the subscribers", "Publish without telling them"],
    ] as const) {
      const mail = catalogue.Admin.confirm.mail;
      const row = buttons(draw({ ...cancel, destructive: false, confirmLabel: verb, emailOptOut: { field: "sendEmail", sendLabel: mail.alertSendButton, skipLabel: mail.alertSkipButton } }));
      expect(row["confirm-dialog-confirm"].text).toBe(send);
      expect(row["confirm-dialog-skip-email"].text).toBe(skip);
      expect(row["confirm-dialog-confirm"].attributes).toMatch(/MuiButton-colorPrimary/);
    }
  });

  it("holds both answers while a required tick is unticked (§33), and lets both through once it is", () => {
    const held = buttons(draw(cancel, false));
    expect(held["confirm-dialog-confirm"].attributes).toMatch(/disabled=""/);
    expect(held["confirm-dialog-skip-email"].attributes).toMatch(/disabled=""/);
    expect(held["confirm-dialog-cancel"].attributes).not.toMatch(/disabled=""/);
    const free = buttons(draw(cancel, true));
    expect(free["confirm-dialog-confirm"].attributes).not.toMatch(/disabled=""/);
    expect(free["confirm-dialog-skip-email"].attributes).not.toMatch(/disabled=""/);
  });

  it("keeps a second answer beside the two, and a question without the choice as it was: one confirm, its own verb", () => {
    const both = buttons(draw(cancel, true, { label: "Altfel", onClick: noop }));
    expect(Object.keys(both)).toEqual(["confirm-dialog-cancel", "confirm-dialog-alternative", "confirm-dialog-skip-email", "confirm-dialog-confirm"]);
    const plain = buttons(draw({ ...cancel, emailOptOut: undefined }));
    expect(Object.keys(plain)).toEqual(["confirm-dialog-cancel", "confirm-dialog-confirm"]);
    expect(plain["confirm-dialog-confirm"].text).toBe("Anulează înscrierea");
  });

  it("gives each answer a full line on a phone and a thumb's 44 pixels, as the dialog's other buttons", () => {
    expect(source).toContain('const ANSWER_SX = { ...TAP_TARGET, flex: { xs: "1 1 100%", sm: "0 0 auto" } } as const;');
    expect(source.match(/sx=\{ANSWER_SX\}/g)).toHaveLength(4);
    expect(source).toContain('<DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(:first-of-type)": { ml: 0 } }}>');
  });

  it("answers `emailOff: false` from the sending answer and `true` from «… fără email», the road written for the first alone", () => {
    expect(source).toContain("const confirm = withRoad(onConfirm);");
    expect(source).toContain("const confirmWithoutEmail = withRoad(onConfirm, true);");
    expect(source).toMatch(/onClick=\{confirmWithoutEmail\}[\s\S]*?data-testid="confirm-dialog-skip-email"/);
    expect(source).toMatch(/onClick=\{confirm\}[\s\S]*?data-testid="confirm-dialog-confirm"/);
  });
});

describe("§384 ToastProvider", () => {
  const source = read("src/shared/feedback/ToastProvider.tsx");
  // The drawing itself, shared with the public site's toast since §427.
  const region = read("src/shared/feedback/ToastRegion.tsx");
  const messages = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8")) as { Feedback: Record<string, unknown> };

  it("is a polite status region with a close button, one Snackbar at a time, that a click elsewhere never dismisses", () => {
    expect(region).toContain('role="status"');
    // Its own 44-pixel close button, named for a screen reader; MUI's is 28 px.
    expect(region).toMatch(/<IconButton aria-label=\{closeLabel\}[\s\S]*?sx=\{\{ minWidth: 44, minHeight: 44 \}\}>/);
    expect(source).toContain('closeLabel={t("close")}');
    expect(region).toMatch(/if \(reason === "clickaway"\) return;/);
    // A notice may name its own duration (the translate press's 8 s, §496); every other one is the default.
    expect(region).toContain("autoHideDuration={toast.autoHideMs ?? TOAST_AUTO_HIDE_MS}");
    // And the clock runs even while another window has the focus.
    expect(region).toContain("disableWindowBlurListener");
    expect(region).toMatch(/\{toast && \(\s*<Snackbar/);
    // One at a time: the provider hands the region the queue's current toast, never the queue.
    expect(source).toMatch(/<ToastRegion\s+toast=\{current \?/);
  });

  it("sits at the top, under the sticky header, clear of the footer's bar and the editor's sticky save row (§496)", () => {
    expect(region).toContain("anchorOrigin={TOAST_ANCHOR}");
    expect(region).not.toMatch(/bottom: \{/);
  });

  it("shows the flash once and clears its cookie in the browser, from an effect and never in a press", () => {
    expect(source).toMatch(/if \(!flash \|\| shownFlash\.current === flash\) return;/);
    expect(source).toMatch(/document\.cookie = `\$\{FLASH_COOKIE\}=; Max-Age=0; path=\/`;/);
    expect(source).not.toMatch(/onClick[\s\S]*dispatch\(\{ type: "show"/);
  });

  it("renders its children and no toast on the server, with or without a flash", () => {
    const render = (flash: ComponentProps<typeof ToastProvider>["flash"]) =>
      renderToStaticMarkup(
        createElement(
          NextIntlClientProvider,
          { locale: "ro", messages: { Feedback: messages.Feedback } } as unknown as ComponentProps<typeof NextIntlClientProvider>,
          // The children go in as `createElement`'s third argument, which the props type cannot see.
          createElement(ToastProvider, { flash } as unknown as ComponentProps<typeof ToastProvider>, createElement("p", null, "conținut")),
        ),
      );
    // The live region is there from the first paint, and empty (a region inserted already holding
    // its sentence is one a screen reader may never announce).
    const EMPTY_REGION = '<div role="status" aria-live="polite" data-testid="toast-live"></div>';
    expect(render(null)).toBe(`<p>conținut</p>${EMPTY_REGION}`);
    // The flash is shown from an effect, after the page painted: nothing in the server's markup.
    expect(render({ kind: "success", key: "event" })).toBe(`<p>conținut</p>${EMPTY_REGION}`);
  });
});
