import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import CheckboxField from "@/shared/ui/CheckboxField";
import { CONSENT_DENSITY } from "@/shared/ui/consent-density";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * §570 — the registration form's «Acorduri» block, compacted (the owner, 2026-09-29 19:03: "Also
 * these need to be more compacted!"), with every word the legal reviews fixed (§425, §556).
 *
 * The heights, pinned as the numbers `CONSENT_DENSITY` documents: a row is `max(44, 24 + 20 × lines)`
 * pixels with no gap between rows — it was `max(48, 24 × lines) + 16`. Five one-line rows are
 * 5 × 44 = 220 px where they were 5 × 64 − 16 = 304; a label that wraps to four lines at 320 px is
 * 104 where it was 96 + 16 = 112, and every line of the block is 20 px where it was 24.
 */
const PAGE = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "events", "[slug]", "register", "page.tsx"), "utf8");
const GATE = readFileSync(path.join(process.cwd(), "src", "modules", "registrations", "ui", "ReadAndAgree.tsx"), "utf8");
const DECLARE = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "registrations", "declare", "[token]", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
/** The block: from the «Acorduri» heading to the end of its own Stack. */
const BLOCK = PAGE.slice(PAGE.indexOf('t("sections.consents")'), PAGE.indexOf("</Stack>", PAGE.indexOf('data-testid="registration-consents"')));

const rowHeight = (lines: number) => Math.max(CONSENT_DENSITY.rowMinHeightPx, 24 + 20 * lines) + CONSENT_DENSITY.rowGapPx;

