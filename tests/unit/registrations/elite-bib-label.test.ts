import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { ELITE_NAME_MAX } from "@/db/schema/event-elite-entries";
import { eliteBibName, eliteDefaultLabel, eliteLineBibName, eliteLineDefaultLabel, parseEliteBibLabel } from "@/modules/registrations/bib-elite";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibPictureSrc } from "@/modules/registrations/domain/bib-stamp";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * «Eticheta pe BIB» (§NNN, amending §948 and §963; the owner, 2026-11-18: «în dreptul fiecăruia vreau un „BIB Label” și să fie
 * prenumele by default»; BR-REQ-038-01) — what an elite bib prints where the number goes is decided once, in `bib-elite.ts`: the
 * stored label when there is one, else the default — a registration's first name, a list line's first word. The sheet reads it
 * from there (a drawn test, below); the picture's route and the screens too (`tests/integration/registrations/elite-bib-label.test.ts`).
 */
const base = { eventTitle: "Crosul de probă", eventDate: "21 noiembrie 2099", generatedAt: new Date("2099-11-03T12:00:00Z") };

/** Every string the sheet hands pdfkit's `text`. */
async function drawn(run: () => Promise<unknown>): Promise<string[]> {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await run();
    return text.mock.calls.map(([string]) => String(string));
  } finally {
    text.mockRestore();
  }
}

describe("§NNN the label in force, for both kinds of elite bib", () => {
  it("is a registration's stored label when it has one, else its first name, else the registered name", () => {
    expect(eliteBibName({ eliteBibLabel: "Ana P.", firstName: "Ana", registeredName: "Ana Pop" })).toBe("Ana P.");
    expect(eliteBibName({ eliteBibLabel: "  Ana   Pop  ", firstName: "Ana", registeredName: "Ana Pop" })).toBe("Ana Pop");
    for (const eliteBibLabel of [null, undefined, "", "   "]) {
      expect(eliteBibName({ eliteBibLabel, firstName: "Ana", registeredName: "Ana Pop" })).toBe("Ana");
    }
    expect(eliteBibName({ eliteBibLabel: null, firstName: null, registeredName: "Ana Pop" })).toBe("Ana Pop");
    expect(eliteDefaultLabel({ firstName: "Ana", registeredName: "Ana Pop" })).toBe("Ana");
  });

  it("is a list line's stored label when it has one, else the name's first word", () => {
    expect(eliteLineBibName("Mara Ionescu", "Mara I.")).toBe("Mara I.");
    expect(eliteLineBibName("Mara Ionescu", null)).toBe("Mara");
    expect(eliteLineBibName("Mara Ionescu")).toBe("Mara");
    expect(eliteLineBibName("Mara Ionescu", "  ")).toBe("Mara");
    expect(eliteLineDefaultLabel("  Mara   Ionescu ")).toBe("Mara");
  });

  it("stores a typed label trimmed with its spaces folded; empty or the default itself stores null; too long is refused naming the box", () => {
    expect(parseEliteBibLabel("  Ana   Maria  ", "Ana")).toBe("Ana Maria");
    expect(parseEliteBibLabel("", "Ana")).toBeNull();
    expect(parseEliteBibLabel("   ", "Ana")).toBeNull();
    expect(parseEliteBibLabel(null, "Ana")).toBeNull();
    // The default typed back is the default: null, so a corrected first name is followed again.
    expect(parseEliteBibLabel(" Ana ", "Ana")).toBeNull();
    expect(parseEliteBibLabel("a".repeat(ELITE_NAME_MAX), "Ana")).toBe("a".repeat(ELITE_NAME_MAX));
    let refusal: unknown;
    try {
      parseEliteBibLabel("a".repeat(ELITE_NAME_MAX + 1), "Ana");
    } catch (error) {
      refusal = error;
    }
    expect(isDomainError(refusal)).toBe(true);
    expect(refusal).toMatchObject({ code: "ELITE_LABEL_TOO_LONG", fields: ["eliteBibLabel"] });
  });
});

describe("§NNN the sheet prints the label in force", () => {
  it("draws a registration's label where it has one and its first name where it has none, and a list line's likewise", async () => {
    const rows = [
      { bibNumber: 7, registeredName: "Ana Pop", firstName: "Ana", eliteBibLabel: "Ana P.", elite: true },
      { bibNumber: 8, registeredName: "Dan Marin", firstName: "Dan", eliteBibLabel: null, elite: true },
    ];
    const elite = [
      { name: "Mara Ionescu", bibNumber: null, bibLabel: "MARA" },
      { name: "Ilie Stan", bibNumber: null, bibLabel: null },
    ];
    const texts = await drawn(() => renderBibSheet({ ...base, rows, elite }));
    expect(texts.filter((text) => ["MARA", "Mara", "Mara Ionescu", "Ilie", "Ilie Stan", "Ana P.", "Ana", "Dan", "Dan Marin"].includes(text))).toEqual([
      "MARA",
      "Ilie",
      "Ana P.",
      "Dan",
    ]);
    // The ordinary sheet draws a marked registration elite-style too, with the same label.
    const ordinary = await drawn(() => renderBibSheet({ ...base, rows: [rows[0]] }));
    expect(ordinary).toContain("Ana P.");
    expect(ordinary).not.toContain("Ana Pop");
  }, 30_000);
});

describe("§NNN the picture's address changes with the label", () => {
  it("carries a fingerprint of an elite bib's label, never the label itself, and nothing for a bib that is not elite", () => {
    const input = { eventId: "e", registrationId: "r", locale: "ro", stamp: "s" };
    const first = bibPictureSrc({ ...input, elite: true, eliteLabel: "Ana" });
    const second = bibPictureSrc({ ...input, elite: true, eliteLabel: "Ana P." });
    expect(first).not.toBe(second);
    expect(first).toMatch(/&e=1&l=[0-9a-f]{8}&v=s$/);
    expect(second).not.toContain("Ana");
    expect(bibPictureSrc({ ...input, elite: false, eliteLabel: "Ana" })).toBe("/api/admin/events/e/bibs/preview?registration=r&locale=ro&v=s");
  });
});
