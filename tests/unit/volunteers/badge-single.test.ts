import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import {
  BADGE_MODES,
  type BadgeDesign,
  badgeColourReadable,
  badgeDesignDropped,
  badgeDesignFromQuery,
  badgeNoRoleColour,
  badgePhoneRow,
  badgeRoleColour,
  badgeTextOn,
  badgeWords,
  DEFAULT_BADGE_DESIGN,
  readBadgeDesign,
} from "@/modules/volunteers/badges/badge-design";
import { badgeImageLayout, badgeMarkup, renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeDesignQuery, badgeDesignValuesFromQuery, postedSingleColour, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import {
  BADGE_COUNT_MAX,
  BADGE_SINGLE_FALLBACK,
  BADGE_TOTAL_MAX,
  badgePrintEntries,
  badgeSingleDefault,
  badgeSingleStart,
  readPrintCounts,
} from "@/modules/volunteers/badges/badges";
import { badgeSheetOrder, renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { COLOR } from "@/theme/brand";

/**
 * §NNN — one volunteer badge for everyone, no role (the owner, 2026-10-15: «aș vrea să am un singur ecuson de voluntari, fără roluri»), the
 * default for every design: the choice and its forgiving read, the band's words and colour at AA, the count's start and the spares, the sheet
 * and the picture of the one badge, and the badge per role (§764) untouched beside it.
 *
 * `BADGE_SAMPLE_DIR=<folder>` writes the single-mode sample picture and sheet there, to look at.
 */

const DEFAULTS = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const CHOSEN = "#c62828";
const SINGLE: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, singleColour: CHOSEN };
const wordsOf = (design: BadgeDesign, locale: "ro" | "en" = "ro") => badgeWords(design, locale, "Brașov Trail Race", locale === "ro" ? DEFAULTS : { label: "VOLUNTEER", name: "Name:", phoneLabel: "Coordinator" });

afterEach(() => vi.restoreAllMocks());

describe("§NNN the mode: one badge for everyone is the default", () => {
  it("is `single` for a design that never chose — null, empty, a design from before the choice, a stored design without the key", () => {
    expect(DEFAULT_BADGE_DESIGN.mode).toBe("single");
    expect(DEFAULT_BADGE_DESIGN.singleColour).toBeNull();
    expect(readBadgeDesign(null).mode).toBe("single");
    expect(readBadgeDesign({}).mode).toBe("single");
    expect(readBadgeDesign(undefined).mode).toBe("single");
    // A design as the column held it before this release: every §764 and §776 key, no `mode` and no `singleColour`.
    const old: Record<string, unknown> = { ...DEFAULT_BADGE_DESIGN, size: "strip100", bandColour: "#c62828", showPhone: true, phone: "0712 345 678" };
    delete old.mode;
    delete old.singleColour;
    expect(readBadgeDesign(old)).toMatchObject({ mode: "single", singleColour: null, size: "strip100", bandColour: "#c62828", phone: "0712 345 678" });
    // An old design has nothing to say about it: absent is not unreadable.
    expect(badgeDesignDropped(old)).toEqual([]);
    expect(badgeDesignDropped(null)).toEqual([]);
  });

  it("keeps `perRole` where the design chose it, and offers exactly the two choices", () => {
    expect(BADGE_MODES).toEqual(["single", "perRole"]);
    expect(readBadgeDesign({ mode: "perRole" }).mode).toBe("perRole");
    expect(readBadgeDesign({ mode: "single" }).mode).toBe("single");
  });

  it("reads a mode no one knows, or of the wrong type, as `single` — never a throw — and names it for the designer", () => {
    for (const bad of ["everyone", "PERROLE", 3, true, ["perRole"], {}]) {
      expect(readBadgeDesign({ mode: bad }).mode).toBe("single");
    }
    expect(badgeDesignDropped({ mode: "everyone" })).toEqual(["mode"]);
    expect(badgeDesignDropped({ mode: 3 })).toEqual(["mode"]);
    expect(badgeDesignDropped({ mode: "perRole" })).toEqual([]);
    expect(badgeDesignDropped({ mode: null })).toEqual([]);
    expect(badgeDesignDropped({ singleColour: 5 })).toEqual(["singleColour"]);
    expect(badgeDesignDropped({ singleColour: CHOSEN })).toEqual([]);
    // The rest of the design reads as it stands whatever the mode held.
    expect(readBadgeDesign({ mode: 3, size: "strip100", showLogo: false })).toMatchObject({ mode: "single", size: "strip100", showLogo: false });
  });

  it("travels in the preview's address and the form's boxes as it was chosen", () => {
    const perRole = badgeDesignQuery({ ...DEFAULT_BADGE_DESIGN, mode: "perRole" });
    expect(perRole.get("mode")).toBe("perRole");
    expect(badgeDesignFromQuery(perRole).mode).toBe("perRole");
    expect(badgeDesignFromQuery(badgeDesignQuery(SINGLE))).toMatchObject({ mode: "single", singleColour: CHOSEN });
    // An address with no `mode` (an older one) is the default.
    expect(badgeDesignFromQuery(new URLSearchParams("size=strip100")).mode).toBe("single");
    expect(badgeDesignValuesFromQuery(new URLSearchParams("mode=perRole")).mode).toBe("perRole");
    const form: Record<string, string> = { "badge.design.mode": "perRole", "badge.design.singleColourChoice": CHOSEN, "badge.design.singleColourTyped": "" };
    expect(readBadgeDesignForm((name) => form[name] ?? null)).toMatchObject({ mode: "perRole", singleColour: CHOSEN, singleColourChoice: CHOSEN });
  });
});

describe("§NNN the one badge's band: words and colour", () => {
  it("says the club's «VOLUNTAR» alone — in capitals, in the badge's language — and no role anywhere", () => {
    const ro = JSON.stringify(badgeMarkup({ design: SINGLE, locale: "ro", words: wordsOf(SINGLE), role: null }, ""));
    expect(ro).toContain("VOLUNTAR");
    expect(ro).toContain("badge-role-band");
    // «VOLUNTAR» is the band's one large line: the small word above a role's name is not drawn.
    expect(ro).not.toContain("badge-label");
    const en = JSON.stringify(badgeMarkup({ design: SINGLE, locale: "en", words: wordsOf(SINGLE, "en"), role: null }, ""));
    expect(en).toContain("VOLUNTEER");
    expect(en).not.toContain("VOLUNTAR");
    // The club's own typed words win over the platform's, as §764 has them.
    const staff: BadgeDesign = { ...SINGLE, labelRo: "STAFF", labelEn: "CREW" };
    expect(JSON.stringify(badgeMarkup({ design: staff, locale: "ro", words: wordsOf(staff), role: null }, ""))).toContain("STAFF");
    const layout = badgeImageLayout({ design: SINGLE, locale: "ro", words: wordsOf(SINGLE), role: null });
    expect(layout.label).toBeNull();
    expect(layout.roleLine.text).toBe("VOLUNTAR");
  });

  it("paints the band in the colour the design chose, with white or ink on it, whichever reads", () => {
    const markup = badgeMarkup({ design: SINGLE, locale: "ro", words: wordsOf(SINGLE), role: null }, "");
    const band = JSON.stringify(markup);
    expect(band).toContain(CHOSEN);
    expect(badgeNoRoleColour(SINGLE)).toBe(CHOSEN);
    expect(badgeTextOn(CHOSEN)).toBe(COLOR.surface);
    // No colour chosen: the club's orange, as the badges «fără rol» always wore.
    expect(badgeNoRoleColour(DEFAULT_BADGE_DESIGN)).toBe(COLOR.orange);
    expect(JSON.stringify(badgeMarkup({ design: DEFAULT_BADGE_DESIGN, locale: "ro", words: wordsOf(DEFAULT_BADGE_DESIGN), role: null }, ""))).toContain(COLOR.orange);
  });

  it("carries its words at AA on every colour the designer offers, and on the club's orange", () => {
    for (const choice of [{ hex: COLOR.orange }, ...BIB_COLOURS].filter((option) => badgeColourReadable(option.hex))) {
      expect(contrastRatio(badgeTextOn(choice.hex), choice.hex)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const design: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, singleColour: choice.hex };
      expect(readBadgeDesign(design).singleColour).toBe(choice.hex);
      expect(badgeNoRoleColour(design)).toBe(choice.hex);
    }
    // The palette's green does not carry white or ink at 4.5 : 1: it is never offered, and a typed or stored one reads as the club's orange.
    expect(BIB_COLOURS.filter((option) => !badgeColourReadable(option.hex)).map((option) => option.key)).toEqual(["green"]);
    expect(readBadgeDesign({ singleColour: "#1b8a3a" }).singleColour).toBeNull();
  });

  it("reads a colour no word reads on as the club's orange — checked again, as a role's is — and a colour that is no colour too", () => {
    for (const bad of ["#808080", "#7f7f7f", "808080", "#12", "green", "#GGGGGG", 7]) {
      expect(readBadgeDesign({ singleColour: bad }).singleColour).toBeNull();
      expect(badgeNoRoleColour(readBadgeDesign({ mode: "single", singleColour: bad }))).toBe(COLOR.orange);
    }
    expect(readBadgeDesign({ singleColour: "#C62828" }).singleColour).toBe(CHOSEN);
    // A design built in code with a colour that cannot be read on never prints it either.
    expect(badgeNoRoleColour({ mode: "single", singleColour: "#808080" })).toBe(COLOR.orange);
  });

  it("is chosen by the select and the typed box together: the empty choice, a palette colour, or the typed one", () => {
    expect(postedSingleColour("", "")).toBeNull();
    expect(postedSingleColour("", "#123456")).toBeNull();
    expect(postedSingleColour(CHOSEN, "")).toBe(CHOSEN);
    expect(postedSingleColour("typed", "#C62828")).toBe(CHOSEN);
    expect(postedSingleColour("typed", "c62828")).toBe(CHOSEN);
    // A typed text that is no colour, a choice that is no option: no colour, which the save refuses.
    expect(postedSingleColour("typed", "")).toBeUndefined();
    expect(postedSingleColour("typed", "green")).toBeUndefined();
    expect(postedSingleColour("pink", "")).toBeUndefined();
  });

  it("keeps the badge per role as it was: the role's own colour, and the orange on the badges «fără rol» whatever the single colour holds", () => {
    const perRole: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole", singleColour: CHOSEN };
    expect(badgeNoRoleColour(perRole)).toBe(COLOR.orange);
    const role = { name: "Punct de apă", colour: "#6a1b9a", phone: null };
    const withRole = JSON.stringify(badgeMarkup({ design: perRole, locale: "ro", words: wordsOf(perRole), role }, ""));
    expect(withRole).toContain("#6a1b9a");
    expect(withRole).toContain("PUNCT DE APĂ");
    expect(withRole).toContain("badge-label");
    expect(withRole).not.toContain(CHOSEN);
    expect(badgeRoleColour("#6a1b9a")).toBe("#6a1b9a");
    const none = JSON.stringify(badgeMarkup({ design: perRole, locale: "ro", words: wordsOf(perRole), role: null }, ""));
    expect(none).toContain(COLOR.orange);
    expect(none).not.toContain(CHOSEN);
  });
});

describe("§NNN the telephone on the one badge", () => {
  it("keeps the row only with a number typed: the one badge has no category to take one from", () => {
    expect(badgePhoneRow({ mode: "single", showPhone: true, phone: "" })).toBe(false);
    expect(badgePhoneRow({ mode: "single", showPhone: true, phone: "0712 345 678" })).toBe(true);
    expect(badgePhoneRow({ mode: "single", showPhone: false, phone: "0712 345 678" })).toBe(false);
    // The badges per role keep §774's rule: the row stays on while the tick is on, blank where no category has a number.
    expect(badgePhoneRow({ mode: "perRole", showPhone: true, phone: "" })).toBe(true);
    expect(badgePhoneRow({ mode: "perRole", showPhone: false, phone: "" })).toBe(false);
    const ticked: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, showPhone: true };
    expect(badgeImageLayout({ design: ticked, locale: "ro", words: wordsOf(ticked), role: null }).phone).toBeNull();
    const typed: BadgeDesign = { ...ticked, phone: "0712 345 678" };
    expect(JSON.stringify(badgeMarkup({ design: typed, locale: "ro", words: wordsOf(typed), role: null }, ""))).toContain("Coordonator: 0712 345 678");
  });
});

