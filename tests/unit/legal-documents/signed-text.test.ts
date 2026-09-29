import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatSigningInstant } from "@/i18n/dates";
import { shortTextHash, signedText, signedTextHash, signedTextLines } from "@/modules/legal-documents/domain/signed-text";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { declarationProofLine } from "@/modules/registrations/declaration-pdf";

/**
 * BR-REQ-033-02 (§556, the second review of 2026-09-29) — the proof of signing: the SHA-256 of the
 * exact text signed, and the PDF's line «Versiunea N · Semnat la ZZ.LL.AAAA, hh:mm:ss (ora
 * României) · Amprenta documentului (SHA-256): <hex>».
 *
 * The hash is pinned to a known text and a known hex, so a change to what is hashed — a separator,
 * a trimmed space, the title left out — fails here rather than silently changing every future row.
 */
const BODY = {
  sections: [
    {
      paragraphs: [
        "Subsemnatul/a {{participant}}, semnat {{signedAt}}.",
        // Dropped with no minimum, as the PDF drops it (§440): not in the hashed text either.
        "Declar că am cel puțin {{minimumAge}} împliniți.",
        // A link prints as "words (address)" on the PDF (`plainInline`), and is hashed so.
        "• Alerg în [ritmul meu](/ro/ritm).",
      ],
    },
  ],
};
const VALUES = { participant: "Ana Pop", signedAt: "vineri, 4 sept. 2026, la 13:00", minimumAge: "" };
const KNOWN = "8bc4017ad13d913aaaa2d673420e0dac4f4c3a71d420e4d7489fb4fd272a4d85";

describe("the signed text and its fingerprint (§556)", () => {
  it("is the title and every paragraph the PDF keeps, filled and stripped of marks, one line each", () => {
    expect(signedTextLines({ title: "Declarație", body: BODY, values: VALUES })).toEqual([
      "Declarație",
      "Subsemnatul/a Ana Pop, semnat vineri, 4 sept. 2026, la 13:00.",
      "• Alerg în ritmul meu (/ro/ritm).",
    ]);
  });

  it("hashes a known text to a known hex: SHA-256 of the UTF-8 bytes, lines joined by a line feed", () => {
    const text = signedText({ title: "Declarație", body: BODY, values: VALUES });
    expect(text).toBe("Declarație\nSubsemnatul/a Ana Pop, semnat vineri, 4 sept. 2026, la 13:00.\n• Alerg în ritmul meu (/ro/ritm).");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(KNOWN);
    expect(signedTextHash({ title: "Declarație", body: BODY, values: VALUES })).toBe(KNOWN);
  });

  it("changes with any value the signer's copy prints — the name, the moment, the title", () => {
    const base = signedTextHash({ title: "Declarație", body: BODY, values: VALUES });
    expect(signedTextHash({ title: "Declarație", body: BODY, values: { ...VALUES, participant: "Ana Popa" } })).not.toBe(base);
    expect(signedTextHash({ title: "Declarație", body: BODY, values: { ...VALUES, signedAt: "vineri, 4 sept. 2026, la 13:01" } })).not.toBe(base);
    expect(signedTextHash({ title: "Declaration", body: BODY, values: VALUES })).not.toBe(base);
  });

  it("shows twelve characters in the backoffice", () => {
    expect(shortTextHash(KNOWN)).toBe("8bc4017ad13d");
  });
});

describe("the PDF's proof line (§556)", () => {
  const NOW = new Date("2026-09-04T10:00:00.000Z");
  const signature = { acceptedAt: new Date("2026-09-24T15:05:12.345Z") };

  it("prints the instant to the second on the club's clock, day first, the same digits in both languages", () => {
    // 15:05:12 UTC is 18:05:12 in Bucharest in September (EEST).
    expect(formatSigningInstant(signature.acceptedAt)).toBe("24.09.2026, 18:05:12");
    expect(formatSigningInstant(new Date("2026-01-05T07:00:09Z"))).toBe("05.01.2026, 09:00:09");
  });

  it("says the version, the moment and the fingerprint, in Romanian and in English", () => {
    expect(declarationProofLine({ version: 3, textHash: KNOWN, signature }, declarationWords("ro", NOW))).toBe(
      `Versiunea 3 · Semnat la 24.09.2026, 18:05:12 (ora României) · Amprenta documentului (SHA-256): ${KNOWN}`,
    );
    expect(declarationProofLine({ version: 3, textHash: KNOWN, signature }, declarationWords("en", NOW))).toBe(
      `Version 3 · Signed on 24.09.2026, 18:05:12 (Romania time) · Document fingerprint (SHA-256): ${KNOWN}`,
    );
  });

  it("leaves the hash out for a row from before it, and says nothing on the blank form", () => {
    expect(declarationProofLine({ version: 2, textHash: null, signature }, declarationWords("ro", NOW))).toBe("Versiunea 2 · Semnat la 24.09.2026, 18:05:12 (ora României)");
    expect(declarationProofLine({ version: 2, textHash: KNOWN }, declarationWords("ro", NOW))).toBeUndefined();
    expect(declarationProofLine(undefined, declarationWords("ro", NOW))).toBeUndefined();
  });
});
