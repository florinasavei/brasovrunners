import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibPictureSrc } from "@/modules/registrations/domain/bib-stamp";

/**
 * §NNN (the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită oricând», «Rămâne înscris») — a registration
 * marked «Elită» prints with §895's elite drawing, not a second one: the name where the number goes, its own race
 * number under it only with «Număr pe BIB-urile de elită», the sponsors' row only with «Banda de sponsori pe
 * BIB-urile de elită», never the members' design — on the ordinary sheet and on the elite sheet after the list.
 */
const FONTS = path.join(process.cwd(), "src", "theme", "pdf");

/** Every string the sheet hands pdfkit's `text`, with the width it was boxed in (an elite line has none). */
async function drawn(run: () => Promise<unknown>): Promise<{ text: string; width: number | undefined }[]> {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await run();
    return text.mock.calls.map(([string, , , options]) => ({ text: String(string), width: (options as { width?: number } | undefined)?.width }));
  } finally {
    text.mockRestore();
  }
}

const base = { eventTitle: "Crosul aniversar", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-11-03T12:00:00Z") };
const rows = [
  { bibNumber: 7, registeredName: "Ana Pop", elite: true },
  { bibNumber: 8, registeredName: "Ion Ionescu" },
];
const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

describe("§NNN a marked registration on the ordinary sheet", () => {
  it("draws the name in the number's place with no name strip, and the number only when ticked", async () => {
    const plain = await drawn(() => renderBibSheet({ ...base, rows, design: { ...DEFAULT_BIB_DESIGN, numberFormat: "pad3" } }));
    expect(plain.filter((run) => run.text === "Ana Pop")).toEqual([{ text: "Ana Pop", width: undefined }]);
    expect(plain.map((run) => run.text)).not.toContain("007");
    // The unmarked bib beside it is the ordinary one: its number, its name in the strip.
    expect(plain.map((run) => run.text)).toContain("008");
    expect(plain.find((run) => run.text === "Ion Ionescu")?.width).toBeGreaterThan(0);

    const numbered = await drawn(() => renderBibSheet({ ...base, rows, design: { ...DEFAULT_BIB_DESIGN, numberFormat: "pad3", eliteNumber: true } }));
    expect(numbered.filter((run) => /^\d+$/.test(run.text)).map((run) => run.text)).toEqual(["007", "008"]);
  });

  it("prints the sponsors' band on it only with «Banda de sponsori pe BIB-urile de elită»", async () => {
    const sponsors = readFileSync(path.join(FONTS, "logo.png"));
    const design = { ...DEFAULT_BIB_DESIGN, showLogo: false, sponsorImageSrc: "/api/media/x/web.webp" };
    const image = vi.spyOn(PDFDocument.prototype, "image");
    try {
      await renderBibSheet({ ...base, rows, design, pictures: { sponsors } });
      // Ion's band only.
      expect(image).toHaveBeenCalledTimes(1);
      image.mockClear();
      await renderBibSheet({ ...base, rows, design: { ...design, eliteSponsors: true }, pictures: { sponsors } });
      expect(image).toHaveBeenCalledTimes(2);
    } finally {
      image.mockRestore();
    }
  });

  it("is never a member's bib: not on the members' pages, whatever its member flag says", async () => {
    const design = { ...DEFAULT_BIB_DESIGN, member: { ...DEFAULT_BIB_DESIGN.member, enabled: true } };
    const member = [{ bibNumber: 7, registeredName: "Ana Pop", elite: true, member: true }];
    // The members' part holds nothing — the «—» page — and the rest holds her, drawn elite.
    const membersPart = await drawn(() => renderBibSheet({ ...base, rows: member, design, part: "members" }));
    expect(membersPart.map((run) => run.text)).toEqual(["—"]);
    const others = await drawn(() => renderBibSheet({ ...base, rows: member, design, part: "others" }));
    expect(others.filter((run) => run.text === "Ana Pop")).toEqual([{ text: "Ana Pop", width: undefined }]);
  });
});

describe("§NNN the elite sheet", () => {
  it("prints the list's names first, then the marked registrations, each an elite bib", async () => {
    const elite = [{ name: "Eliud Kipchoge", bibNumber: null }];
    const marked = [{ bibNumber: 7, registeredName: "Ana Pop", elite: true }];
    const runs = await drawn(() => renderBibSheet({ ...base, rows: marked, elite }));
    expect(runs.filter((run) => ["Eliud Kipchoge", "Ana Pop"].includes(run.text))).toEqual([
      { text: "Eliud Kipchoge", width: undefined },
      { text: "Ana Pop", width: undefined },
    ]);
    expect(pages(await renderBibSheet({ ...base, rows: marked, elite }))).toBe(1);
    expect(pages(await renderBibSheet({ ...base, rows: marked, elite, layout: "one" }))).toBe(2);
  });
});

describe("§NNN the picture's address", () => {
  it("changes with the mark, so a browser never keeps the hour-old picture", () => {
    const input = { eventId: "e", registrationId: "r", locale: "ro", stamp: "s" };
    expect(bibPictureSrc(input)).toBe("/api/admin/events/e/bibs/preview?registration=r&locale=ro&v=s");
    expect(bibPictureSrc({ ...input, elite: true })).toBe("/api/admin/events/e/bibs/preview?registration=r&locale=ro&e=1&v=s");
    expect(bibPictureSrc({ ...input, member: true, elite: false })).toBe("/api/admin/events/e/bibs/preview?registration=r&locale=ro&m=1&v=s");
  });
});
