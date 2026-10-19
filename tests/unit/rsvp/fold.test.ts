import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mayCountNow } from "@/modules/rsvp/domain/auto-confirm";
import { rsvpSummaryParts, rsvpSummarySuffix, type RsvpSummaryWords } from "@/modules/rsvp/domain/summary";
import { readRsvpGoing, setRsvpGoing, subscribeRsvpGoing } from "@/modules/rsvp/ui/going-store";

/**
 * §812 — the pure rules behind the closed «Vii?» fold's line and the link page's self-press (the owner, 2026-10-19: «Asta ar trebui să
 * fie collapsed, ca și condițiile de participare» and «Asta ar trebui să se auto-bifeze când deschid»). The markup is proved in
 * `render.test.ts`, the link page in `tests/integration/rsvp/link-page.test.ts`, the journey in `tests/e2e/rsvp.spec.ts`.
 */
const words: RsvpSummaryWords = { countText: "3 vin", emptyText: "Fii primul care spune că vine.", goingText: "Tu vii" };
const nobody: RsvpSummaryWords = { ...words, countText: null };

describe("§812 the words on the fold's line", () => {
  it("says how many come after the heading", () => {
    expect(rsvpSummarySuffix(words, false, true)).toBe(" · 3 vin");
  });

  it("asks to be first when nobody has answered and the count was read", () => {
    expect(rsvpSummarySuffix(nobody, false, true)).toBe(" · Fii primul care spune că vine.");
  });

  it("says nothing when the count could not be read — not a count of zero (§281)", () => {
    expect(rsvpSummarySuffix(nobody, false, false)).toBe("");
    expect(rsvpSummaryParts(nobody, false, false)).toEqual([]);
  });

  it("adds «Tu vii ✓» before the count once the island knows this browser answered — the tick beside the words, never alone", () => {
    expect(rsvpSummarySuffix(words, true, true)).toBe(" · Tu vii ✓ · 3 vin");
    expect(rsvpSummaryParts(words, true, true)[0]).toContain("Tu vii");
  });

  it("does not ask to be first of somebody who is already coming, even before the count catches up", () => {
    expect(rsvpSummarySuffix(nobody, true, true)).toBe(" · Tu vii ✓");
    expect(rsvpSummarySuffix(nobody, true, false)).toBe(" · Tu vii ✓");
  });
});

describe("§812 what the island tells the line", () => {
  it("keeps one answer per event and tells a subscriber only when it changes", () => {
    let told = 0;
    const stop = subscribeRsvpGoing(() => (told += 1));
    expect(readRsvpGoing("alergarea-de-joi")).toBe(false);
    setRsvpGoing("alergarea-de-joi", true);
    setRsvpGoing("alergarea-de-joi", true);
    expect(readRsvpGoing("alergarea-de-joi")).toBe(true);
    // Another event's page is not told this one's answer.
    expect(readRsvpGoing("alt-eveniment")).toBe(false);
    setRsvpGoing("alergarea-de-joi", false);
    expect(readRsvpGoing("alergarea-de-joi")).toBe(false);
    expect(told).toBe(2);
    stop();
    setRsvpGoing("alergarea-de-joi", true);
    expect(told).toBe(2);
    setRsvpGoing("alergarea-de-joi", false);
  });
});

describe("§812 when the «Da, vin» page may press its own button", () => {
  it("presses for a page a person is looking at", () => {
    expect(mayCountNow({ prerendering: false, visibilityState: "visible" })).toBe(true);
    expect(mayCountNow({ visibilityState: "visible" })).toBe(true);
  });

  it("waits while the browser only prerenders the page, and while its tab is in the background", () => {
    expect(mayCountNow({ prerendering: true, visibilityState: "visible" })).toBe(false);
    expect(mayCountNow({ prerendering: false, visibilityState: "hidden" })).toBe(false);
    expect(mayCountNow({ visibilityState: "prerender" })).toBe(false);
  });
});

describe("§812 the island presses once, and only the POST the button makes", () => {
  const source = readFileSync(path.resolve(__dirname, "../../../src/modules/rsvp/ui/AutoConfirm.tsx"), "utf8");

  it("calls the form's own requestSubmit, behind a ref that remembers the press and the attention rule", () => {
    expect(source).toContain("form.requestSubmit()");
    expect(source).toContain("pressed.current");
    expect(source).toContain("mayCountNow(");
    // It draws nothing of its own and imports no server code: the action stays the page's.
    expect(source).not.toMatch(/from "@\/app\//);
    expect(source).not.toMatch(/fetch\(/);
  });
});
