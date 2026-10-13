import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-070-04, `DECISIONS.md` §679 (amending §676) — the owner, 2026-10-09: «And the newsletter must
 * be all the way to the bottom now». On `/contact` the contact form comes first, «Spune-ne ceva» under
 * it, and the newsletter's box is the page's last section: nothing but the club's identity line (§565)
 * is drawn after it. Source-level, like `density-pass-360.test.ts`: the order in the page's JSX is the
 * order on the page, the three sections being siblings in one column.
 */
const page = readFileSync("src/app/[locale]/contact/page.tsx", "utf8").replace(/\r\n/g, "\n");
const body = page.slice(page.indexOf("export default async function ContactPage"));
const jsx = body.slice(body.indexOf("return ("));

describe("BR-REQ-070-04 the contact page's sections, in order (§679)", () => {
  it("draws «Spune-ne ceva» (when offered), then the form, then «Contact direct», then the newsletter, then only the identity line", () => {
    // «Spune-ne ceva» first when offered (§746, amending §721), the form, «Contact direct» (§721, amending §698), the newsletter.
    expect(page).toContain("id={FEEDBACK_SECTION_ID}");
    const ways = jsx.indexOf('data-testid="contact-ways"');
    const form = jsx.indexOf("<form action={submitContactAction}>");
    const feedback = jsx.indexOf("{feedbackSection}");
    const newsletter = jsx.indexOf("<NewsletterSignup");
    const identity = jsx.indexOf('<ClubIdentity shape="line" />');
    for (const [name, at] of Object.entries({ ways, form, feedback, newsletter, identity })) expect(at, name).toBeGreaterThan(-1);
    expect(feedback).toBeLessThan(form);
    expect(form).toBeLessThan(ways);
    expect(ways).toBeLessThan(newsletter);
    expect(newsletter).toBeLessThan(identity);
  });

  it("gives «Contact direct» the rule every later section has, the form's section the rule only under «Spune-ne ceva», and the first section none", () => {
    // §721, amending §698: the form's section is the page's head and draws no rule; «Contact direct», now
    // under «Spune-ne ceva», opens with the one every section after the form has.
    const openingTag = (testId: string) => {
      const at = body.indexOf(`data-testid="${testId}"`);
      expect(at, testId).toBeGreaterThan(-1);
      // From the `<Box` that carries the id to the first `>` after it: the tag's own attributes.
      return body.slice(body.lastIndexOf("<Box", at), body.indexOf(">", at) + 1);
    };
    expect(openingTag("contact-ways")).toContain("sx={SECTION_SX}");
    // The form's section is the page's head, with no rule, unless «Spune-ne ceva» is drawn above it (§746).
    expect(openingTag("contact-form-section")).toContain("sx={feedbackOpen ? SECTION_SX : undefined}");
    expect(openingTag("feedback-section")).not.toContain("sx=");
  });

  it("draws no section, form or button after the newsletter's box", () => {
    const after = jsx.slice(jsx.indexOf("<NewsletterSignup"));
    // From the box's own `/>` to the page's closing `</Container>`.
    const afterBox = after.slice(after.indexOf("/>") + 2, after.indexOf("</Container>"));
    expect(afterBox).not.toMatch(/component="section"|<section\b|<form\b|<Button\b|<Box\b/);
    expect(afterBox.match(/<[A-Za-z][A-Za-z]*/g)).toEqual(["<ClubIdentity"]);
  });
});
