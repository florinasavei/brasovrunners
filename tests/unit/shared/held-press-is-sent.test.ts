import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELD_PRESS_OVER_EVENT, holdPress, isPressHeld, releaseHeldPress } from "@/shared/ui/held-press";

/**
 * BR-REQ-041-01 — the registration form's send button; `DECISIONS.md` §285, §304 and §502.
 *
 * §285 made the button wait for Cloudflare's token and swallow a press made before it existed.
 * §304 is the defect that swallowing hid: with autofill the whole form is filled in a second and
 * the press comes in the same second, so the swallowed press was the normal press — the Administrator, on
 * 2026-09-23: "nu am eroare … ramane blocat … ca si cum m-am inscris … dar nu apare pe lista",
 * and QA's database had no row for that minute.
 *
 * Source-level, like `boxed-disclosure.test.ts`: the unit suite runs in Node with no DOM, and
 * what has to stay true is a handful of lines in one component and two catalogue sentences.
 * The browser side is `registration-autofill.spec.ts`, which fills the form the way a password
 * manager does, and `registration-turnstile.spec.ts`, which runs the widget itself (§502).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§304 a press held for the anti-bot check is sent, not dropped", () => {
  const source = read("src/shared/ui/SubmitButton.tsx");

  it("replays the held press with the button as the submitter once the wait is over", () => {
    // The whole fix is this call: the browser's own submit, from this button, so validation and
    // the Server Action run exactly as for a fresh press — and never while a request is in flight.
    expect(source).toMatch(/releaseHeldPress\(form, button, !pendingNow\.current\)/);
    expect(read("src/shared/ui/held-press.ts")).toMatch(/if \(submit\) form\.requestSubmit\(button\);/);
    // Once per held press: `send` closes the wait before it submits, so the watchers that fire
    // after it (the field, the form's input, the widget's callback) find it over.
    expect(source).toMatch(/if \(over\) return;\s*\r?\n\s*over = true;\s*\r?\n\s*setHeld\(false\);/);
  });

  it("keeps the eight-second valve, so a blocked check still ends in a submission", () => {
    expect(source).toMatch(/RELEASE_AFTER_MS = 8000/);
    expect(source).toMatch(/const valve = setTimeout\(\(\) => send\(true\), RELEASE_AFTER_MS\);/);
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

/**
 * §502 — the held press that was never sent after Turnstile said «Success!».
 *
 * §285's valve disconnected the token watch eight seconds after the page was drawn, while a
 * listener on the form's `input` went on setting "token missing" — so anybody who typed after the
 * eighth second while the widget had no token (still thinking, a challenge to tick, a reset after
 * a refusal) was left with a press held for good. And §304's replay ran once per mount, which the
 * refusal's redirect does not reset. The browser side is `registration-turnstile.spec.ts`, against
 * a server that runs the widget with Cloudflare's own test keys.
 */