describe("§NNN «Câte ecusoane»: where it starts, and the spares", () => {
  it("starts at the confirmed volunteers; else what the roles need together; else ten", () => {
    expect(badgeSingleDefault({ confirmed: 37, needed: 20 })).toBe(37);
    expect(badgeSingleDefault({ confirmed: 0, needed: 20 })).toBe(20);
    expect(badgeSingleDefault({ confirmed: 0, needed: 0 })).toBe(10);
    expect(BADGE_SINGLE_FALLBACK).toBe(10);
    expect(badgeSingleStart({ confirmed: 37, needed: 20 })).toEqual({ count: 37, basis: "confirmed" });
    expect(badgeSingleStart({ confirmed: 0, needed: 20 })).toEqual({ count: 20, basis: "needed" });
    expect(badgeSingleStart({ confirmed: 0, needed: 0 })).toEqual({ count: 10, basis: "fallback" });
    // Never more than a file holds, so the form the page draws is always one the sheet takes.
    expect(badgeSingleDefault({ confirmed: 4000, needed: 0 })).toBe(BADGE_TOTAL_MAX);
  });

  it("reads «Câte ecusoane» and «În plus» of the one pile: a box left out is its default, a box emptied is none", () => {
    expect(readPrintCounts(new URLSearchParams(), [], { defaultCount: 37 })).toEqual({ roles: new Map(), none: 0, single: { count: 37, spares: 0 } });
    expect(readPrintCounts(new URLSearchParams("all=40&allx=5"), [], { defaultCount: 37 })).toMatchObject({ single: { count: 40, spares: 5 } });
    expect(readPrintCounts(new URLSearchParams("all=&allx=3"), [], { defaultCount: 37 })).toMatchObject({ single: { count: 0, spares: 3 } });
    // The whole pile is everyone: a box may hold up to a file's worth, past the 300 a role's pile holds.
    expect(readPrintCounts(new URLSearchParams(`all=${BADGE_COUNT_MAX + 1}`), [], { defaultCount: 5 })).toMatchObject({ single: { count: 301 } });
    expect(readPrintCounts(new URLSearchParams(`all=${BADGE_TOTAL_MAX}`), [], { defaultCount: 5 })).toMatchObject({ single: { count: 1000, spares: 0 } });
  });

  it("refuses what is not a whole number from 0 to a file's worth, and a total past it", () => {
    for (const query of ["all=-1", "all=2.5", "all=abc", "allx=-3", `all=${BADGE_TOTAL_MAX + 1}`, `allx=${BADGE_TOTAL_MAX + 1}`]) {
      expect(readPrintCounts(new URLSearchParams(query), [], { defaultCount: 5 })).toEqual({ refused: "number" });
    }
    expect(readPrintCounts(new URLSearchParams(`all=${BADGE_TOTAL_MAX}&allx=1`), [], { defaultCount: 5 })).toEqual({ refused: "total" });
    expect(readPrintCounts(new URLSearchParams("all=990&allx=10"), [], { defaultCount: 5 })).toMatchObject({ single: { count: 990, spares: 10 } });
  });

  it("does not read the roles' boxes nor «Ecusoane fără rol» of the one badge", () => {
    const roles = [{ id: "a", needed: 3 }];
    const counts = readPrintCounts(new URLSearchParams("n.a=7&x.a=2&none=9&all=4"), roles, { defaultCount: 5 });
    expect(counts).toEqual({ roles: new Map(), none: 0, single: { count: 4, spares: 0 } });
    // Without `single` the same query is the badges per role, as §764 reads it.
    expect(readPrintCounts(new URLSearchParams("n.a=7&x.a=2&none=9&all=4"), roles)).toMatchObject({ roles: new Map([["a", { count: 7, spares: 2 }]]), none: 9 });
  });

  it("hands the sheet one pile with no role, N plus the spares, however many roles the event has", () => {
    const role = { id: "a", nameRo: "Punct de apă", nameEn: "Water", needed: 3, colour: "#c62828", position: 0, createdAt: new Date(), categoryId: null, categoryRo: null, categoryEn: null, categoryPhone: null };
    const counts = readPrintCounts(new URLSearchParams("all=40&allx=5"), [role], { defaultCount: 5 });
    if ("refused" in counts) throw new Error("refused");
    expect(badgePrintEntries([role, { ...role, id: "b" }], counts, "ro")).toEqual([{ role: null, count: 45 }]);
    const nothing = readPrintCounts(new URLSearchParams("all=&allx="), [role], { defaultCount: 5 });
    if ("refused" in nothing) throw new Error("refused");
    expect(badgePrintEntries([role], nothing, "ro")).toEqual([]);
  });
});

