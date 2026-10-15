import { describe, expect, it } from "vitest";
import { asciiFallbackName, contentDisposition } from "@/shared/http/content-disposition";
import { pdfResponse } from "@/modules/registrations/declaration-labels";

/**
 * BR-REQ-060-01, §779 — every download's name goes through one helper. An HTTP header is Latin-1
 * bytes, and the race «CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026» (a «Ș», a «Ț» and an en
 * dash) used to answer the participants' Excel export with a 500: «Cannot convert argument to a
 * ByteString because the character at index 42 has a value of 536».
 */
const RACE = "CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026";

const NAMES: [string, string][] = [
  ["the race's title", `${RACE} 2026-10-15.xlsx`],
  ["a participant", "Ștefan Țepeș.pdf"],
  ["quotes", 'He said "hi" and «bye» – “done”.csv'],
  ["backslashes and slashes", "a\\b\\c d/e.csv"],
  ["an emoji", "run 🏃‍♂️ 5k.xlsx"],
  ["a very long name", `${"Ș".repeat(300)}.xlsx`],
  ["an empty name", ""],
  ["only an extension", ".xlsx"],
  ["another script", "Кросс-2026.pdf"],
  ["control characters", "line\nbreak\tand\r\nreturn.csv"],
  ["a lone surrogate", "broken \ud83d name.csv"],
  ["header-ish characters", "a; filename=\"evil\".csv"],
  ["percent and punctuation", "100% (final) *new* !'.csv"],
];

function decodeStar(header: string): string {
  const match = /filename\*=UTF-8''([^;]*)$/.exec(header);
  expect(match, header).not.toBeNull();
  return decodeURIComponent(match![1]);
}

describe("BR-REQ-060-01 contentDisposition (§779)", () => {
  it.each(NAMES)("%s: Headers accepts it, the fallback is printable ASCII, filename* is the real name", (_label, name) => {
    for (const type of ["attachment", "inline"] as const) {
      const value = contentDisposition(type, name);
      expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
      expect(new Headers({ "Content-Disposition": value }).get("Content-Disposition")).toBe(value);
      expect(value.startsWith(`${type}; filename="`)).toBe(true);
      const fallback = /filename="([^"]*)"; filename\*=/.exec(value)?.[1];
      expect(fallback, value).toBeDefined();
      expect(fallback).toMatch(/^[\x20-\x7e]+$/);
      expect(fallback).not.toContain("\\");
      expect(fallback!.trim()).toBe(fallback);
    }
  });

  it("filename* decodes to the original name, diacritics and all", () => {
    for (const [, name] of NAMES) {
      if (name.includes("\ud83d") && !/\ud83d[\udc00-\udfff]/.test(name)) continue; // a lone surrogate is repaired, see below
      expect(decodeStar(contentDisposition("attachment", name)), name).toBe(name);
    }
  });

  it("the race's title: ASCII fallback with the accents off, the real name in filename*", () => {
    const value = contentDisposition("attachment", `${RACE} 2026-10-15.xlsx`);
    expect(value).toContain('filename="CROSUL ANIVERSAR BRASOV RUNNERS - EDITIA A II-A 2026 2026-10-15.xlsx"');
    expect(value).toContain("filename*=UTF-8''CROSUL%20ANIVERSAR%20BRA%C8%98OV%20RUNNERS%20%E2%80%93%20EDI%C8%9AIA%20A%20II-A%202026%202026-10-15.xlsx");
  });

  it("a participant: «Ștefan Țepeș» is «Stefan Tepes» in the fallback", () => {
    expect(asciiFallbackName("Ștefan Țepeș.pdf")).toBe("Stefan Tepes.pdf");
    expect(asciiFallbackName("ăâîșț ĂÂÎȘȚ.csv")).toBe("aaist AAIST.csv");
  });

  it("typographic dashes and quotes become plain, a double quote never survives into the quoted string", () => {
    expect(asciiFallbackName("a – b — c.csv")).toBe("a - b - c.csv");
    expect(asciiFallbackName("“x” «y» „z”.csv")).toBe("'x' 'y' 'z'.csv");
    expect(asciiFallbackName('say "hi".csv')).toBe("say 'hi'.csv");
    expect(asciiFallbackName("a\\b/c.csv")).toBe("a_b_c.csv");
  });

  it("never empty: an empty name, an emoji or another script falls back to the given stem, the extension kept", () => {
    expect(asciiFallbackName("")).toBe("download");
    expect(asciiFallbackName("🏃🏃.xlsx", "registrations")).toBe("registrations.xlsx");
    expect(asciiFallbackName("Кросс.pdf", "event")).toBe("event.pdf");
    expect(asciiFallbackName(".xlsx", "registrations")).toBe("registrations.xlsx");
    expect(contentDisposition("attachment", "", "inscrieri")).toMatch(/^attachment; filename="inscrieri"; filename\*=UTF-8''$/);
  });

  it("a 300-character name stays whole in filename* and is a valid header", () => {
    const long = `${"Ț".repeat(300)}.xlsx`;
    const value = contentDisposition("attachment", long);
    expect(decodeStar(value)).toBe(long);
    expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
  });

  it("RFC 5987: the characters encodeURIComponent leaves alone are encoded, and a lone surrogate becomes U+FFFD", () => {
    const value = contentDisposition("attachment", "a'b(c)d*e!f.csv");
    expect(value).toContain("filename*=UTF-8''a%27b%28c%29d%2Ae%21f.csv");
    expect(decodeStar(contentDisposition("attachment", "x \ud83d y.csv"))).toBe("x � y.csv");
  });

  it("the plain ASCII name the CSV export has always had is unchanged in the fallback", () => {
    expect(contentDisposition("attachment", "registrations.csv")).toBe(`attachment; filename="registrations.csv"; filename*=UTF-8''registrations.csv`);
  });
});

describe("BR-REQ-060-01 a signed declaration's PDF (§779)", () => {
  it("answers 200 with a header Headers accepts, whatever the name carries", async () => {
    const response = pdfResponse(Buffer.from("%PDF-1.4 test"), "Declarația Ștefan Țepeș – 2026.pdf", "attachment");
    expect(response.status).toBe(200);
    const header = response.headers.get("Content-Disposition")!;
    expect(header).toContain('filename="Declaratia Stefan Tepes - 2026.pdf"');
    expect(decodeStar(header)).toBe("Declarația Ștefan Țepeș – 2026.pdf");
  });
});