describe("§502 a held press is sent whenever the check answers, every time", () => {
  const source = read("src/shared/ui/SubmitButton.tsx");
  const widget = read("src/modules/registrations/ui/TurnstileWidget.tsx");

  it("reads the token from the form at the press, never from a state an earlier render left", () => {
    expect(source).toMatch(/awaitsBotCheck && form && botCheckUnanswered\(form, mountedAt\.current, RELEASE_AFTER_MS\)/);
    expect(source).not.toMatch(/setTokenMissing/);
  });

  it("counts the valve from each held press and keeps no once-per-mount latch", () => {
    // The valve lives in the effect that a held press starts, so every press gets its own.
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*\r?\n\s*if \(!held\) return;[\s\S]*?const valve = setTimeout\(\(\) => send\(true\), RELEASE_AFTER_MS\);[\s\S]*?\}, \[held\]\);/,
    );
    expect(source).not.toMatch(/replayed\.current/);
  });

  it("watches the field, the form's input and the widget's success callback while a press is held", () => {
    // The hidden field's `value` attribute, which is its `.value` on `type="hidden"`.
    expect(source).toMatch(/new MutationObserver\(check\)/);
    expect(source).toMatch(/attributeFilter: \["value", BOT_CHECK_STATE_ATTRIBUTE, BOT_CHECK_GAVE_UP_ATTRIBUTE\]/);
    expect(source).toMatch(/form\.addEventListener\("input", check\);/);
    // The callback, whatever the field is — read on the next task, not inside the callback, so a
    // script that called back before writing the field does not leave the press to the valve.
    expect(source).toMatch(/form\.addEventListener\(TURNSTILE_TOKEN_EVENT, onToken\);/);
    expect(source).toMatch(/const onToken = \(\) => \{[\s\S]*?afterToken = setTimeout\(check, 0\);/);
    expect(source).toMatch(/clearTimeout\(afterToken\);\s*\r?\n\s*clearTimeout\(late\);/);
    // …and the widget says so, bubbling from its own element into the form.
    // The success callback (`botCheckCallbacks`, since the review of §NNN) calls `onToken` after
    // saying «passed»; the widget's `onToken` is that dispatch.
    expect(widget).toMatch(/onToken: \(\) => element\.dispatchEvent\(new Event\(TURNSTILE_TOKEN_EVENT, \{ bubbles: true \}\)\),/);
    const domain = read("src/modules/registrations/domain/turnstile-widget.ts");
    expect(domain).toMatch(/callback: \(\) => \{\s*\r?\n\s*say\("passed"\);\s*\r?\n\s*onToken\(\);/);
    // Cloudflare's error callback names a state now (§NNN), and answers `false`: the documented
    // "let Turnstile handle the retry", so its own automatic retry is kept.
    expect(domain).toMatch(/"error-callback": \(\) => \{\s*\r?\n\s*say\("error"\);\s*\r?\n\s*return false;/);
  });
});

/**
 * §502 — two awaiting buttons in one form, one request.
 *
 * The registration form has the main send button and, after a too-fast refusal, «Retrimite»
 * (§324), both waiting for the token. Each held its own press and each replayed it when the token
 * landed: two `requestSubmit` calls, two POSTs of one registration. The hold is the form's now.
 */
describe("§502 one held press per form, sent once from the button that was pressed", () => {
  function fakeForm() {
    const submitters: unknown[] = [];
    const events: string[] = [];
    return {
      submitters,
      events,
      requestSubmit: (submitter?: unknown) => void submitters.push(submitter),
      dispatchEvent: (event: Event) => (events.push(event.type), true),
    };
  }
  const button = (name: string) => ({ name }) as unknown as HTMLElement;

  it("two awaiting buttons pressed in one form, the token lands: exactly one submit, from the first pressed", () => {
    const form = fakeForm();
    const main = button("main");
    const resend = button("resend");

    expect(holdPress(form, main)).toBe(true);
    // The second press while the first is held is refused its own hold — it only echoes.
    expect(holdPress(form, resend)).toBe(false);
    expect(isPressHeld(form)).toBe(true);

    // The token lands: every watcher that could fire tries to send.
    expect(releaseHeldPress(form, resend, true)).toBe(false);
    expect(releaseHeldPress(form, main, true)).toBe(true);
    expect(releaseHeldPress(form, main, true)).toBe(false);

    expect(form.submitters).toEqual([main]);
    expect(form.events).toEqual([HELD_PRESS_OVER_EVENT]);
    expect(isPressHeld(form)).toBe(false);
  });

  it("a hold dropped when its button goes away sends nothing, and frees the form for the next press", () => {
    const form = fakeForm();
    const main = button("main");
    const resend = button("resend");
    holdPress(form, main);
    expect(releaseHeldPress(form, main, false)).toBe(true);
    expect(form.submitters).toEqual([]);
    expect(holdPress(form, resend)).toBe(true);
  });

  it("the button swallows any press while its form holds one, and claims the hold before holding", () => {
    const source = read("src/shared/ui/SubmitButton.tsx");
    expect(source).toMatch(/if \(form && isPressHeld\(form\)\) \{\s*\r?\n\s*event\.preventDefault\(\);/);
    expect(source).toMatch(/if \(holdPress\(form, ref\.current as HTMLButtonElement\)\) \{[\s\S]{0,160}?setHeld\(true\);/);
    expect(source).toMatch(/releaseHeldPress\(form, button, false\);/);
  });
});