describe("§NNN the sheet and the picture of the one badge", () => {
  const entries = [{ role: null, count: 45 }];
  const render = (design: BadgeDesign = SINGLE) =>
    renderBadgeSheet({ design, locale: "ro", words: wordsOf(design), entries, eventTitle: "Brașov Trail Race", generatedAt: new Date("2026-10-15T08:00:00Z") });

  async function drawn(design?: BadgeDesign) {
    // A second call in one case would spy on the first call's spy: start from the real methods.
    vi.restoreAllMocks();
    const runs: string[] = [];
    const fills: string[] = [];
    let pages = 0;
    const text = PDFDocument.prototype.text;
    const addPage = PDFDocument.prototype.addPage;
    const fill = PDFDocument.prototype.fill;
    vi.spyOn(PDFDocument.prototype, "addPage").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      pages += 1;
      return (addPage as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      if (typeof args[0] === "string") runs.push(args[0]);
      return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    vi.spyOn(PDFDocument.prototype, "fill").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      if (typeof args[0] === "string") fills.push(args[0]);
      return (fill as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    const pdf = await render(design);
    return { runs, fills, pages, pdf };
  }

  it("prints N plus the spares of «VOLUNTAR» alone, on as many A4 pages as they take — no role's name anywhere", async () => {
    const { runs, pages, pdf } = await drawn();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("(45 badges)");
    expect(badgeSheetOrder(entries)).toHaveLength(45);
    // 90 × 35 mm: 16 to a sheet, so 45 badges take 3 pages.
    expect(pages).toBe(3);
    expect(runs.filter((text) => text === "VOLUNTAR")).toHaveLength(45);
    expect(runs.filter((text) => text === "Nume:")).toHaveLength(45);
    expect(runs.filter((text) => text === "Brașov Trail Race")).toHaveLength(45);
  });

  it("paints every badge's band in the colour of the design", async () => {
    const { fills } = await drawn();
    expect(fills.filter((colour) => colour === CHOSEN)).toHaveLength(45);
    // The club's orange where the design chose none.
    expect((await drawn(DEFAULT_BADGE_DESIGN)).fills.filter((colour) => colour === COLOR.orange)).toHaveLength(45);
  });

  it("prints the free-text line and the marker's area on the one badge too (§776), and the typed telephone", async () => {
    const design: BadgeDesign = { ...SINGLE, showFreeText: true, freeTextRo: "Bea apă", freeTextEn: "Drink", showMarker: true, markerLabelRo: "Tură", markerLabelEn: "Shift", showPhone: true, phone: "0712 345 678" };
    const { runs } = await drawn(design);
    expect(runs.filter((text) => text === "Bea apă")).toHaveLength(45);
    expect(runs.filter((text) => text === "Tură:")).toHaveLength(45);
    expect(runs.filter((text) => text === "Coordonator: 0712 345 678")).toHaveLength(45);
  });

  it("draws a sample picture of the one badge: the band's colour, «VOLUNTAR», no role (and writes it to look at when asked)", async () => {
    const image = await renderBadgeImage({ design: SINGLE, locale: "ro", words: wordsOf(SINGLE), role: null });
    const png = Buffer.from(await image.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.byteLength).toBeGreaterThan(2_000);
    const folder = process.env.BADGE_SAMPLE_DIR;
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "badge-single.png"), png);
    const extras: BadgeDesign = { ...SINGLE, titleRo: "Crosul Brașovului", titleEn: "Brașov Run", showFreeText: true, freeTextRo: "Bea apă la fiecare punct", freeTextEn: "Drink water at every point", showMarker: true, markerLabelRo: "Tură", markerLabelEn: "Shift", showPhone: true, phone: "0712 345 678" };
    writeFileSync(path.join(folder, "badge-single-extras.png"), Buffer.from(await (await renderBadgeImage({ design: extras, locale: "ro", words: wordsOf(extras), role: null })).arrayBuffer()));
    writeFileSync(path.join(folder, "badge-single-default.png"), Buffer.from(await (await renderBadgeImage({ design: DEFAULT_BADGE_DESIGN, locale: "ro", words: wordsOf(DEFAULT_BADGE_DESIGN), role: null })).arrayBuffer()));
    writeFileSync(path.join(folder, "badges-single.pdf"), await render(extras));
  }, 60_000);
});
