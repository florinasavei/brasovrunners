import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import ToastProvider from "@/shared/feedback/ToastProvider";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";

/**
 * `DECISIONS.md` §NNN — the one confirmation dialog and the one toast provider, as the source
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

describe("§NNN ConfirmDialog", () => {
  const source = read("src/shared/feedback/ConfirmDialog.tsx");

  it("focuses the safe button on open, so a stray Space — or Enter in a destructive dialog — cancels", () => {
    expect(source).toMatch(/<Button onClick=\{onCancel\} autoFocus/);
    expect(source).not.toMatch(/onClick=\{onConfirm\}[^>]*autoFocus/);
  });

  it("lets Enter confirm only a dialog that is not destructive, and stops the focused cancel from taking the key", () => {
    expect(source).toMatch(/if \(confirmOnKey\(event\.key, spec\.destructive\) !== "confirm"\) return;/);
    expect(source).toMatch(/event\.preventDefault\(\);\s*onConfirm\(\);/);
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

describe("§NNN ToastProvider", () => {
  const source = read("src/shared/feedback/ToastProvider.tsx");
  const messages = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8")) as { Feedback: Record<string, unknown> };

  it("is a polite status region with a close button, one Snackbar at a time, that a click elsewhere never dismisses", () => {
    expect(source).toContain('role="status"');
    // Its own 44-pixel close button, named for a screen reader; MUI's is 28 px.
    expect(source).toMatch(/<IconButton aria-label=\{t\("close"\)\}[\s\S]*?sx=\{\{ minWidth: 44, minHeight: 44 \}\}>/);
    expect(source).toMatch(/if \(reason === "clickaway"\) return;/);
    expect(source).toContain("autoHideDuration={TOAST_AUTO_HIDE_MS}");
    // And the clock runs even while another window has the focus.
    expect(source).toContain("disableWindowBlurListener");
    expect(source).toMatch(/\{current && \(\s*<Snackbar/);
  });

  it("sits above the phone footer's two lines and the editor's sticky save row", () => {
    expect(source).toMatch(/bottom: \{ xs: 112, sm: 64 \}/);
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
