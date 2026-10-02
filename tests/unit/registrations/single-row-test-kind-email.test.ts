import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §384 — a single-row confirmation dialog hard-coded `email: words.email(1)`
 * whatever the row's own `kind`, so confirming, giving a place, setting a bib, resending or
 * cancelling a TEST row's dialog said "an email will be sent to 1 participant" — a number the
 * club is never given (`AGENTS.md` §12.6: a test registration is counted in no total the club
 * reads). Every single-row dialog on the desk, the list's row menu and the registration page
 * drops the bold email line for a TEST row instead of promising a "participant" that is not one.
 *
 * A source assertion, like the bib-picture-edge test beside it: what is being pinned is that
 * `row.kind`/`registration.kind` gates every one of these `confirm.email(1)` calls, which is
 * exactly what the next dialog added to one of these files would otherwise forget.
 */
const read = (file: string) => readFileSync(file, "utf8");

/** Every `email: words.email(1)` call in a source string, and whether it is TEST-gated. */
function singleEmailCalls(source: string): string[] {
  const calls: string[] = [];
  let index = source.indexOf("email: words.email(1)");
  while (index !== -1) {
    const start = Math.max(0, index - 80);
    calls.push(source.slice(start, index + "email: words.email(1)".length));
    index = source.indexOf("email: words.email(1)", index + 1);
  }
  return calls;
}

describe("§384 a TEST row's dialog names no participant email", () => {
  it("gates every single-row email line on the desk", () => {
    const desk = read("src/modules/registrations/ui/DeskRow.tsx");
    const calls = singleEmailCalls(desk);
    expect(calls).toHaveLength(3); // confirm-on-paper, give-a-place, set-bib
    expect(calls.every((call) => call.includes('row.kind === "TEST"'))).toBe(true);
  });

  it("gates every single-row email line on the registrations list", () => {
    const list = read("src/app/[locale]/admin/registrations/(list)/page.tsx");
    expect(singleEmailCalls(list).every((call) => call.includes('row.kind === "TEST"'))).toBe(true);
    const gated = (list.match(/row\.kind === "TEST" \? \{\} : \{ email: words\.email\(1\) \}/g) ?? []).length;
    expect(gated).toBe(5); // resend, resend to the family (§588), row-menu confirm-on-paper, give-a-place, cancel
  });

  it("gates every single-row email line on the registration page", () => {
    const page = read("src/app/[locale]/admin/registrations/[id]/page.tsx");
    expect(singleEmailCalls(page).every((call) => call.includes('registration.kind === "TEST"'))).toBe(true);
    const gated = (page.match(/registration\.kind === "TEST" \? \{\} : \{ email: words\.email\(1\) \}/g) ?? []).length;
    expect(gated).toBe(9); // resend, reminder, give-a-place-now (§637), confirm-on-paper, give-a-place, send-the-offer (§615), set-bib, cancel, a waiting row or an open offer seated outside the places (§643)
  });

  /*
    «În afara locurilor» (§643; the review of 2026-10-02): a waiting runner or an open offer is seated
    now, and the dialog's body named the declaration's email «{message}» even for a TEST row whose bold
    email line was dropped — the dialog contradicting itself. A TEST row gets a body that names none.
  */
  it("a TEST row seated outside the places is told of no email in the dialog's body either", () => {
    const page = read("src/app/[locale]/admin/registrations/[id]/page.tsx");
    for (const key of ["outsideMarkBodyWaitlistedTest", "outsideMarkBodyOfferedTest"] as const) {
      expect(page).toMatch(new RegExp(`registration\\.kind === "TEST"\\s*\\?\\s*tr\\("confirm\\.${key}"`));
      for (const catalogue of [ro, en]) {
        const body = catalogue.Admin.confirm[key];
        expect(body).not.toMatch(/email|\{message\}/i);
        expect(body.length).toBeLessThan(200);
      }
    }
    // The real row's bodies still name the email, beside the bold line.
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.confirm.outsideMarkBodyWaitlisted).toContain("{message}");
      expect(catalogue.Admin.confirm.outsideMarkBodyOffered).toContain("{message}");
    }
  });
});
