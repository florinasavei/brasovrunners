import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_AGENT_MAX } from "@/modules/legal-documents/domain/signature-trace";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { type DeclarationEntry, declarationTraceLine, renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { DECLARATION_FOOTER_Y, drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §771 (the owner, 2026-10-14) — the signed PDF's signature block: the typed name large, in the handwriting face (Caveat, OFL,
 * `src/theme/pdf/`, embedded in pdfkit — no new file, no new dependency), and under it, small, «Semnat electronic la … ·
 * IP … · …» from the row's trace; then the version and the fingerprint as before. A paper acceptance keeps today's block. A
 * minor's declaration beside a parent's draws the same block once, with both typed names. One renderer draws it for the
 * race's declaration, the group run's and the volunteer agreement's.
 */
const WHEN = new Date("2026-09-24T15:05:12.000Z");
const NOW = new Date("2026-09-25T10:00:00.000Z");
const IP = "203.0.113.9";
const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const HASH = "a".repeat(64);

function entry(overrides: Partial<NonNullable<DeclarationEntry["signature"]>> = {}, extra: Partial<DeclarationEntry> = {}): DeclarationEntry {
  return {
    title: "Declarație pe proprie răspundere",
    body: { sections: [{ paragraphs: ["Subsemnatul/a {{participant}} declar că particip pe propria răspundere."] }] },
    values: { participant: "Ana Popescu" },
    eventTitle: "Crosul aniversar",
    version: 3,
    contentSha256: HASH,
    effectiveAt: new Date("2026-09-01T00:00:00Z"),
    textHash: "b".repeat(64),
    signature: {
      typedName: "Ana Popescu",
      idDocument: null,
      minor: null,
      signedAt: "24.09.2026, 18:05",
      signedAtInline: "24.09.2026, 18:05",
      acceptedAt: WHEN,
      method: "Semnat electronic din linkul trimis pe email",
      trace: { ip: IP, userAgent: BROWSER },
      ...overrides,
    },
    ...extra,
  };
}

const render = (entries: DeclarationEntry[], locale: "ro" | "en" = "ro") =>
  drawnRuns(() => renderDeclarationPdf({ entries, locale, generatedAt: NOW, labels: declarationWords(locale, NOW) }));

describe("§771 the line under an electronic signature, pure", () => {
  const ro = declarationWords("ro", NOW);
  const en = declarationWords("en", NOW);

  it("says when to the second on the club's clock, the address and the browser — in the declaration's language", () => {
    expect(declarationTraceLine(entry(), ro)).toBe(`Semnat electronic la 24.09.2026, 18:05:12 (ora României) · IP ${IP} · ${BROWSER}`);
    expect(declarationTraceLine(entry(), en)).toBe(`Signed electronically on 24.09.2026, 18:05:12 (Romania time) · IP ${IP} · ${BROWSER}`);
  });

  it("leaves out what was not kept, and says nothing at all of a paper acceptance, of a row from before the trace, or of the blank form", () => {
    expect(declarationTraceLine(entry({ trace: { ip: IP, userAgent: null } }), ro)).toBe(`Semnat electronic la 24.09.2026, 18:05:12 (ora României) · IP ${IP}`);
    expect(declarationTraceLine(entry({ trace: { ip: null, userAgent: BROWSER } }), ro)).toBe(`Semnat electronic la 24.09.2026, 18:05:12 (ora României) · ${BROWSER}`);
    expect(declarationTraceLine(entry({ trace: { ip: null, userAgent: null } }), ro)).toBeUndefined();
    expect(declarationTraceLine(entry({ trace: null }), ro)).toBeUndefined();
    expect(declarationTraceLine(entry({ trace: undefined }), ro)).toBeUndefined();
    expect(declarationTraceLine({ signature: undefined }, ro)).toBeUndefined();
    expect(declarationTraceLine(undefined, ro)).toBeUndefined();
  });
});

describe("§771 the signature block as drawn", () => {
  it("sets the typed name large, in the handwriting face, then the small trace line, then the version and the fingerprint", async () => {
    const runs = await render([entry()]);
    const name = runs.find((run) => run.text === "Ana Popescu" && run.size !== undefined && run.size >= 20);
    expect(name?.size).toBe(26);
    const trace = runs.find((run) => run.text.startsWith("Semnat electronic la "));
    expect(trace).toMatchObject({ text: `Semnat electronic la 24.09.2026, 18:05:12 (ora României) · IP ${IP} · ${BROWSER}`, size: 8 });
    const proof = runs.find((run) => run.text.includes(`sha256 ${HASH}`));
    expect(proof).toBeDefined();
    // In that order on the page: name, the trace, then the version and the fingerprint.
    expect(runs.indexOf(name!)).toBeLessThan(runs.indexOf(trace!));
    expect(runs.indexOf(trace!)).toBeLessThan(runs.indexOf(proof!));
    // Under the name, on the same page.
    expect(trace!.page).toBe(name!.page);
    expect(trace!.y!).toBeGreaterThan(name!.y!);
  });

  it("says the same in English", async () => {
    const runs = await render([entry({}, { title: "Declaration" })], "en");
    expect(runs.find((run) => run.text.startsWith("Signed electronically on "))?.text).toBe(`Signed electronically on 24.09.2026, 18:05:12 (Romania time) · IP ${IP} · ${BROWSER}`);
  });

  it("keeps today's block for a paper acceptance: no trace line", async () => {
    const runs = await render([entry({ trace: null, method: "Semnat pe hârtie, la masa de înscrieri; înregistrat de Ion" })]);
    expect(runs.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(runs.some((run) => run.text.includes("Semnat pe hârtie"))).toBe(true);
    expect(runs.some((run) => run.text.includes(`sha256 ${HASH}`))).toBe(true);
  });

  it("keeps today's block for the blank form the desk prints: dotted lines and no trace", async () => {
    const runs = await render([entry({}, { signature: undefined })]);
    expect(runs.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(runs.some((run) => run.text.includes("…………"))).toBe(true);
  });

  it("draws the same block once for a minor beside a parent, with both typed names large", async () => {
    const runs = await render([entry({ typedName: "Ana Popescu", minor: { typedName: "Ion Popescu", idDocument: null } })]);
    expect(runs.filter((run) => run.text.startsWith("Semnat electronic la "))).toHaveLength(1);
    for (const typed of ["Ion Popescu", "Ana Popescu"]) expect(runs.some((run) => run.text === typed && run.size === 26), typed).toBe(true);
    expect(runs.some((run) => run.text.includes("DREPT PENTRU CARE SEMNĂM"))).toBe(true);
  });

  it("draws one block per entry in a bundle: each signer's own trace, each under its own name", async () => {
    const runs = await render([entry(), entry({ typedName: "Bogdan Pop", trace: { ip: "198.51.100.4", userAgent: "curl/8.0" } })]);
    expect(runs.filter((run) => run.text.startsWith("Semnat electronic la ")).map((run) => run.text)).toEqual([
      `Semnat electronic la 24.09.2026, 18:05:12 (ora României) · IP ${IP} · ${BROWSER}`,
      "Semnat electronic la 24.09.2026, 18:05:12 (ora României) · IP 198.51.100.4 · curl/8.0",
    ]);
  });

  it("keeps the block together and above the footer, also with the longest browser string and a long text above it", async () => {
    const longText = Array.from({ length: 22 }, () => "Acest paragraf umple pagina până aproape de semnătură, ca blocul să trebuiască mutat dacă nu încape. ".repeat(4));
    const runs = await render([
      entry({ trace: { ip: "2001:db8:85a3:8d3:1319:8a2e:370:7344", userAgent: "M".repeat(USER_AGENT_MAX) } }, { body: { sections: [{ paragraphs: longText }] } }),
    ]);
    const trace = runs.find((run) => run.text.startsWith("Semnat electronic la "))!;
    const name = runs.find((run) => run.text === "Ana Popescu" && run.size === 26)!;
    // Name and trace on one page: the block is asked for together, so it moves whole.
    expect(trace.page).toBe(name.page);
    // Three lines at most (8 points, a 483-point measure): its last line ends above the footer's line.
    expect(trace.y! + 3 * 10).toBeLessThan(DECLARATION_FOOTER_Y);
  });

  it("embeds the handwriting font — Caveat, the site's own, with its licence beside it — and the body's Roboto", async () => {
    const pdf = await renderDeclarationPdf({ entries: [entry()], locale: "ro", generatedAt: NOW, labels: declarationWords("ro", NOW) });
    const text = pdf.toString("latin1");
    expect(text).toMatch(/\+Caveat/);
    expect(text).toMatch(/\+Roboto/);
    // Self-hosted with the others (V2.04): the file, and its OFL licence beside it — nothing fetched.
    const font = readFileSync("src/theme/pdf/Caveat-Regular.ttf");
    expect(font.byteLength).toBeGreaterThan(10_000);
    expect(readFileSync("src/theme/pdf/Caveat-LICENSE.txt", "utf8")).toContain("SIL Open Font License");
  });
});

describe("§771 one renderer draws the block for all three signed documents", () => {
  const source = (file: string) => readFileSync(file, "utf8");

  it("the race declaration, the group run's and the volunteer agreement's PDF all hand their entries to renderDeclarationPdf, and none of them draws a signature itself", () => {
    for (const file of ["src/modules/registrations/signed-declaration.ts", "src/modules/group-run-declarations/pdf.ts", "src/modules/volunteers/agreement-pdf.ts"]) {
      const text = source(file);
      expect(text, file).toContain("renderDeclarationPdf");
      expect(text, file).not.toMatch(/from "pdfkit"/);
      expect(text, file).not.toMatch(/registerFont|Caveat/);
    }
    // The trace line is composed in one place.
    for (const file of ["src/modules/registrations/signed-declaration.ts", "src/modules/group-run-declarations/pdf.ts", "src/modules/volunteers/agreement-pdf.ts"]) {
      expect(source(file), file).not.toContain("Semnat electronic la");
    }
  });

  // The writers take the trace as an optional argument, so a dropped one would type-check and every writer-level test would
  // still pass: the five electronic roads each read the request's headers, and none passes a literal.
  it("each of the five electronic actions reads the trace from the request's headers", () => {
    const actions = [
      "src/app/[locale]/registrations/declare/[token]/actions.ts",
      "src/app/[locale]/events/[slug]/declaration/actions.ts",
      "src/app/[locale]/events/[slug]/volunteers/actions.ts",
      "src/app/[locale]/volunteers/agreement/[token]/actions.ts",
      "src/app/[locale]/volunteers/guardian/[token]/actions.ts",
    ];
    for (const file of actions) {
      const text = source(file);
      expect(text, file).toContain("readSignatureTrace(");
      expect(text, file).toMatch(/readSignatureTrace\((await headers\(\)|requestHeaders)\)/);
    }
  });
});
