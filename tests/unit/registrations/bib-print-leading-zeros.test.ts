import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibPictureSrc, bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";

/** §735 amended: the printed sheet writes the number as the event's «Cum arată numărul» asks. */
async function printedTexts(numberFormat: "plain" | "pad3" | "pad4"): Promise<string[]> {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await renderBibSheet({
      rows: [{ bibNumber: 1, registeredName: "Alergător Test" }],
      eventTitle: "Cros",
      eventDate: "11 octombrie 2026",
      generatedAt: new Date("2026-09-17T12:00:00Z"),
      design: { ...DEFAULT_BIB_DESIGN, numberFormat },
    });
    return text.mock.calls.map(([value]) => String(value));
  } finally {
    text.mockRestore();
  }
}

describe("§735 the printed bib sheet", () => {
  it("prints 001 under pad3", async () => expect(await printedTexts("pad3")).toContain("001"));
  it("prints 0001 under pad4", async () => expect(await printedTexts("pad4")).toContain("0001"));
  it("prints 1 when the setting is off", async () => {
    const texts = await printedTexts("plain");
    expect(texts).toContain("1");
    expect(texts).not.toContain("001");
  });
});

describe("§735 the bibs page's pictures follow the design", () => {
  it("changes the stamp, so the picture's address, when the number's format changes", () => {
    const plain = bibPictureStamp([{ ...DEFAULT_BIB_DESIGN, numberFormat: "plain" }, "#112233", "Cros"]);
    const pad3 = bibPictureStamp([{ ...DEFAULT_BIB_DESIGN, numberFormat: "pad3" }, "#112233", "Cros"]);
    expect(pad3).not.toBe(plain);
    expect(bibPictureStamp([{ ...DEFAULT_BIB_DESIGN, numberFormat: "pad3" }, "#112233", "Cros"])).toBe(pad3);
  });
});

describe("§735 the picture's address", () => {
  const stampOf = (numberFormat: "plain" | "pad3") => bibPictureStamp([{ ...DEFAULT_BIB_DESIGN, numberFormat }, "#112233", "Cros"]);
  const srcOf = (numberFormat: "plain" | "pad3", member = false) =>
    bibPictureSrc({ eventId: "e1", registrationId: "r1", locale: "ro", stamp: stampOf(numberFormat), member });
  it("carries the stamp as v= and differs between pad3 and plain", () => {
    expect(srcOf("pad3")).toContain(`&v=${stampOf("pad3")}`);
    expect(srcOf("pad3")).not.toBe(srcOf("plain"));
  });
  it("keeps the member mark and is stable for an unchanged design", () => {
    expect(srcOf("pad3", true)).toContain("&m=1");
    expect(srcOf("pad3")).toBe(srcOf("pad3"));
  });
});
