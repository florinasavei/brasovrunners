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
  it("draws the form, then «Spune-ne ceva», then the newsletter, then only the identity line", () => {
    // «Contact direct» above the form (§NNN), the form, «Spune-ne ceva», the newsletter.
    const ways = jsx.indexOf('data-testid="contact-ways"');
    const form = jsx.indexOf("<form action={submitContactAction}>");
    const feedback = jsx.indexOf("id={FEEDBACK_SECTION_ID}");
    const newsletter = jsx.indexOf("<NewsletterSignup");
    const identity = jsx.indexOf('<ClubIdentity shape="line" />');
    for (const [name, at] of Object.entries({ ways, form, feedback, newsletter, identity })) expect(at, name).toBeGreaterThan(-1);
    expect(ways).toBeLessThan(form);
    expect(form).toBeLessThan(feedback);
    expect(feedback).toBeLessThan(newsletter);
    expect(newsletter).toBeLessThan(identity);
  });

  it("draws no section, form or button after the newsletter's box", () => {
    const after = jsx.slice(jsx.indexOf("<NewsletterSignup"));
    // From the box's own `/>` to the page's closing `</Container>`.
    const afterBox = after.slice(after.indexOf("/>") + 2, after.indexOf("</Container>"));
    expect(afterBox).not.toMatch(/component="section"|<section\b|<form\b|<Button\b|<Box\b/);
    expect(afterBox.match(/<[A-Za-z][A-Za-z]*/g)).toEqual(["<ClubIdentity"]);
  });
});