describe("§570 the «Acorduri» block's density", () => {
  it("pins the numbers: a 44-pixel small box, body2 labels, no gap between rows", () => {
    expect(CONSENT_DENSITY).toMatchObject({ checkboxSize: "small", rowMinHeightPx: 44, labelVariant: "body2", rowGapPx: 0 });
    // The small glyph is 20 px; the tap target's 12 on each side make it 44 — never under the thumb's rule.
    expect(CHECKBOX_TAP_TARGET).toEqual({ p: 1.5 });
    expect(20 + 2 * 12).toBe(CONSENT_DENSITY.rowMinHeightPx);
    expect(CONSENT_DENSITY.rowSx["& .MuiFormControlLabel-label"]).toEqual({ py: "12px" });
    // Under the words, after the glyph's column: the box's 44 − 11, the 20-pixel glyph, the 6 after it.
    expect(CONSENT_DENSITY.helpSx).toEqual({ display: "block", mt: "-8px", pl: "59px" });
    expect(33 + CONSENT_DENSITY.glyphPx + CONSENT_DENSITY.glyphGapPx).toBe(59);
    expect(CONSENT_DENSITY.labelSx.pl).toBe(`${CONSENT_DENSITY.glyphPx + CONSENT_DENSITY.glyphGapPx}px`);
    expect(CONSENT_DENSITY.labelSx["& > .MuiSvgIcon-root:first-child"]).toMatchObject({ position: "absolute", left: 0, top: 0, fontSize: 20, color: "text.secondary" });
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

/**
 * §570 round 2 — the owner, 2026-09-29 19:33, of «Acorduri» on QA: «trebuie să scriem tot „— opțional”
 * la „Vreau să primesc oferte” și la lista de participanți & rezultate trebuie să punem un trofeu ca
 * iconiță pentru consistență; de fapt pentru fiecare bifă ne trebuie și o iconiță la început», and «e
 * destul de importantă partea asta cu acordurile!».
 */
describe("§570 round 2 every box of «Acorduri» leads with its glyph, and the optional ones say so", () => {
  /** Every `<CheckboxField …>…</CheckboxField>` in a source, whole. */
  const boxesIn = (source: string) => source.match(/<CheckboxField\b[\s\S]*?<\/CheckboxField>/g) ?? [];
  /** The first thing inside a box, past its comments. */
  const firstChild = (box: string) =>
    box
      .slice(box.indexOf(">", box.search(/\n\s*>|\S>\s*\n/)) + 1)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .trim();
  const GLYPHS: Record<string, string> = {
    rulesAcknowledged: "MenuBookIcon",
    termsAccepted: "DescriptionIcon",
    fitnessDeclared: "MedicalServicesIcon",
    privacyAcknowledged: "ShieldIcon",
    listOptIn: "EmojiEventsIcon",
    listSocials: "ShareIcon",
    promoConsent: "CampaignIcon",
  };

  it("starts every box of the block with its glyph, one per meaning — the trophy for the list and the results", () => {
    const boxes = boxesIn(BLOCK.replace(/\r\n/g, "\n"));
    expect(boxes).toHaveLength(Object.keys(GLYPHS).length);
    for (const box of boxes) {
      const name = /name="(\w+)"/.exec(box)?.[1] ?? "";
      expect(GLYPHS[name], box).toBeTruthy();
      expect(firstChild(box), name).toMatch(new RegExp(`^<${GLYPHS[name]} aria-hidden data-testid="(consent-glyph|promo-consent-glyph)" />`));
      // Sized and coloured by the one layout, never by hand on a box: the stray inline alignment is gone.
      expect(box, name).not.toMatch(/verticalAlign/);
    }
    // One glyph per meaning.
    expect(new Set(Object.values(GLYPHS)).size).toBe(Object.keys(GLYPHS).length);
    // The race's conditions without script: the book, like the button.
    expect(GATE).toContain('<MenuBookIcon aria-hidden data-testid="consent-glyph" />');
  });

  it("ends the three optional boxes with « — opțional» through the one prop, never typed into the words", () => {
    const boxes = boxesIn(BLOCK.replace(/\r\n/g, "\n"));
    for (const name of ["listOptIn", "listSocials", "promoConsent"]) {
      const box = boxes.find((one) => one.includes(`name="${name}"`)) ?? "";
      expect(box, name).toContain('optional={t("optionalSuffix")}');
      expect(box, name).not.toContain("— ${");
    }
    for (const name of ["rulesAcknowledged", "termsAccepted", "fitnessDeclared", "privacyAcknowledged"]) {
      const box = boxes.find((one) => one.includes(`name="${name}"`)) ?? "";
      expect(box, name).not.toContain("optional=");
      expect(box, name).toMatch(/\brequired\b/);
    }
    // The promo sentence keeps the owner's full stop (the box's words are what the notice quotes, §562);
    // the helper no longer opens with «Opțional.», which the label now says.
    expect(ro.Registration.promo.label.endsWith("săi.")).toBe(true);
    expect(ro.Registration.optionalSuffix).toBe("opțional");
    expect(en.Registration.optionalSuffix).toBe("optional");
    expect(ro.Registration.promo.help.startsWith("Opțional")).toBe(false);
    expect(en.Registration.promo.help.startsWith("Optional")).toBe(false);
  });

  it("draws the glyph, the words, « — opțional» and the required mark as one label", () => {
    const render = (props: Omit<ComponentProps<typeof CheckboxField>, "children">, ...children: unknown[]) =>
      renderToStaticMarkup(createElement(CheckboxField as (props: Omit<ComponentProps<typeof CheckboxField>, "children">) => ReactElement, props, ...(children as never[])));
    const glyph = createElement("svg", { className: "MuiSvgIcon-root", "aria-hidden": true, "data-testid": "consent-glyph" });
    const optional = render({ name: "listOptIn", dense: true, optional: ro.Registration.optionalSuffix }, glyph, ro.Registration.listOptIn);
    const text = optional.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    expect(text).toBe(`${ro.Registration.listOptIn} — opțional`);
    // The glyph is the label's first child, before any word.
    expect(optional).toMatch(/<span class="[^"]*"><svg class="MuiSvgIcon-root" aria-hidden="true" data-testid="consent-glyph"><\/svg>Vreau/);
    expect(optional).not.toContain("MuiFormControlLabel-asterisk");

    const required = render({ name: "fitnessDeclared", dense: true, required: true }, glyph, ro.Registration.fitnessDeclared);
    // One mark, after the last word, inside the label; the input itself is still required.
    expect(required.match(/MuiFormControlLabel-asterisk/g)).toHaveLength(1);
    expect(required).toMatch(/particip\.<span aria-hidden="true" class="MuiFormControlLabel-asterisk">\u2009\*<\/span>/);
    expect(required).toMatch(/<input[^>]*required=""/);
    // No `<div>` wrapper of MUI's own around the label and its mark.
    expect(required).not.toMatch(/MuiFormControlLabel-root[^>]*>(?:(?!<\/label>)[\s\S])*<div>/);
  });

  it("draws the family's copies on the declaration page the same way", () => {
    const boxes = boxesIn(DECLARE);
    const accepted = boxes.find((one) => one.includes('name="accepted"')) ?? "";
    const promo = boxes.find((one) => one.includes('name="promoConsent"')) ?? "";
    expect(accepted).toMatch(/\bdense\b/);
    expect(firstChild(accepted)).toMatch(/^<HistoryEduIcon aria-hidden data-testid="consent-glyph" \/>/);
    expect(promo).toMatch(/\bdense\b/);
    expect(promo).toContain('optional={formCopy("optionalSuffix")}');
    expect(promo).toContain('helpTestId="declare-promo-help"');
    expect(firstChild(promo)).toMatch(/^<CampaignIcon aria-hidden data-testid="promo-consent-glyph" \/>/);
  });
});
