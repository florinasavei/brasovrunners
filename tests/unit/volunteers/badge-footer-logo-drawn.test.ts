import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BadgeDesign, type BadgeFaceRole, badgeWords, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { BADGE_FOOTER_LOGO_OPACITY, type BadgeFooterLogo, badgeImageSize, badgePaper, badgeSheetSlots } from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout, badgeMarkup, renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeSheetOrder, renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";

/**
 * §NNN — «Logo-ul clubului jos, ca filigran» drawn (BR-REQ-050-02): with a level chosen, the sheet draws the club's lockup once on every
 * badge — a role's, a role under a category, «fără rol», the one badge for everyone — at the layout's box and the level's opacity, first in
 * the writing area, so «Nume:», the lines and the marker's area go over it; the picture's markup has the same lockup at the same box and
 * opacity, so the PDF and the PNG agree; off, neither draws it (the drawing of before is held whole in `badge-type-unchanged.test.ts`).
 *
 * `BADGE_SAMPLE_DIR=<folder>` writes a sheet and pictures at every level there, to look at.
 */

const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const wordsOf = (design: BadgeDesign) => badgeWords(design, "ro", "Brașov Trail Race", RO);
const AT = new Date("2026-11-17T08:00:00.000Z");
const LEVELS = ["faint", "medium", "strong"] as const satisfies readonly BadgeFooterLogo[];
const ROLES: BadgeFaceRole[] = [
  { name: "Punct de apă", colour: "#c62828", phone: null, category: null },
  { name: "Direcționare", colour: null, phone: null, category: "Pe Traseu" },
];
/** Every row and area a badge can have: the free-text line, the marker's area, the telephone. */
const EXTRAS: Partial<BadgeDesign> = {
  showPhone: true,
  phone: "0712 345 678",
  showFreeText: true,
  freeTextRo: "Hidratează-te la fiecare punct",
  freeTextEn: "Drink at every point",
  showMarker: true,
  markerLabelRo: "Tură",
  markerLabelEn: "Shift",
};

/** What a call's argument is, as data: numbers and words as they are, anything else named. */
function plain(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return "[bytes]";
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return `[${(value as object).constructor?.name ?? "object"}]`;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

type Call = [string, ...unknown[]];
const DRAWING = ["addPage", "text", "font", "fontSize", "fillColor", "rect", "fill", "moveTo", "lineTo", "stroke", "image", "save", "restore", "opacity"] as const;

/** Every drawing call the sheet makes to pdfkit, in order, with its arguments. */
async function sheetCalls(design: BadgeDesign, entries: Parameters<typeof renderBadgeSheet>[0]["entries"]): Promise<Call[]> {
  const calls: Call[] = [];
  const prototype = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of DRAWING) {
    const original = prototype[name];
    vi.spyOn(prototype, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls.push([name, ...args.map(plain)]);
      return original.apply(this, args);
    });
  }
  try {
    await renderBadgeSheet({ design, locale: "ro", words: wordsOf(design), entries, eventTitle: "Brașov Trail Race", generatedAt: AT });
  } finally {
    vi.restoreAllMocks();
  }
  return calls;
}

/** A React tree as plain data: each element's type, its props but the children, and its children. */
type Node = { type: string; props: Record<string, unknown>; children: unknown };
function tree(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.filter((child) => child !== null && child !== undefined && typeof child !== "boolean").map(tree);
  if (!isValidElement(node)) return node ?? null;
  const { children, ...props } = node.props as { children?: ReactNode } & Record<string, unknown>;
  return { type: typeof node.type === "string" ? node.type : "fragment", props, children: tree(children) };
}
/** The elements of a markup, in drawing order (later ones paint over earlier ones). */
function elements(markup: ReactNode): Node[] {
  const out: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object" && "type" in node) {
      out.push(node as Node);
      walk((node as Node).children);
    }
  };
  walk(tree(markup));
  return out;
}
const byTestId = (nodes: Node[], id: string) => nodes.filter((node) => node.props["data-testid"] === id);

afterEach(() => vi.restoreAllMocks());

