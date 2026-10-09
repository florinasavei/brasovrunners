import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibDesign, DEFAULT_BIB_DESIGN, DEFAULT_BIB_MEMBER_DESIGN } from "@/modules/registrations/bib-design";
import { BIB_CARD, BIB_IMAGE, BIB_LAYOUT, BIB_MARGIN } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { memberBibExportCell } from "@/modules/registrations/csv";
import { invitationDraft } from "@/modules/registrations/domain/invitations";
import { memberBibKept, memberBibOf, memberBibTickedAtFirst } from "@/modules/registrations/domain/member-bib";

/**
 * §664, BR-REQ-038-01 — the members' race number: the members' header and label on a member's bib,
 * the number and the name where they always are, both renderers reading `bib-geometry.ts`; and the
 * three facts that decide who wears it.
 */

const MEMBER_COLOUR = "#6a1b9a";
const EVENT_COLOUR = "#1b8a3a";
const withMembers = (member: Partial<BibDesign["member"]> = {}): BibDesign => ({
  ...DEFAULT_BIB_DESIGN,
  member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, bandColour: MEMBER_COLOUR, ...member },
});

const sheet = (rows: Array<{ member?: boolean }>, design: BibDesign = withMembers(), over: Partial<Parameters<typeof renderBibSheet>[0]> = {}) =>
  renderBibSheet({
    rows: rows.map((row, index) => ({ bibNumber: 101 + index, registeredName: `Alergător ${index + 1}`, member: row.member })),
    eventTitle: "Crosul Brașov Runners",
    eventDate: "21 noiembrie 2026",
    bandColour: EVENT_COLOUR,
    generatedAt: new Date("2026-10-04T12:00:00Z"),
    design,
    memberLabelDefault: "Membru Brașov Runners",
    ...over,
  });

