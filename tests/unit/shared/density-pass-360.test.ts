import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOXED_DISCLOSURE_SX, DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { INLINE_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * §480 — the 360-px density pass over the public pages. Two defects measured in the browser, not
 * spacing values: `tests/unit/theme/density.test.ts` holds the values it moved onto the scale.
 *
 * 1. A public fold's `<summary>` was 64 pixels tall where it claimed 44: slotted into its
 *    `<details>`'s shadow tree, it sized its content box (§366), and the padding went on top.
 * 2. A link inside a sentence stretched its line to 44 pixels, so one line of every such
 *    paragraph stood apart from the others.
 *
 * `tests/e2e/public-density-360.spec.ts` measures both on the built pages.
 */

const ROOT = join(__dirname, "..", "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("§480 a public fold is the 44 pixels it claims", () => {
  it("counts the summary's padding inside its 44 (border-box)", () => {
    expect(DISCLOSURE_SUMMARY_SX.boxSizing).toBe("border-box");
    expect(DISCLOSURE_SUMMARY_SX.minHeight).toBe(TAP_TARGET.minHeight);
    // The words' line and the padding make the 44 on their own: 24 + 2 × 10.
    expect(DISCLOSURE_SUMMARY_SX.py).toBe(1.25);
    // The same summary addressed from the `<details>`.
    expect(DISCLOSURE_SX["& > summary"].boxSizing).toBe("border-box");
  });

  it("leaves the backoffice's boxed bars at the height they were approved at", () => {
    expect(BOXED_DISCLOSURE_SX["& > summary"].boxSizing).toBe("content-box");
  });
});

describe("§480 a link inside a sentence keeps 44 pixels without stretching its line", () => {
  it("reaches above its words and gives the reach back as a negative margin", () => {
    expect(INLINE_TAP_TARGET.display).toBe("inline-flex");
    // In `em`, which every browser knows — `lh` is unknown to Safari before 16.4 and Firefox
    // before 120, where the link would drop under 44 — and 1.4 is under body2's 1.43 and body1's
    // 1.5 line heights, so the link is at least 44 at both.
    expect(INLINE_TAP_TARGET.paddingTop).toBe("calc(44px - 1.4em)");
    expect(INLINE_TAP_TARGET.marginTop).toBe("calc(1.4em - 44px)");
    expect(JSON.stringify(INLINE_TAP_TARGET)).not.toMatch(/lh\b/);
    for (const [variant, fontSize, lineHeight] of [["body2", 14, 1.43], ["body1", 16, 1.5]] as const) {
      const reach = 44 - 1.4 * fontSize;
      expect(reach + lineHeight * fontSize, `${variant}: the link's height`).toBeGreaterThanOrEqual(44);
    }
    // All of the reach above: the line after is painted later and would take a press there.
    expect("paddingBottom" in INLINE_TAP_TARGET).toBe(false);
    expect("marginBottom" in INLINE_TAP_TARGET).toBe(false);
    // Never a minimum height: a link that wraps would be squeezed into it and overlap the next line.
    expect("minHeight" in INLINE_TAP_TARGET).toBe(false);
  });

  it("is the shape of «scrie-ne» in a sentence and of the contact page's inline links", () => {
    expect(source("src/shared/ui/ContactLink.tsx")).toContain("style={INLINE_TAP_TARGET}");
    const contact = source("src/app/[locale]/contact/page.tsx");
    expect(contact).toContain("const inlineLink = INLINE_TAP_TARGET;");
    expect(contact).not.toMatch(/minHeight: TAP_TARGET\.minHeight/);
  });

  it("never lets one inline link's reach cover another's", () => {
    const contact = source("src/app/[locale]/contact/page.tsx");
    // A second club address («a sau b») may wrap under the first: it is 44 in its own line
    // instead of reaching over the first address's lower half.
    expect(contact).toContain("sx={index === 0 ? inlineLink : stretchedLink}");
    expect(contact).toMatch(/const stretchedLink = \{ display: "inline-flex", alignItems: "center", \.\.\.TAP_TARGET \}/);
    // The address line keeps 24 pixels over it at every width, room for the first address's
    // 21.6-pixel reach above its words, clear of the send button.
    expect(contact).toMatch(/<Typography variant="body1" sx=\{\{ mt: 3 \}\}>\s*\{t\("direct"\)\}/);
  });
});

describe("§480 the contact form's first box is one gap under the legend, not two", () => {
  it("keeps the hidden inputs out of the column, so the name box is its first item", () => {
    const contact = source("src/app/[locale]/contact/page.tsx");
    const form = contact.slice(contact.indexOf("<form action={submitContactAction}>"));
    const column = form.indexOf("<Stack spacing={2}>");
    expect(column).toBeGreaterThan(0);
    for (const name of ['name="locale"', 'name="honeypot"', 'name="renderedAt"']) {
      const at = form.indexOf(name);
      expect(at, `${name} is in the form`).toBeGreaterThan(0);
      expect(at, `${name} comes before the column`).toBeLessThan(column);
    }
    // The name box is the column's first child.
    expect(form.slice(column).replace(/\s+/g, " ")).toMatch(/^<Stack spacing=\{2\}> <TextField \{\.\.\.field\("name"\)\}/);
  });
});
