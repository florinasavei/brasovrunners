import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN, over §331 — a cancelled race is said first. «Înscrierile mele» says it with a chip
 * («Eveniment anulat») and a short line under it; the manage page has no chip, so its own line
 * must name the cancellation, never borrow «Înscrierile mele»'s chip-less sentence.
 */
const page = readFileSync("src/app/[locale]/registrations/manage/[token]/page.tsx", "utf8");

describe("the manage page's cancelled state (§331)", () => {
  it("draws its own line, not «Înscrierile mele»'s", () => {
    expect(page).toContain('t("manage.eventCancelled")');
    expect(page).not.toContain('t("mine.eventCancelled")');
  });

  it("says the event was cancelled, in both languages", () => {
    expect(ro.Registrations.manage.eventCancelled).toMatch(/anulat/);
    expect(en.Registrations.manage.eventCancelled).toMatch(/cancelled/);
  });
});
