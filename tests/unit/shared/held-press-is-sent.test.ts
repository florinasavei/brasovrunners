import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-041-01 — the registration form's send button; `DECISIONS.md` §285 and §304.
 *
 * §285 made the button wait for Cloudflare's token and swallow a press made before it existed.
 * §304 is the defect that swallowing hid: with autofill the whole form is filled in a second and
 * the press comes in the same second, so the swallowed press was the normal press — Amalia, on
 * 2026-09-23: "nu am eroare … ramane blocat … ca si cum m-am inscris … dar nu apare pe lista",
 * and QA's database had no row for that minute.
 *
 * Source-level, like `boxed-disclosure.test.ts`: the unit suite runs in Node with no DOM, and
 * what has to stay true is a handful of lines in one component and two catalogue sentences.
 * The browser side is `registration-autofill.spec.ts`, which fills the form the way a password
 * manager does.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§304 a press held for the anti-bot check is sent, not dropped", () => {
  const source = read("src/shared/ui/SubmitButton.tsx");

  it("replays the held press with the button as the submitter once the wait is over", () => {
    // The whole fix is this call: the browser's own submit, from this button, so validation and
    // the Server Action run exactly as for a fresh press.
    expect(source).toMatch(/form\.requestSubmit\(button\)/);
    // Fired by the state that ends the wait — the token arrived or the eight-second valve opened —
    // and never while a request is already in flight.
    expect(source).toMatch(/if \(!pressedEarly \|\| waiting \|\| pending \|\| replayed\.current\) return;/);
    // Once. A second replay would be a second request behind the first.
    expect(source).toMatch(/replayed\.current = true;\s*\r?\n\s*form\.requestSubmit\(button\)/);
  });

  it("keeps the eight-second valve, so a blocked check still ends in a submission", () => {
    expect(source).toMatch(/RELEASE_AFTER_MS = 8000/);
    expect(source).toMatch(/setTokenMissing\(false\);/);
  });

  it("says so when a submit takes too long, and forbids the second press", () => {
    expect(source).toMatch(/SLOW_AFTER_MS = 15_000/);
    expect(source).toMatch(/\{pending && slow && slowHint && \(/);
  });

  it("is told both sentences by the registration page, in both languages", () => {
    const page = read("src/app/[locale]/events/[slug]/register/page.tsx");
    expect(page).toContain('botCheckHint={t("botCheckWait")}');
    expect(page).toContain('slowHint={t("submitSlow")}');

    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const catalogue = read(file);
      expect(catalogue, file).toMatch(/"botCheckWait": "/);
      expect(catalogue, file).toMatch(/"submitSlow": "/);
    }
    // The waiting sentence must promise the send, because that is what changed: the person is
    // no longer expected to press again.
    expect(read("messages/ro.json")).toMatch(/"botCheckWait": "[^"]*trimitem noi/);
    expect(read("messages/en.json")).toMatch(/"botCheckWait": "[^"]*we send the form ourselves/);
  });
});
