import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOXED_DISCLOSURE_SX, DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { INLINE_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * §NNN — the 360-px density pass over the public pages. Two defects measured in the browser, not
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

describe("§NNN a public fold is the 44 pixels it claims", () => {
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

describe("§NNN a link inside a sentence keeps 44 pixels without stretching its line", () => {
  it("reaches above its words and gives the reach back as a negative margin", () => {
    expect(INLINE_TAP_TARGET.display).toBe("inline-flex");
    expect(INLINE_TAP_TARGET.paddingTop).toBe("calc(44px - 1lh)");
    expect(INLINE_TAP_TARGET.marginTop).toBe("calc(1lh - 44px)");
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
});

describe("§NNN the contact form's first box is one gap under the legend, not two", () => {
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