describe("§NNN the sheet draws the club's logo as a watermark", () => {
  const entries = [
    { role: ROLES[0], count: 2 },
    { role: ROLES[1], count: 1 },
    { role: null, count: 1 },
  ];

  it.each(LEVELS)("draws it once on every badge, at the layout's box and the %s level's opacity, first in the writing area", async (level) => {
    for (const design of [
      { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const, footerLogo: level },
      { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const, ...EXTRAS, footerLogo: level },
      { ...DEFAULT_BADGE_DESIGN, ...EXTRAS, size: "strip100" as const, footerLogo: level },
    ]) {
      // The one badge for everyone prints one pile with no role; the badges per role a pile each and «fără rol».
      const piles = design.mode === "single" ? [{ role: null, count: 3 }] : entries;
      const calls = await sheetCalls(design, piles);
      const badges = badgeSheetOrder(piles);
      const slots = badgeSheetSlots(badges.length, badgePaper(design));
      const opacities = calls.flatMap((call, index) => (call[0] === "opacity" ? [index] : []));
      expect(opacities).toHaveLength(badges.length);
      for (const [n, role] of badges.entries()) {
        const box = badgeImageLayout({ design, locale: "ro", words: wordsOf(design), role }).footerLogo!;
        expect(box.opacity).toBe(BADGE_FOOTER_LOGO_OPACITY[level]);
        const at = opacities[n];
        // Its own graphics state: saved, made pale, the lockup drawn, restored — nothing else drawn at that opacity.
        expect(calls[at - 1][0]).toBe("save");
        expect(calls[at]).toEqual(["opacity", BADGE_FOOTER_LOGO_OPACITY[level]]);
        expect(calls[at + 1]).toEqual(["image", expect.anything(), slots[n].x + box.left, slots[n].y + box.top, { fit: [box.width, box.height], align: "center", valign: "center" }]);
        // First in the writing area: the next words drawn are «Nume:», and no line, rectangle or picture comes between — only the
        // graphics states closing (pdfkit's own round the picture, then the one saved before the opacity) and the font being set.
        const next = calls.findIndex((call, index) => index > at + 1 && call[0] === "text");
        expect(calls[next][1]).toBe("Nume:");
        const between = calls.slice(at + 2, next).map((call) => call[0]);
        expect(between.every((name) => ["save", "restore", "font", "fontSize", "fillColor"].includes(name)), between.join(" ")).toBe(true);
        expect(between.filter((name) => name === "restore").length - between.filter((name) => name === "save").length).toBe(1);
        // The free-text line is under the role's band, outside the writing area: drawn before it, when there is one.
        const previous = calls.slice(0, at).filter((call) => call[0] === "text").at(-1);
        expect(previous?.[1]).not.toBe("Nume:");
        if (design.showFreeText) expect(previous?.[1]).toBe("Hidratează-te la fiecare punct");
      }
      // The lockup drawn twice per badge — the header's and the watermark — and never anywhere else.
      expect(calls.filter((call) => call[0] === "image")).toHaveLength(2 * badges.length);
    }
  });

  it("draws nothing of it while off: no opacity changed, the header's lockup alone", async () => {
    const calls = await sheetCalls({ ...DEFAULT_BADGE_DESIGN, mode: "perRole", ...EXTRAS }, entries);
    expect(calls.some((call) => call[0] === "opacity" || call[0] === "fillOpacity")).toBe(false);
    expect(calls.filter((call) => call[0] === "image")).toHaveLength(badgeSheetOrder(entries).length);
  });

  it("draws it under a header that is the club's picture, where the header's lockup is not drawn", async () => {
    // A header picture hides the header's logo (the bib's §249 rule); the watermark is the writing area's and stays.
    const layout = badgeImageLayout({ design: { ...DEFAULT_BADGE_DESIGN, footerLogo: "medium" }, locale: "ro", words: wordsOf(DEFAULT_BADGE_DESIGN), role: null, headerPicture: { src: "x", width: 10, height: 2 } });
    expect(layout.logo).toBeNull();
    expect(layout.footerLogo).toMatchObject({ opacity: BADGE_FOOTER_LOGO_OPACITY.medium });
  });
});

