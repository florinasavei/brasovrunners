import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import CheckboxField from "@/shared/ui/CheckboxField";
import { CONSENT_DENSITY } from "@/shared/ui/consent-density";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * §NNN — the registration form's «Acorduri» block, compacted (the owner, 2026-09-29 19:03: "Also
 * these need to be more compacted!"), with every word the legal reviews fixed (§425, §556).
 *
 * The heights, pinned as the numbers `CONSENT_DENSITY` documents: a row is `max(44, 24 + 20 × lines)`
 * pixels with no gap between rows — it was `max(48, 24 × lines) + 16`. Five one-line rows are
 * 5 × 44 = 220 px where they were 5 × 64 − 16 = 304; a label that wraps to four lines at 320 px is
 * 104 where it was 96 + 16 = 112, and every line of the block is 20 px where it was 24.
 */
const PAGE = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "events", "[slug]", "register", "page.tsx"), "utf8");
const GATE = readFileSync(path.join(process.cwd(), "src", "modules", "registrations", "ui", "ReadAndAgree.tsx"), "utf8");
/** The block: from the «Acorduri» heading to the end of its own Stack. */
const BLOCK = PAGE.slice(PAGE.indexOf('t("sections.consents")'), PAGE.indexOf("</Stack>", PAGE.indexOf('data-testid="registration-consents"')));

const rowHeight = (lines: number) => Math.max(CONSENT_DENSITY.rowMinHeightPx, 24 + 20 * lines) + CONSENT_DENSITY.rowGapPx;

describe("§NNN the «Acorduri» block's density", () => {
  it("pins the numbers: a 44-pixel small box, body2 labels, no gap between rows", () => {
    expect(CONSENT_DENSITY).toMatchObject({ checkboxSize: "small", rowMinHeightPx: 44, labelVariant: "body2", rowGapPx: 0 });
    // The small glyph is 20 px; the tap target's 12 on each side make it 44 — never under the thumb's rule.
    expect(CHECKBOX_TAP_TARGET).toEqual({ p: 1.5 });
    expect(20 + 2 * 12).toBe(CONSENT_DENSITY.rowMinHeightPx);
    expect(CONSENT_DENSITY.rowSx["& .MuiFormControlLabel-label"]).toEqual({ py: "12px" });
    expect(CONSENT_DENSITY.helpSx).toEqual({ display: "block", mt: "-8px", pl: "33px" });
    // Five one-line rows: 220 px, where they were 304.
    expect([1, 1, 1, 1, 1].reduce((sum, lines) => sum + rowHeight(lines), 0)).toBe(220);
    expect([1, 1, 1, 1, 1].reduce((sum, lines) => sum + Math.max(48, 24 * lines) + 16, -16)).toBe(304);
  });

  it("draws a dense box as a small MUI box, its label in body2 and its helper a caption that describes it", () => {
    const box = (props: Omit<ComponentProps<typeof CheckboxField>, "children">, label: string) =>
      renderToStaticMarkup(createElement(CheckboxField as (props: Omit<ComponentProps<typeof CheckboxField>, "children">) => ReactElement, props, label));
    const html = box({ name: "listOptIn", dense: true, help: "Lista arată și stadiul.", helpTestId: "list-opt-in-states" }, ro.Registration.listOptIn);
    expect(html).toContain("MuiCheckbox-sizeSmall");
    expect(html).toContain("MuiTypography-body2");
    expect(html).toContain("MuiTypography-caption");
    expect(html).toContain('data-testid="list-opt-in-states"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    // Without `dense`, the backoffice's boxes are as they were.
    const plain = box({ name: "x" }, "x");
    expect(plain).not.toContain("MuiCheckbox-sizeSmall");
    expect(plain).not.toContain("aria-describedby");
  });

  it("puts the block in its own Stack with no spacing, and every box in it is dense", () => {
    expect(PAGE).toContain('<Stack spacing={0} sx={{ gap: `${CONSENT_DENSITY.rowGapPx}px`, minWidth: 0 }} data-testid="registration-consents">');
    const boxes = BLOCK.match(/<CheckboxField\b[\s\S]*?>/g) ?? [];
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (const box of boxes) expect(box, box).toMatch(/\bdense\b/);
    // The helpers are the boxes' own captions now, never a body2 paragraph under them.
    expect(BLOCK).not.toMatch(/<Typography variant="body2" color="text.secondary" data-testid="(list-opt-in-states|list-socials-help|promo-consent-help)"/);
    for (const id of ["list-opt-in-states", "list-socials-help", "promo-consent-help"]) expect(BLOCK).toContain(`helpTestId="${id}"`);
  });

  it("makes the race's conditions a regular-height button with its glyph, and keeps the gate", () => {
    expect(GATE).toContain('import MenuBookIcon from "@mui/icons-material/MenuBook";');
    expect(GATE).toContain("startIcon={<MenuBookIcon fontSize=\"small\" />}");
    expect(GATE).toContain('display: "inline-flex"');
    expect(GATE).not.toContain("minHeight: 48");
    expect(GATE).not.toMatch(/flex: 1,\s*minHeight/);
    // Unread, a press on the box opens the text and does not tick it (§195, §422).
    expect(GATE).toMatch(/if \(!readToEnd\) \{\s*setOpen\(true\);\s*return;\s*\}/);
    expect(GATE).toContain('variant="caption" color="text.secondary" data-testid="rules-hint"');
  });

  it("keeps every word the legal reviews fixed", () => {
    expect(ro.Registration.terms.accept).toContain("(versiunea {version}), inclusiv, în mod expres, clauzele despre anularea sau modificarea evenimentului");
    expect(ro.Registration.fitnessDeclared).toBe("Declar pe propria răspundere că sunt apt medical să particip.");
    expect(ro.Registration.rules.open).toBe("Citește condițiile concursului");
    expect(BLOCK).toContain('t.rich("terms.accept"');
    expect(BLOCK).toContain('t("fitnessDeclared")');
    expect(BLOCK).toContain('t("privacyLinkLabel")');
  });
});
