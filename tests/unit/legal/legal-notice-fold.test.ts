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
    expect(page).toContain('<Panel title={t("legalNotice.title")} collapsible>');
    expect(page).toContain('{t("legalNotice.body")}');
    expect(page).toContain('<Box id="legal-versions"');
    // After the legal.title / legal.intro / whatIs block, not before it.
    const whatIsIndex = page.indexOf('{t(`legal.whatIs.${key}`)}');
    const noticeIndex = page.indexOf('id="legal-versions"');
    expect(whatIsIndex).toBeGreaterThan(0);
    expect(noticeIndex).toBeGreaterThan(whatIsIndex);
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
