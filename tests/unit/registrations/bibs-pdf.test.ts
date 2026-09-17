import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";

/**
 * BR-REQ-038-01 — the printable sheet: two bibs per A4 page, the club's font and logo embedded.
 */
const sheet = (count: number) =>
  renderBibSheet({
    rows: Array.from({ length: count }, (_, i) => ({ bibNumber: i + 1, registeredName: `Alergător Ștefan ${i + 1}` })),
    eventTitle: "Crosul aniversar Brașov Runners",
    eventDate: "11 octombrie 2026",
    pageLabel: (n, total) => `Pagina ${n} din ${total}`,
    generatedAt: new Date("2026-09-17T12:00:00Z"),
  });

describe("BR-REQ-038-01 the bib sheet", () => {
  it("prints two bibs per page, so five bibs are three pages", async () => {
    const pdf = await sheet(5);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(3);
    expect(text).toMatch(/Roboto/);
    expect(text).toMatch(/\/Subtype \/Image/);
  });

  it("is still a file when there is nothing to print", async () => {
    const pdf = await sheet(0);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("writes a sample to disk for a person to look at, when asked", async () => {
    const target = process.env.BIBS_PDF_SAMPLE;
    if (!target) return;
    writeFileSync(target, await sheet(3));
  });
});
