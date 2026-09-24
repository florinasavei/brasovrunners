import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";

/**
 * `DECISIONS.md` §257, §NNN — the owner, of the journey hint arriving as one run-on paragraph:
 * "tooltipurile trebuie să fie mai lungi, spre exemplu aici trebuie să fie cu liniuță, frumos
 * descris". `TOOLTIP_TEXT_SX` is the one style `Hint` and `InfoTip` both hand to MUI's tooltip
 * slot, and `readingTimeMs` is how long a longer one stays up after a tap.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§NNN TOOLTIP_TEXT_SX — a tooltip keeps its line breaks and stays readable", () => {
  it("keeps \\n as a line break, so a '\\n– item' list reads as one item per line", () => {
    expect(TOOLTIP_TEXT_SX.whiteSpace).toBe("pre-line");
  });

  it("caps the width short of unreadable, wide enough a step does not wrap mid-sentence", () => {
    expect(TOOLTIP_TEXT_SX.maxWidth).toBeGreaterThanOrEqual(360);
    expect(TOOLTIP_TEXT_SX.maxWidth).toBeLessThanOrEqual(420);
  });

  it("sets body text, not MUI's tiny caption size, for a paragraph somebody reads to the end", () => {
    expect(TOOLTIP_TEXT_SX.lineHeight).toBeGreaterThan(1);
    // MUI's caption is 0.75rem (12px); this is body2, bigger than that.
    expect(parseFloat(String(TOOLTIP_TEXT_SX.fontSize))).toBeGreaterThan(0.75);
  });

  it("names no colour of its own — hex lives in brand.ts and nowhere else", () => {
    expect(JSON.stringify(TOOLTIP_TEXT_SX)).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("is the one object both Hint and InfoTip spread into their tooltip's slotProps", () => {
    for (const file of ["src/shared/ui/Hint.tsx", "src/shared/ui/InfoTip.tsx"]) {
      const source = read(file);
      expect(source, file).toMatch(/import \{[^}]*\bTOOLTIP_TEXT_SX\b[^}]*\} from "\.\/tooltip-text"/);
      expect(source, file).toMatch(/slotProps=\{\{\s*tooltip:\s*\{\s*sx:\s*TOOLTIP_TEXT_SX\s*\}\s*\}\}/);
    }
  });
});

describe("§NNN readingTimeMs — how long a tap keeps a tooltip open", () => {
  it("never opens for less than six seconds, even for a very short text", () => {
    expect(readingTimeMs("Ok.")).toBe(6_000);
  });

  it("grows with the text, for a legend long enough to need it", () => {
    const short = readingTimeMs("A short sentence.");
    const long = readingTimeMs("A ".repeat(80) + "much longer piece of text.");
    expect(long).toBeGreaterThan(short);
  });

  it("never exceeds twenty seconds, so a tooltip nobody closes does not sit over the list for good", () => {
    expect(readingTimeMs("x".repeat(5_000))).toBe(20_000);
  });
});
