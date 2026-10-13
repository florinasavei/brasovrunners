import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BibDesign,
  DEFAULT_BIB_DESIGN,
  DEFAULT_BIB_MEMBER_DESIGN,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import {
  type BibDesignFormValues,
  bibDesignSearchParams,
  bibDesignValuesFromQuery,
} from "@/modules/registrations/bib-design-query";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { BIB_CARD, BIB_LAYOUT, bibNameReserve } from "@/modules/registrations/bib-geometry";
import { bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §750, BR-REQ-038-01 — «Semn de membru pe număr»: a check mark on every member's number, only when
 * ticked and only on a member's; «Același fundal ca restul numerelor» is the members' header alone
 * over the race's own background (the `band` style), the default for a design saved before.
 */

const withMember = (member: Partial<BibDesign["member"]>): BibDesign => ({
  ...DEFAULT_BIB_DESIGN,
  member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, ...member },
});

/** How many marks (rings) a sheet draws: the sheet draws nothing else with `circle()`. */
async function ringsOf(rows: Array<{ member?: boolean }>, design: BibDesign): Promise<number> {
  const spy = vi.spyOn(PDFDocument.prototype, "circle");
  await renderBibSheet({
    rows: rows.map((row, index) => ({ bibNumber: 101 + index, registeredName: `Alergător ${index + 1}`, member: row.member })),
    eventTitle: "Crosul Brașov Runners",
    eventDate: "21 noiembrie 2026",
    generatedAt: new Date("2026-10-10T12:00:00Z"),
    design,
    memberLabelDefault: "Membru Brașov Runners",
  });
  const count = spy.mock.calls.length;
  spy.mockRestore();
  return count;
}

const picture = (design: BibDesign, member: boolean) =>
  renderBibImage({
    bibNumber: 101,
    registeredName: "Alergător Unu",
    eventTitle: "Crosul Brașov Runners",
    eventDate: "21 noiembrie 2026",
    bandColour: null,
    design,
    member,
    memberLabelDefault: "Membru Brașov Runners",
  }).then(async (response) => Buffer.from(await response.arrayBuffer()));

afterEach(() => vi.restoreAllMocks());

describe("§750 the member mark in the design", () => {
  it("reads off for a design saved before, and on only as a boolean", () => {
    expect(readBibDesign({ member: { enabled: true } }).member.mark).toBe(false);
    expect(readBibDesign({ member: { enabled: true, mark: true } }).member.mark).toBe(true);
    expect(readBibDesign({ member: { enabled: true, mark: "yes" } }).member.mark).toBe(false);
    expect(DEFAULT_BIB_DESIGN.member.mark).toBe(false);
  });

  it("an old design keeps the header-alone background it had", () => {
    expect(readBibDesign({ member: { enabled: true } }).member.style).toBe("band");
  });

  it("travels in the preview's address and back, so the picture's cache key changes with it", () => {
    const base = withMember({ mark: false });
    const on: BibDesignFormValues = { ...base, member: { ...base.member, mark: true } };
    expect(bibDesignSearchParams(base).toString()).not.toBe(bibDesignSearchParams(on).toString());
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(on))).member.mark).toBe(true);
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(base))).member.mark).toBe(false);
  });
});

describe("§750 the member mark on the sheet", () => {
  it("is drawn once per member's number when ticked, and not otherwise", async () => {
    const rows = [{ member: true }, { member: true }, { member: false }];
    expect(await ringsOf(rows, withMember({ mark: true }))).toBe(2);
    expect(await ringsOf(rows, withMember({ mark: false }))).toBe(0);
  });

  it("is never drawn on the ordinary numbers, or while the members' number is off", async () => {
    expect(await ringsOf([{ member: false }, {}], withMember({ mark: true }))).toBe(0);
    expect(await ringsOf([{ member: true }], withMember({ mark: true, enabled: false }))).toBe(0);
  });

  it("is drawn on the card style too", async () => {
    expect(await ringsOf([{ member: true }], withMember({ mark: true, style: "card" }))).toBe(1);
  });
});

describe("§750 the member mark on the picture", () => {
  it("changes a member's picture only when ticked, never an ordinary one", async () => {
    const off = withMember({ mark: false });
    const on = withMember({ mark: true });
    expect((await picture(on, true)).equals(await picture(off, true))).toBe(false);
    expect((await picture(on, false)).equals(await picture(off, false))).toBe(true);
  });
});

describe("§750 the name above the number steps aside for the mark", () => {
  const LONG = "Alexandra-Maria Popescu-Ionescu Georgescu";

  const nameRun = async (design: BibDesign, member: boolean) => {
    const runs = await drawnRuns(() =>
      renderBibSheet({
        rows: [{ bibNumber: 101, registeredName: LONG, member }],
        eventTitle: "Crosul Brașov Runners",
        eventDate: "21 noiembrie 2026",
        generatedAt: new Date("2026-10-10T12:00:00Z"),
        design,
        memberLabelDefault: "Membru Brașov Runners",
      }),
    );
    const run = runs.find((r) => r.text === LONG);
    expect(run).toBeDefined();
    return run!;
  };

  it("starts the name's box past the mark's right edge, and keeps it centred", async () => {
    const above = { namePosition: "above" } as const;
    const plain = await nameRun({ ...withMember({ mark: false }), ...above }, true);
    const marked = await nameRun({ ...withMember({ mark: true }), ...above }, true);
    const reserve = marked.x! - plain.x!;
    expect(reserve).toBe(BIB_LAYOUT.memberMarkSize + BIB_LAYOUT.memberMarkGap);
    // The mark spans plain.x .. plain.x + memberMarkSize (both at the card's inset).
    expect(marked.x!).toBeGreaterThan(plain.x! + BIB_LAYOUT.memberMarkSize);
    expect(marked.width!).toBe(BIB_CARD.width - 2 * (BIB_LAYOUT.inset + reserve));
    expect(marked.x! + marked.width! + reserve).toBeCloseTo(plain.x! + plain.width!, 5);
  });

  it("leaves the name alone below the number, on an ordinary number, and with no mark", async () => {
    const below = await nameRun({ ...withMember({ mark: true }), namePosition: "below" }, true);
    const belowOff = await nameRun({ ...withMember({ mark: false }), namePosition: "below" }, true);
    expect(below.x).toBe(belowOff.x);
    const ordinary = await nameRun({ ...withMember({ mark: true }), namePosition: "above" }, false);
    const ordinaryOff = await nameRun({ ...withMember({ mark: false }), namePosition: "above" }, false);
    expect(ordinary.x).toBe(ordinaryOff.x);
    expect(bibNameReserve(false, true)).toBe(0);
    expect(bibNameReserve(true, false)).toBe(0);
  });
});

describe("§750 the picture's stamp follows the mark", () => {
  it("changes when the tick flips, so a cached picture is not served stale", () => {
    expect(bibPictureStamp([withMember({ mark: true })])).not.toBe(bibPictureStamp([withMember({ mark: false })]));
  });
});