describe("§NNN the picture draws the same watermark", () => {
  it.each(LEVELS)("has the lockup at the layout's box and the %s level's opacity, before «Nume:», and the PDF puts it at the same place", async (level) => {
    for (const design of [{ ...DEFAULT_BADGE_DESIGN, footerLogo: level }, { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const, ...EXTRAS, size: "custom" as const, customWidthMm: 60, customHeightMm: 34, footerLogo: level }]) {
      for (const role of design.mode === "single" ? [null] : [...ROLES, null]) {
        const input = { design, locale: "ro" as const, words: wordsOf(design), role };
        const layout = badgeImageLayout(input);
        const box = layout.footerLogo!;
        const nodes = elements(badgeMarkup(input, "data:image/png;base64,LOGO"));
        const [mark] = byTestId(nodes, "badge-footer-logo");
        expect(byTestId(nodes, "badge-footer-logo")).toHaveLength(1);
        expect(mark.type).toBe("img");
        // The same file as the header's lockup: the logo the club's file draws, never another picture.
        expect(mark.props.src).toBe("data:image/png;base64,LOGO");
        // Under every word of the writing area: drawn before «Nume:», the line and the marker's area.
        const order = (id: string) => nodes.findIndex((node) => node.props["data-testid"] === id);
        for (const id of ["badge-name", "badge-line", "badge-divider", "badge-marker-line", "badge-marker-label", "badge-phone"]) {
          if (order(id) >= 0) expect(order("badge-footer-logo"), id).toBeLessThan(order(id));
        }
        // The picture's box, read back into the sheet's points: the paper's edge (the band's offset) and the picture's scale undone.
        const { scale } = badgeImageSize(design);
        const [band] = byTestId(nodes, "badge-header-band");
        const edge = layout.content.left * scale - (band.props.style as { left: number }).left;
        const style = mark.props.style as { left: number; top: number; opacity: number; objectFit: string };
        expect(style.opacity).toBe(BADGE_FOOTER_LOGO_OPACITY[level]);
        expect(style.objectFit).toBe("contain");
        expect((style.left + edge) / scale).toBeCloseTo(box.left, 9);
        expect((style.top + edge) / scale).toBeCloseTo(box.top, 9);
        expect((mark.props.width as number) / scale).toBeCloseTo(box.width, 9);
        expect((mark.props.height as number) / scale).toBeCloseTo(box.height, 9);
        // The PDF's watermark for the same badge: the same box from the badge's corner, the same opacity.
        const calls = await sheetCalls(design, [{ role, count: 1 }]);
        const slot = badgeSheetSlots(1, badgePaper(design))[0];
        const at = calls.findIndex((call) => call[0] === "opacity");
        const [, , x, y, options] = calls[at + 1] as [string, unknown, number, number, { fit: [number, number] }];
        expect(calls[at][1]).toBe(style.opacity);
        expect(x - slot.x).toBeCloseTo((style.left + edge) / scale, 9);
        expect(y - slot.y).toBeCloseTo((style.top + edge) / scale, 9);
        expect(options.fit[0]).toBeCloseTo((mark.props.width as number) / scale, 9);
        expect(options.fit[1]).toBeCloseTo((mark.props.height as number) / scale, 9);
      }
    }
  });

  it("draws nothing of it while off", () => {
    const nodes = elements(badgeMarkup({ design: { ...DEFAULT_BADGE_DESIGN, ...EXTRAS }, locale: "ro", words: wordsOf({ ...DEFAULT_BADGE_DESIGN, ...EXTRAS }), role: null }, "logo"));
    expect(byTestId(nodes, "badge-footer-logo")).toHaveLength(0);
    expect(nodes.some((node) => (node.props.style as { opacity?: number } | undefined)?.opacity === BADGE_FOOTER_LOGO_OPACITY.faint)).toBe(false);
  });

  it("renders a PNG of the paper's proportion with the watermark", async () => {
    const design = { ...DEFAULT_BADGE_DESIGN, footerLogo: "strong" as const };
    const image = await renderBadgeImage({ design, locale: "ro", words: wordsOf(design), role: null });
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(960);
    expect(bytes.readUInt32BE(20)).toBe(373);
  }, 60_000);

  it("writes samples to look at, when asked", async () => {
    const folder = process.env.BADGE_SAMPLE_DIR;
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    const sizes = { strip90: {}, strip100: { size: "strip100" as const }, custom60x30: { size: "custom" as const, customWidthMm: 60, customHeightMm: 30 }, custom60x100: { size: "custom" as const, customWidthMm: 60, customHeightMm: 100 } };
    for (const level of ["off", ...LEVELS] as const) {
      for (const [name, size] of Object.entries(sizes)) {
        for (const [extrasName, extras] of [["plain", {}], ["extras", EXTRAS]] as const) {
          const design: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole", ...size, ...extras, footerLogo: level };
          if (name === "custom60x30" && extrasName === "extras") continue;
          const image = await renderBadgeImage({ design, locale: "ro", words: wordsOf(design), role: ROLES[1] });
          writeFileSync(path.join(folder, `badge-footer-logo-${level}-${name}-${extrasName}.png`), Buffer.from(await image.arrayBuffer()));
        }
      }
      const design: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole", footerLogo: level };
      writeFileSync(
        path.join(folder, `badges-footer-logo-${level}.pdf`),
        await renderBadgeSheet({ design, locale: "ro", words: wordsOf(design), entries: [{ role: ROLES[0], count: 4 }, { role: ROLES[1], count: 4 }, { role: null, count: 2 }], eventTitle: "Brașov Trail Race", generatedAt: AT }),
      );
    }
  }, 120_000);
});
