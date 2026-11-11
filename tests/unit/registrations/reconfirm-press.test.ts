import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mayReconfirmNow, reconfirmPressesItself } from "@/modules/registrations/domain/reconfirm-press";

/**
 * BR-REQ-036-02 — one press counts (the decision «Cere reconfirmarea»): the email's «Vin» opens the manage page at
 * `#reconfirm`, and the page presses «Da, vin la cursă» once, by itself, the way the «Da, vin» link page does (the owner,
 * 2026-10-19, of that page: «Asta ar trebui să se auto-bifeze când deschid»). The GET writes nothing; the press is the
 * form's own POST, so a scanner that runs no scripts counts nobody. The behaviour on the page is
 * `tests/integration/registrations/reconfirmation.test.ts` and `tests/e2e/reconfirm-reminder.spec.ts`.
 */
describe("which form the server wraps in the island", () => {
  it("the link's own registration with its question open and nothing in the address", () => {
    expect(reconfirmPressesItself({ own: true, questionOpen: true, outcome: undefined })).toBe(true);
  });

  it("never another person of the address, a question already answered, or after an answer or a refusal", () => {
    expect(reconfirmPressesItself({ own: false, questionOpen: true, outcome: undefined })).toBe(false);
    expect(reconfirmPressesItself({ own: true, questionOpen: false, outcome: undefined })).toBe(false);
    expect(reconfirmPressesItself({ own: true, questionOpen: true, outcome: "1" })).toBe(false);
    expect(reconfirmPressesItself({ own: true, questionOpen: true, outcome: "0" })).toBe(false);
  });
});

describe("when the browser presses", () => {
  it("at #reconfirm, in a shown tab that is not prerendered", () => {
    expect(mayReconfirmNow({ hash: "#reconfirm", visibilityState: "visible" })).toBe(true);
    expect(mayReconfirmNow({ hash: "#reconfirm", prerendering: false, visibilityState: "visible" })).toBe(true);
  });

  it("not at #cancel, not on a bare link, not while prerendered or in the background", () => {
    expect(mayReconfirmNow({ hash: "#cancel", visibilityState: "visible" })).toBe(false);
    expect(mayReconfirmNow({ hash: "", visibilityState: "visible" })).toBe(false);
    expect(mayReconfirmNow({ hash: "#reconfirm", prerendering: true, visibilityState: "visible" })).toBe(false);
    expect(mayReconfirmNow({ hash: "#reconfirm", visibilityState: "hidden" })).toBe(false);
  });
});

describe("the island presses once, and only the POST the button makes", () => {
  const source = readFileSync(path.resolve(__dirname, "../../../src/modules/registrations/ui/ReconfirmOnArrival.tsx"), "utf8");

  it("calls the form's own requestSubmit, behind a ref that remembers the press and the attention rule", () => {
    expect(source).toContain("form.requestSubmit()");
    expect(source).toContain("pressed.current");
    expect(source).toContain("mayReconfirmNow(");
    // It draws nothing of its own and imports no server code: the action stays the page's.
    expect(source).not.toMatch(/from "@\/app\//);
    expect(source).not.toMatch(/fetch\(/);
  });
});
