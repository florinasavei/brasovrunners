import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §384 — a single-row confirmation dialog once hard-coded "an email will be sent to 1 participant"
 * whatever the row's own `kind`, so confirming, giving a place, setting a bib, resending or cancelling a TEST row's
 * dialog promised a "participant" the club is never given (`AGENTS.md` §12.6: a test registration is counted in no
 * total the club reads).
 *
 * Since the design «telling the owner about every email a staff press sends» (slice 3) every such line comes from the
 * one builder, `confirmWords().mail({ to, type, test })`: it names the person and the email, and for a TEST row says
 * the address reaches nobody — in place of the club's copies, which a test row never has. What is pinned here is that
 * every single-row call on the desk, the list's row menu and the registration page hands the row's own `kind` to the
 * builder — exactly what the next dialog added to one of these files would otherwise forget.
 *
 * A source assertion, like the bib-picture-edge test beside it.
 */
const read = (file: string) => readFileSync(file, "utf8");

/** Every `words.mail({ to: <the row's name>, … })` call in a source, on one line or several, from its opening to its first `})`. */
function singleRowMailCalls(source: string, row: "row" | "registration"): string[] {
  const opening = new RegExp(`words\\.mail\\(\\{\\s*to: ${row}\\.registeredName\\b`, "g");
  return [...source.matchAll(opening)].map((match) => source.slice(match.index, source.indexOf("})", match.index) + 2));
}

describe("§384 a TEST row's dialog names no participant the club counts", () => {
  it("hands the row's kind to the builder in every single-row email line on the desk", () => {
    const calls = singleRowMailCalls(read("src/modules/registrations/ui/DeskRow.tsx"), "row");
    expect(calls).toHaveLength(3); // confirm-on-paper, give-a-place, set-bib
    expect(calls.every((call) => call.includes('test: row.kind === "TEST"'))).toBe(true);
  });

  it("hands the row's kind to the builder in every single-row email line on the registrations list", () => {
    const calls = singleRowMailCalls(read("src/app/[locale]/admin/registrations/(list)/page.tsx"), "row");
    // resend, row-menu confirm-on-paper, «Trimite-i oferta» (§888), give-a-place, the special list's seat (§643), cancel
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.includes('test: row.kind === "TEST"'))).toBe(true);
    // «Retrimite familiei» (§588) names the family, with the clicked row's kind.
    expect(read("src/app/[locale]/admin/registrations/(list)/page.tsx")).toContain('words.mail({ to: names, type: sent.type, or: sent.or, test: row.kind === "TEST" })');
  });

  it("hands the row's kind to the builder in every single-row email line on the registration page", () => {
    const calls = singleRowMailCalls(read("src/app/[locale]/admin/registrations/[id]/page.tsx"), "registration");
    // resend, reminder, give-a-place-now (§637), send-the-offer (§615), confirm-on-paper, give-a-place, set-bib, the special list's seat, cancel
    expect(calls).toHaveLength(9);
    expect(calls.every((call) => call.includes('test: registration.kind === "TEST"'))).toBe(true);
  });

  it("says, for a TEST row, that the address reaches nobody — and counts it nowhere", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.confirm.mail.test).toContain("@test.invalid");
      expect(catalogue.Admin.confirm.mail.test).not.toMatch(/\{count\}|participant/i);
    }
  });

  /*
    «În afara locurilor» (§643; the review of 2026-10-02): a waiting runner or an open offer is seated
    now, and the dialog's body named the declaration's email «{message}» even for a TEST row — the
    dialog contradicting itself. A TEST row gets a body that names none; its email line is the builder's.
  */
  it("a TEST row seated outside the places is told of no email in the dialog's body either", () => {
    // One function since §747: the registration's page and the list's «⋮» both call it, handing it the builder's lines.
    const helper = read("src/modules/registrations/ui/outside-mark-body.ts");
    expect(helper).toContain("...(seatedNow ? words.seated : holdsAPlace(row.status) ? words.freed : words.none)");
    for (const key of ["outsideMarkBodyWaitlistedTest", "outsideMarkBodyOfferedTest"] as const) {
      expect(helper).toMatch(new RegExp(`row\\.kind === "TEST"\\s*\\?\\s*t\\("confirm\\.${key}"`));
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
