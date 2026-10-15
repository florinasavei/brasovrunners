import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BadgeDesign, badgePhoneLine, badgeWords, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { badgeImageLayout, badgeMarkup } from "@/modules/volunteers/badges/badge-image";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";

/**
 * §774 — the coordinator's telephone on a role's badge, in both renderers (the sheet and the picture): the design's own number on every
 * role; else, with «Telefonul coordonatorului» ticked, the telephone of the contact person of the role's category — a badge with none says none,
 * and its layout gives the writing area the room.
 */
const DEFAULTS = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
// The badge per role (§764): the category's telephone is a thing of the roles; the one badge for everyone (§783, the default) has none, see `badge-single.test.ts`.
const ticked: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole", showPhone: true };
const WORDS = badgeWords(ticked, "ro", "Brașov Trail Race", DEFAULTS);

const ENTRIES = [
  { role: { name: "Direcționare", colour: "#c62828", phone: "+40712345678" }, count: 2 },
  { role: { name: "Direcționare", colour: "#c62828", phone: "+40799000111" }, count: 3 },
  { role: { name: "Foto/Video", colour: null, phone: null }, count: 1 },
  { role: null, count: 1 },
];

afterEach(() => vi.restoreAllMocks());

async function textsOf(render: () => Promise<Buffer>): Promise<string[]> {
  const runs: string[] = [];
  const text = PDFDocument.prototype.text;
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") runs.push(args[0]);
    return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await render();
  return runs;
}

const sheet = (design: BadgeDesign, words = badgeWords(design, "ro", "Brașov Trail Race", DEFAULTS)) =>
  renderBadgeSheet({ design, locale: "ro", words, entries: ENTRIES, eventTitle: "Brașov Trail Race", generatedAt: new Date("2026-10-14T08:00:00Z") });

describe("§774 the sheet: each role's telephone", () => {
  it("prints, on each pile, the telephone of its category — the same role under two categories, two numbers — and none where there is none", async () => {
    const runs = await textsOf(() => sheet(ticked));
    expect(runs.filter((run) => run === "Coordonator: +40 712 345 678")).toHaveLength(2);
    expect(runs.filter((run) => run === "Coordonator: +40 799 000 111")).toHaveLength(3);
    // «Foto/Video» (no category) and the badges «fără rol» carry no telephone line at all.
    expect(runs.filter((run) => run.startsWith("Coordonator:"))).toHaveLength(5);
    expect(runs.filter((run) => run === "FOTO/VIDEO")).toHaveLength(1);
    expect(runs.filter((run) => run === "DIRECȚIONARE")).toHaveLength(5);
  });

  it("prints the design's own number on every role, the category's none — as before", async () => {
    const typed: BadgeDesign = { ...ticked, phone: "0712 345 678" };
    const runs = await textsOf(() => sheet(typed));
    expect(runs.filter((run) => run === "Coordonator: 0712 345 678")).toHaveLength(7);
    expect(runs.some((run) => run.includes("+40799000111"))).toBe(false);
  });

  it("prints no telephone while the tick is off, whatever the categories hold", async () => {
    const runs = await textsOf(() => sheet(DEFAULT_BADGE_DESIGN));
    expect(runs.some((run) => run.startsWith("Coordonator"))).toBe(false);
    expect(runs.some((run) => run.includes("+40"))).toBe(false);
  });
});

describe("§774 the picture: the same telephone as the sheet", () => {
  const input = (role: { name: string; colour: string | null; phone: string | null } | null, design = ticked) => ({
    design,
    locale: "ro" as const,
    words: badgeWords(design, "ro", "Brașov Trail Race", DEFAULTS),
    role,
  });

  it("draws the role's category telephone with its label, and none for a role with no telephone", () => {
    const withPhone = JSON.stringify(badgeMarkup(input(ENTRIES[0].role), ""));
    expect(withPhone).toContain("badge-phone");
    expect(withPhone).toContain("Coordonator: +40 712 345 678");
    const without = JSON.stringify(badgeMarkup(input(ENTRIES[2].role), ""));
    expect(without).not.toContain("badge-phone");
    expect(JSON.stringify(badgeMarkup(input(null), ""))).not.toContain("badge-phone");
  });

  it("gives a badge with no telephone the room of the row, and the design's own number wins over the category's", () => {
    const row = (role: Parameters<typeof input>[0]) => badgeImageLayout(input(role));
    expect(row(ENTRIES[0].role).phoneLine).not.toBeNull();
    expect(row(ENTRIES[2].role).phoneLine).toBeNull();
    // The row stays on every badge while the tick is on — blank where there is no number — so the badges of a sheet are cut alike and
    // the designer's crop box is true for each.
    expect(row(ENTRIES[2].role).phone).not.toBeNull();
    expect(row(ENTRIES[2].role).writing.height).toBe(row(ENTRIES[0].role).writing.height);
    expect(badgeImageLayout(input(ENTRIES[2].role, { ...ticked, showPhone: false })).phone).toBeNull();
    const typed = { ...ticked, phone: "0712 345 678" };
    expect(JSON.stringify(badgeMarkup(input(ENTRIES[0].role, typed), ""))).toContain("Coordonator: 0712 345 678");
    expect(JSON.stringify(badgeMarkup(input(ENTRIES[2].role, typed), ""))).toContain("Coordonator: 0712 345 678");
  });

  it("agrees with the rule: the line a role's badge says is `badgePhoneLine`'s", () => {
    for (const entry of ENTRIES) {
      const line = badgePhoneLine(ticked, WORDS, entry.role?.phone);
      const markup = JSON.stringify(badgeMarkup(input(entry.role), ""));
      if (line === null) expect(markup).not.toContain("badge-phone");
      else expect(markup).toContain(line);
    }
  });
});