/** Every fill colour the pages ask for (the inflated content streams; `bibs-pdf.test.ts` says why). */
function carries(pdf: Buffer, hex: string): boolean {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/(?<![d])stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      text += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // Not a content stream.
    }
  }
  const want = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  return [...text.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(?:rg|scn)\b/g)].some((m) =>
    [m[1], m[2], m[3]].every((part, index) => Math.abs(Number(part) - want[index]) < 0.002),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("§664 who wears the members' bib", () => {
  it("is kept only when offered, declared and wanted — a stale form stores false", () => {
    expect(memberBibKept({ offered: true, declared: true, wanted: true })).toBe(true);
    expect(memberBibKept({ offered: false, declared: true, wanted: true })).toBe(false);
    expect(memberBibKept({ offered: true, declared: false, wanted: true })).toBe(false);
    expect(memberBibKept({ offered: true, declared: true, wanted: false })).toBe(false);
  });

  it("prints only for a verified address; asked-but-unverified prints the ordinary bib", () => {
    expect(memberBibOf({ offered: true, wanted: true, verified: true })).toBe("printed");
    expect(memberBibOf({ offered: true, wanted: true, verified: false })).toBe("asked");
    expect(memberBibOf({ offered: true, wanted: false, verified: true })).toBeNull();
    // The switch went off after the person asked: nothing prints from the wish.
    expect(memberBibOf({ offered: false, wanted: true, verified: true })).toBeNull();
  });

  it("reads «Member bib» = yes / asked / empty in the export", () => {
    expect(memberBibExportCell({ memberBibOffered: true, memberBibWanted: true, memberVerified: true })).toBe("yes");
    expect(memberBibExportCell({ memberBibOffered: true, memberBibWanted: true, memberVerified: false })).toBe("asked");
    expect(memberBibExportCell({ memberBibOffered: true, memberBibWanted: false, memberVerified: true })).toBe("");
    expect(memberBibExportCell({ memberVerified: true })).toBe("");
  });
});

describe("§664 «Vreau numărul de membru» starts ticked unless a refusal brought back an untick", () => {
  it("is ticked on a fresh form and on a family sitting's shared boxes, which hold no member tick", () => {
    expect(memberBibTickedAtFirst(null)).toBe(true);
    expect(memberBibTickedAtFirst({ city: "Brașov", emergencyContactName: "Ana" })).toBe(true);
  });

  it("is ticked on the invitation form of an invited member, beside «Sunt membru»", () => {
    const draft = invitationDraft({ name: "Ana Maria Pop", member: true }, "Brașov Runners");
    expect(draft).toMatchObject({ firstName: "Ana Maria", lastName: "Pop", clubMemberDeclared: "on", memberBibWanted: "on" });
    expect(memberBibTickedAtFirst(draft)).toBe(true);
    // A non-member's invitation asks nothing of the members' bib, and the box (if shown) starts ticked.
    expect(invitationDraft({ name: "Ion", member: false }, "Brașov Runners")).toEqual({ firstName: "Ion", lastName: "" });
  });

  it("brings back what a refused press posted: the member tick with or without the wish", () => {
    expect(memberBibTickedAtFirst({ clubMemberDeclared: "on" })).toBe(false);
    expect(memberBibTickedAtFirst({ clubMemberDeclared: "on", memberBibWanted: "on" })).toBe(true);
  });
});

describe("§664 the label's place, one geometry for both renderers", () => {
  it("sits inside the band, under the race's date, right of the lockup", () => {
    const L = BIB_LAYOUT;
    expect(L.memberTagTop).toBeGreaterThan(L.dateTop + L.dateSize);
    expect(L.memberTagTop + L.memberTagHeight).toBeLessThanOrEqual(L.bandHeight);
    expect(L.memberLabelSize).toBeLessThan(L.dateSize);
    // The label's right edge is the card's inset, as the race's title and date: room for 24 characters beside the lockup.
    expect(BIB_CARD.width - L.inset - (L.inset + L.logoWidth + L.inset)).toBeGreaterThan(24 * L.memberLabelSize * 0.7);
  });
});

describe("§664 the sheet", () => {
  it("draws the members' colour only on a member's bib, and only while the switch is on", async () => {
    expect(carries(await sheet([{ member: true }]), MEMBER_COLOUR)).toBe(true);
    expect(carries(await sheet([{ member: false }]), MEMBER_COLOUR)).toBe(false);
    // The switch off: a row flagged a member prints the ordinary bib.
    expect(carries(await sheet([{ member: true }], { ...withMembers(), member: { ...withMembers().member, enabled: false } }), MEMBER_COLOUR)).toBe(false);
  });

  it("falls back to the event's band when the members chose no colour, and when their picture could not be fetched", async () => {
    const noColour = withMembers({ bandColour: null });
    expect(carries(await sheet([{ member: true }], noColour), EVENT_COLOUR)).toBe(true);
    // A picture named but not handed over (the route's fetch failed): the members' colour, never a failed sheet.
    const picture = withMembers({ headerImageSrc: "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp" });
    const pdf = await sheet([{ member: true }], picture, { pictures: { memberHeader: null } });
    expect(carries(pdf, MEMBER_COLOUR)).toBe(true);
  });

  it("prints the label at the geometry's point, and the number and the name where they always are", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await sheet([{ member: false }, { member: true }]);
    const calls = text.mock.calls.map(([value, x, y]) => ({ value: String(value), x: Number(x), y: Number(y) }));
    const label = calls.find((call) => call.value === "Membru Brașov Runners");
    expect(label).toBeDefined();
    // The member's bib opens a page of its own (§NNN): the upper card, which starts at the margin.
    const upperTop = BIB_MARGIN;
    expect(label!.y).toBeGreaterThan(upperTop + BIB_LAYOUT.memberTagTop);
    expect(label!.y).toBeLessThan(upperTop + BIB_LAYOUT.memberTagTop + BIB_LAYOUT.memberTagHeight);
    // One label: the ordinary bib carries none.
    expect(calls.filter((call) => call.value === "Membru Brașov Runners")).toHaveLength(1);
    // The number's line and the name's sit at the same offset from each card's top on both bibs —
    // each the upper card of its own page now, the member's first.
    const offset = (value: string) => calls.filter((call) => call.value === value).map((call) => call.y);
    const [ordinaryNumber] = offset("101");
    const [memberNumber] = offset("102");
    expect(memberNumber - ordinaryNumber).toBeCloseTo(0, 3);
    const [ordinaryName] = offset("Alergător 1");
    const [memberName] = offset("Alergător 2");
    expect(memberName - ordinaryName).toBeCloseTo(0, 3);
    expect(calls.findIndex((call) => call.value === "102")).toBeLessThan(calls.findIndex((call) => call.value === "101"));
  });

  it("prints the club's own label when it typed one", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await sheet([{ member: true }], withMembers({ label: "BVR" }));
    expect(text.mock.calls.some(([value]) => value === "BVR")).toBe(true);
    expect(text.mock.calls.some(([value]) => value === "Membru Brașov Runners")).toBe(false);
  });

  it("writes a sample sheet to disk for a person to look at, when asked", async () => {
    if (!process.env.MEMBER_BIB_SHEET_SAMPLE) return;
    writeFileSync(process.env.MEMBER_BIB_SHEET_SAMPLE, await sheet([{ member: false }, { member: true }]));
  });
});

describe("§664 the picture", () => {
  const draw = async (over: Partial<Parameters<typeof renderBibImage>[0]> = {}) =>
    Buffer.from(
      await (
        await renderBibImage({
          bibNumber: 101,
          registeredName: "Alergător Ștefan",
          eventTitle: "Crosul Brașov Runners",
          eventDate: "21 noiembrie 2026",
          bandColour: EVENT_COLOUR,
          design: withMembers(),
          memberLabelDefault: "Membru Brașov Runners",
          pictures: {},
          ...over,
        })
      ).arrayBuffer(),
    );

  it("draws a member's bib differently from the ordinary one, at the same size", async () => {
    const member = await draw({ member: true });
    const ordinary = await draw({ member: false });
    expect(member.readUInt32BE(16)).toBe(BIB_IMAGE.width);
    expect(member.readUInt32BE(20)).toBe(BIB_IMAGE.height);
    expect(member.equals(ordinary)).toBe(false);
    // A sample for a person to look at, when asked.
    if (process.env.MEMBER_BIB_SAMPLE) writeFileSync(process.env.MEMBER_BIB_SAMPLE, member);
  });

  it("draws the ordinary bib for a member while the switch is off", async () => {
    const off = { ...withMembers(), member: { ...withMembers().member, enabled: false } };
    expect((await draw({ member: true, design: off })).equals(await draw({ member: false, design: off }))).toBe(true);
  });
});
