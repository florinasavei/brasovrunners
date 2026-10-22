import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §336: the rule the legal-versions list lives by is a closed fold, shown on `/admin/legal`
 * alone — every other admin page used to carry it with nothing below it to point at (the
 * review that moved it out of the section's `layout.tsx`, where it sat above the page's own
 * heading, saved/refusal alerts and the platform-approve call to action).
 *
 * The page is an async Server Component reading the database, so this stays source-level —
 * the same approach `emails-page-folds.test.ts` takes for its second describe block — rather
 * than rendering it.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§336 the legal-text notice folds shut on /admin/legal and nowhere else", () => {
  const page = read("src/app/[locale]/admin/legal/(list)/page.tsx");
  const sectionLayout = read("src/app/[locale]/admin/legal/(list)/layout.tsx");
  const adminLayout = read("src/app/[locale]/admin/layout.tsx");
  const devsLayout = read("src/app/[locale]/devs/layout.tsx");
  const backofficeShell = read("src/modules/staff-identity/ui/BackofficeShell.tsx");

  it("renders the notice as a closed, addressable fold on the legal list page, after its own heading", () => {
    // Inside the page's one panel of notices since §NNN, a fold of that card: level 3.
    expect(page).toContain('<Panel glyph="legal" level={3} id="legal-versions" title={t("legalNotice.title")} collapsible>');
    expect(page.indexOf('data-testid="legal-notices"')).toBeLessThan(page.indexOf('id="legal-versions"'));
    expect(page.indexOf('{t("legal.title")}')).toBeLessThan(page.indexOf('id="legal-versions"'));
    expect(page).toContain('{t("legalNotice.body")}');
    // After the legal.title / legal.intro / whatIs block, not before it.
    const whatIsIndex = page.indexOf('{t(`legal.whatIs.${key}`)}');
    const noticeIndex = page.indexOf('id="legal-versions"');
    expect(whatIsIndex).toBeGreaterThan(0);
    expect(noticeIndex).toBeGreaterThan(whatIsIndex);
  });

  it("gathers the notices into one panel, a line each with its sentence behind the «?», and draws no alert for them (§NNN)", () => {
    const panel = page.slice(page.indexOf('glyph="notices"'), page.indexOf('id="legal-versions"'));
    expect(panel).toContain('data-testid="legal-notices"');
    expect(panel).toContain("<QuietHelp text={notice.details}");
    // The warnings first, then the page's help.
    expect(panel.indexOf("notices.map(")).toBeLessThan(panel.indexOf('data-testid="legal-steps"'));
    for (const id of ["list-states", "list-socials", "list-numbers", "results", "rsvp", "results-terms", "promo", "sponsor", "refusal"]) {
      expect(page).toContain(`"legal-${id}-missing"`);
    }
    expect(page).not.toMatch(/<Alert severity="info" data-testid="legal-[a-z-]+-missing"/);
  });

  it("lists the texts as the house's rows: one row fold per text, a StatusChip for each state, no card per text (§NNN)", () => {
    expect(page).toContain("sx={SUMMARY_SX}");
    expect(page).toContain('data-testid="legal-kind-fold"');
    expect(page).toContain("{kindsShown.map(kindRow)}");
    expect(page).toMatch(/<StatusChip glyph="planned" color="warning" label=\{t\("legal\.kinds\.chipDraftWaiting"\)\}/);
    expect(page).toMatch(/<StatusChip glyph="newTemplate"/);
    expect(page).not.toContain("@mui/material/Chip");
  });

  it("uses the same headings the message catalogues carry, in both languages", () => {
    const ro = JSON.parse(read("messages/ro.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(ro.Admin.legalNotice.title).toBe("Cum funcționează versiunile textelor legale");
    expect(en.Admin.legalNotice.title).toBe("How legal-text versions work");
  });

  it("leaves the section layout a plain role gate, with no Panel of its own", () => {
    expect(sectionLayout).not.toContain("Panel");
    expect(sectionLayout).not.toContain("legalNotice");
    expect(sectionLayout).toContain("canReadContent");
  });

  it("shows the notice on no other admin page — the shared shell carries no notice slot", () => {
    expect(adminLayout).not.toContain("legalNotice");
    expect(devsLayout).not.toContain("legalNotice");
    expect(backofficeShell).not.toContain("notice");
  });
});
