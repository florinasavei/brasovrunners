import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER_AGENT_MAX } from "@/modules/legal-documents/domain/signature-trace";
import { DECLARATION_MARGIN, DECLARATION_PAGE, DECLARATION_SIGNATURE_COLUMNS, type DeclarationEntry, renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { acceptedHowWords, agreementHostName, guardianHowWords, guardianPendingWords, volunteerAgreementLabels } from "@/modules/volunteers/agreement-pdf";
import { CLUB_NAME } from "@/theme/brand";
import { type MeasuredRun, measuredRuns } from "../../helpers/pdf-drawn";

/**
 * §NNN (amending §758 and §966; the owner, 2026-11-19, two days before the race: «pentru contractele de voluntariat trebuie să
 * modific template-ul și să las în dreapta și „Asociația” ca să printăm și să semnăm fizic») — the volunteer agreement is signed
 * by both parties on paper: every shape's signature block is two columns under «DREPT PENTRU CARE SEMNĂM», the volunteer's
 * side on the left exactly as it was, and on the right «Asociația», the club's legal name and the lines its representative
 * fills in by hand (BR-REQ-053-03).
 *
 * Drawn here from the entries `agreement-pdf.ts` builds — the accepted copy, the sheet to sign, a minor's sheet, a minor whose
 * parent's consent is to come, the parent's own entry — through the renderer the race declaration shares, and read as
 * `measuredRuns` catches them: every word, where it starts, how wide it may run. The rows behind them are the integration test's
 * (`tests/integration/volunteers/agreements-route.test.ts`).
 */
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));

vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  const env = new Proxy(actual.env, {
    get: (target, key) => (typeof key === "string" && key in state.env ? state.env[key] : Reflect.get(target, key)),
  });
  return { ...actual, env };
});

/** Made up, as every legal fact in the repository is (§98). */
const LEGAL_NAME = "Asociația Exemplu";
const NOW = new Date("2026-11-19T09:00:00.000Z");
const ACCEPTED = new Date("2026-11-10T18:15:00.000Z");
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const { signer, host } = DECLARATION_SIGNATURE_COLUMNS;
const MIDDLE = DECLARATION_PAGE.width / 2;
const TEXT_WIDTH = DECLARATION_PAGE.width - DECLARATION_MARGIN.left - DECLARATION_MARGIN.right;
/** Where the page's text ends: under it only the footer, drawn after every entry. */
const BOTTOM = DECLARATION_PAGE.height - DECLARATION_MARGIN.bottom;

/** A text's height as pdfkit sets it — the renderer's faces, a size, a width — to find where a wrapped run ends. */
const measuring = new PDFDocument({ size: "A4", margins: DECLARATION_MARGIN });
measuring.registerFont("body", readFileSync("src/theme/pdf/Roboto-Regular.ttf"));
measuring.registerFont("hand", readFileSync("src/theme/pdf/Caveat-Regular.ttf"));
const heightOf = (text: string, size: number, width: number, face: "body" | "hand" = "body") => measuring.font(face).fontSize(size).heightOfString(text, { width });
/** Where a run that wraps ends, in its own face; a run on one line, where it starts. */
const bottomOf = (run: MeasuredRun) => run.y! + (run.width ? heightOf(run.text, run.size!, run.width, run.font?.startsWith("Caveat") ? "hand" : "body") : 0);

function body(paragraphs = 1): DeclarationEntry["body"] {
  return {
    sections: [
      {
        heading: "1. Părțile",
        paragraphs: [
          "Organizația gazdă și {{volunteer}}, ca voluntar, încheie prezentul contract.",
          ...Array.from({ length: paragraphs - 1 }, () => "Acest paragraf umple pagina, ca blocul semnăturilor să ajungă unde nu mai încape și să treacă întreg pe pagina următoare. ".repeat(3)),
        ],
      },
    ],
  };
}

type Shape = { entry: DeclarationEntry; guardian?: boolean };

function base(volunteer: string, extra: Partial<DeclarationEntry> = {}): DeclarationEntry {
  return {
    title: "Contract de voluntariat",
    body: body(),
    values: { volunteer },
    eventTitle: "Crosul",
    version: 1,
    contentSha256: "c".repeat(64),
    effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
    noIdDocument: true,
    ...extra,
  };
}

function accepted(volunteer: string, signature: Partial<NonNullable<DeclarationEntry["signature"]>> = {}, extra: Partial<DeclarationEntry> = {}): DeclarationEntry {
  return base(volunteer, {
    textHash: "d".repeat(64),
    signature: {
      typedName: volunteer,
      idDocument: null,
      minor: null,
      signedAt: "Marți, 10 nov. 2026, 20:15",
      signedAtInline: "marți, 10 nov. 2026, la 20:15",
      acceptedAt: ACCEPTED,
      trace: { ip: "203.0.113.9", userAgent: BROWSER },
      method: acceptedHowWords("ro", "FORM", "marți, 10 nov. 2026, la 20:15", null),
      ...signature,
    },
    ...extra,
  });
}

/** Every shape of the agreement's PDF, as `agreement-pdf.ts` builds its entries (§758, §768). */
const SHAPES: Record<string, Shape> = {
  acceptedOnTheForm: { entry: accepted("Ana Pop") },
  acceptedOnPaper: { entry: accepted("Ion Pop", { trace: null, method: acceptedHowWords("ro", "PAPER", "joi, 12 nov. 2026, la 11:00", "Ana Admin") }) },
  // The sheet to sign at the desk: the volunteer's line and the date on the left, nothing typed.
  sheet: { entry: base("Ion Popescu") },
  // A minor's sheet (§768): the volunteer's line and the parent's or guardian's under it.
  minorSheet: { entry: base("Dan Tânărul", { forMinor: true }), guardian: true },
  // A minor who accepted, the parent's consent still to come.
  minorPending: {
    entry: accepted("Ioana Mică", { method: [acceptedHowWords("ro", "LINK", "miercuri, 11 nov. 2026, la 12:00", null), guardianPendingWords("ro", "Elena Mică")].join("\n") }),
  },
  // The parent's own entry, beside the volunteer's once they accepted: their line, their name in its hand.
  guardianEntry: {
    entry: accepted(
      "Radu Tânăr",
      { typedName: "Mihai Tânăr", method: guardianHowWords("ro", "LINK", "vineri, 13 nov. 2026, la 21:30", "Mihai Tânăr", null), trace: { ip: "203.0.113.20", userAgent: "Mozilla/5.0 (Android 14) Firefox/131.0" } },
      { signatureLabel: "Semnătura părintelui sau tutorelui" },
    ),
  },
};

const render = (entries: DeclarationEntry[], { locale = "ro" as "ro" | "en", guardian = false, hostName = LEGAL_NAME } = {}) =>
  measuredRuns(() => renderDeclarationPdf({ entries, locale, generatedAt: NOW, labels: volunteerAgreementLabels(locale, NOW, guardian, hostName) }));

/** One entry's signature block as drawn: the heading, every run under it on its page, and none of the footer's. */
type Block = { heading: MeasuredRun; left: MeasuredRun[]; right: MeasuredRun[]; under: MeasuredRun[] };

function blocks(runs: MeasuredRun[]): Block[] {
  const found: Block[] = [];
  runs.forEach((run, index) => {
    if (!/^(DREPT PENTRU CARE SEMN|IN WITNESS WHEREOF)/.test(run.text)) return;
    const after = runs.slice(index + 1);
    const end = after.findIndex((next) => next.page !== run.page || /^(CONTRACT DE VOLUNTARIAT|VOLUNTEER AGREEMENT)$/.test(next.text) || (next.y ?? 0) >= BOTTOM);
    const own = end === -1 ? after : after.slice(0, end);
    found.push({
      heading: run,
      left: own.filter((next) => next.width !== TEXT_WIDTH && (next.x ?? 0) < host.x),
      right: own.filter((next) => (next.x ?? 0) >= host.x),
      under: own.filter((next) => next.width === TEXT_WIDTH),
    });
  });
  return found;
}

/** Where a run's words may reach: its own width when it wraps, its words' width on one line when it does not. */
const rightEdge = (run: MeasuredRun) => (run.x ?? 0) + (run.width ?? run.measured);
const texts = (runs: MeasuredRun[]) => runs.map((run) => run.text);
const DOTS = /^…+$/;

beforeEach(() => {
  state.env = { CLUB_LEGAL_NAME: LEGAL_NAME };
});

describe("§NNN the Association's column on the right of every shape (BR-REQ-053-03)", () => {
  it("holds «Asociația», the club's legal name and a dotted line under each of the representative's three labels, past the page's middle", async () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      const [block] = blocks(await render([shape.entry], { guardian: shape.guardian }));
      expect(block, name).toBeDefined();
      expect(texts(block.right), name).toEqual(["Asociația", LEGAL_NAME, "Reprezentant (nume și funcție):", expect.stringMatching(DOTS), "Semnătura:", expect.stringMatching(DOTS), "Data:", expect.stringMatching(DOTS)]);
      for (const run of block.right) {
        expect(run.x!, `${name}: «${run.text}»`).toBeGreaterThan(MIDDLE);
        expect(run.x!, `${name}: «${run.text}»`).toBeCloseTo(host.x, 6);
        expect(rightEdge(run), `${name}: «${run.text}»`).toBeLessThanOrEqual(host.x + host.width + 0.01);
        expect(run.page, name).toBe(block.heading.page);
      }
      // Each dotted line under its label, as wide as the column lets it be.
      for (const dots of block.right.filter((run) => DOTS.test(run.text))) expect(dots.measured, name).toBeGreaterThan(host.width - 8);
    }
  });

  it("says «DREPT PENTRU CARE SEMNĂM» above both columns, and the version, the fingerprint and the proof across the page under them", async () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      const [block] = blocks(await render([shape.entry], { guardian: shape.guardian }));
      expect(block.heading.text, name).toBe("DREPT PENTRU CARE SEMNĂM,");
      const columns = [...block.left, ...block.right];
      for (const run of columns) expect(run.y!, `${name}: «${run.text}»`).toBeGreaterThan(block.heading.y!);
      expect(block.under, name).toHaveLength(1);
      const [tail] = block.under;
      expect(tail.text, name).toContain(`Versiunea 1 · sha256 ${"c".repeat(64)}`);
      if (shape.entry.signature) expect(tail.text, name).toContain(`Amprenta documentului (SHA-256): ${"d".repeat(64)}`);
      // Under the bottom of both columns: the last line of each ends above it.
      for (const run of columns) expect(tail.y!, `${name}: «${run.text}»`).toBeGreaterThanOrEqual(bottomOf(run));
      expect(tail.y! + heightOf(tail.text, 8.5, TEXT_WIDTH), name).toBeLessThanOrEqual(BOTTOM);
    }
  });

  it("keeps the volunteer's side on the left as it was: the name in its hand, the date, the trace and how it was accepted", async () => {
    const [block] = blocks(await render([SHAPES.acceptedOnTheForm.entry]));
    expect(texts(block.left)).toEqual([
      "Semnătura voluntarului:",
      "Ana Pop",
      "Data:",
      "Marți, 10 nov. 2026, 20:15",
      `Semnat electronic la 10.11.2026, 20:15:00 (ora României) · IP 203.0.113.9 · ${BROWSER}`,
      acceptedHowWords("ro", "FORM", "marți, 10 nov. 2026, la 20:15", null),
    ]);
    // The typed name large, in the handwriting face, on its label's line (§771).
    const name = block.left[1];
    expect(name.size).toBe(26);
    expect(name.y!).toBeLessThan(block.left[0].y!);
    for (const run of block.left) {
      expect(run.x!, run.text).toBeGreaterThanOrEqual(signer.x);
      expect(rightEdge(run), run.text).toBeLessThanOrEqual(signer.x + signer.width + 0.01);
      expect(rightEdge(run), run.text).toBeLessThan(MIDDLE);
    }
    // On paper: who recorded it, no trace.
    const [paper] = blocks(await render([SHAPES.acceptedOnPaper.entry]));
    expect(texts(paper.left)).toEqual(["Semnătura voluntarului:", "Ion Pop", "Data:", "Marți, 10 nov. 2026, 20:15", acceptedHowWords("ro", "PAPER", "joi, 12 nov. 2026, la 11:00", "Ana Admin")]);
    // Still to come: the parent's consent, under the volunteer's own acceptance, on the left.
    const [pending] = blocks(await render([SHAPES.minorPending.entry]));
    expect(pending.left.at(-1)?.text).toContain("Acordul părintelui sau tutorelui, Elena Mică: încă neprimit.");
  });

  it("prints the sheet with the volunteer's line and the date on the left — the organizer's line is the Association's column now — and a minor's with the parent's line under the volunteer's", async () => {
    const [sheet] = blocks(await render([SHAPES.sheet.entry]));
    expect(texts(sheet.left)).toEqual(["Semnătura voluntarului:", expect.stringMatching(DOTS), "Data:", expect.stringMatching(DOTS)]);
    const [minor] = blocks(await render([SHAPES.minorSheet.entry], { guardian: true }));
    expect(texts(minor.left)).toEqual(["Semnătura voluntarului:", expect.stringMatching(DOTS), "Semnătura părintelui sau tutorelui:", expect.stringMatching(DOTS), "Data:", expect.stringMatching(DOTS)]);
    for (const block of [sheet, minor]) {
      for (const run of block.left) expect(rightEdge(run), run.text).toBeLessThanOrEqual(signer.x + signer.width + 0.01);
      expect(texts([...block.left, ...block.right]).join(" ")).not.toMatch(/Pentru organizator|For the organiser/);
    }
  });

  it("stands beside each entry of a minor's copy once the parent accepted: the volunteer's own and the parent's", async () => {
    const found = blocks(await render([SHAPES.minorPending.entry, SHAPES.guardianEntry.entry]));
    expect(found).toHaveLength(2);
    expect(found.map((block) => block.left[0].text)).toEqual(["Semnătura voluntarului:", "Semnătura părintelui sau tutorelui:"]);
    expect(found.map((block) => block.left[1].text)).toEqual(["Ioana Mică", "Mihai Tânăr"]);
    for (const block of found) expect(texts(block.right).slice(0, 2)).toEqual(["Asociația", LEGAL_NAME]);
  });

  it("says it in English on an English agreement", async () => {
    const entry = accepted("John Smith", { signedAt: "Tuesday, 10 November 2026 at 20:15", method: acceptedHowWords("en", "LINK", "Tuesday, 10 November 2026 at 20:15", null) }, { title: "Volunteer agreement" });
    const [block] = blocks(await render([entry], { locale: "en" }));
    expect(block.heading.text).toBe("IN WITNESS WHEREOF, WE SIGN,");
    expect(texts(block.right)).toEqual(["The Association", LEGAL_NAME, "Representative (name and position):", expect.stringMatching(DOTS), "Signature:", expect.stringMatching(DOTS), "Date:", expect.stringMatching(DOTS)]);
    expect(texts(block.left).slice(0, 4)).toEqual(["Volunteer's signature:", "John Smith", "Date:", "Tuesday, 10 November 2026 at 20:15"]);
    for (const run of block.left) expect(rightEdge(run), run.text).toBeLessThanOrEqual(signer.x + signer.width + 0.01);
  });
});

describe("§NNN nothing crosses its column, the margin or the page", () => {
  it("sets a long name under its label, smaller until it fits the column, and wraps the longest browser string and the method inside it", async () => {
    const long = "Alexandra-Maria Constantinescu-Popovici";
    const longer = "Alexandra-Maria Ioana Constantinescu-Popovici-Dumitrescu";
    const entry = accepted(long, { trace: { ip: "2001:db8:85a3:8d3:1319:8a2e:370:7344", userAgent: "M".repeat(USER_AGENT_MAX) }, method: acceptedHowWords("ro", "LINK", "marți, 10 nov. 2026, la 20:15", null) });
    // And the parent's, whose long label leaves no room beside it; and a legal name long enough to wrap.
    const parent = accepted(long, { typedName: longer, method: guardianHowWords("ro", "LINK", "vineri, 13 nov. 2026, la 21:30", longer, null) }, { signatureLabel: "Semnătura părintelui sau tutorelui" });
    const longHost = `${LEGAL_NAME} — Clubul Sportiv al Alergătorilor din Localitate, Filiala de Munte și de Șosea`;
    const found = blocks(await render([entry, parent], { hostName: longHost }));
    expect(found).toHaveLength(2);
    for (const block of found) {
      for (const run of block.left) {
        expect(run.x!, run.text).toBeGreaterThanOrEqual(signer.x);
        expect(rightEdge(run), run.text).toBeLessThanOrEqual(signer.x + signer.width + 0.01);
      }
      for (const run of block.right) expect(rightEdge(run), run.text).toBeLessThanOrEqual(host.x + host.width + 0.01);
      const [tail] = block.under;
      for (const run of [...block.left, ...block.right]) expect(tail.y!, run.text).toBeGreaterThanOrEqual(bottomOf(run));
      expect(tail.y! + heightOf(tail.text, 8.5, TEXT_WIDTH)).toBeLessThanOrEqual(BOTTOM);
    }
    // The name under its label, set smaller to fit on one line; a longer one wraps inside the column at the smallest.
    const [first, second] = found.map((block) => block.left.find((run) => run.text.startsWith("Alexandra-Maria"))!);
    expect(first.text).toBe(long);
    expect(first.size!).toBeLessThan(26);
    expect(first.size!).toBeGreaterThan(14);
    expect(first.width).toBeUndefined();
    expect(first.measured).toBeLessThanOrEqual(signer.width - 14);
    expect(second.text).toBe(longer);
    expect(second.size).toBe(14);
    expect(second.width).toBe(signer.width - 14);
    expect(second.measured).toBeGreaterThan(signer.width - 14);
    // Each starts under its label, never on it.
    for (const block of found) {
      const label = block.left[0];
      const name = block.left[1];
      expect(name.y!).toBeGreaterThan(label.y!);
    }
    // The legal name wraps inside its column.
    expect(found[0].right[1]).toMatchObject({ text: longHost, width: host.width });
  });

  it("moves the whole block to the next page when it does not fit, never splitting it, and never runs into the footer", async () => {
    const pages = new Set<number>();
    for (let paragraphs = 1; paragraphs <= 26; paragraphs++) {
      const runs = await render([{ ...SHAPES.minorPending.entry, body: body(paragraphs) }]);
      const [block] = blocks(runs);
      const all = [block.heading, ...block.left, ...block.right, ...block.under];
      for (const run of all) expect(run.page, `${paragraphs}: «${run.text}»`).toBe(block.heading.page);
      const [tail] = block.under;
      expect(tail.y! + heightOf(tail.text, 8.5, TEXT_WIDTH), String(paragraphs)).toBeLessThanOrEqual(BOTTOM);
      // The text's last paragraph, when it starts on the block's page, ends above the block: set as the renderer sets a paragraph.
      const lastParagraph = runs.filter((run) => run.text.startsWith("Acest paragraf")).at(-1);
      if (lastParagraph?.page === block.heading.page) {
        const paragraphBottom = lastParagraph.y! + measuring.font("body").fontSize(10.5).heightOfString(lastParagraph.text, { width: TEXT_WIDTH, lineGap: 2 });
        expect(paragraphBottom, String(paragraphs)).toBeLessThan(block.heading.y!);
      }
      pages.add(block.heading.page);
    }
    // The sweep crossed a page's foot: the block stood on the first page, then moved on.
    expect(pages.size).toBeGreaterThanOrEqual(2);
    expect(pages.has(0)).toBe(true);
  });
});

describe("§NNN the club's legal name, never a literal", () => {
  it("is the fact the legal templates are filled with, else the club's one name", () => {
    state.env = { CLUB_LEGAL_NAME: LEGAL_NAME };
    expect(agreementHostName()).toBe(LEGAL_NAME);
    expect(volunteerAgreementLabels("ro", NOW).hostSignature?.name).toBe(LEGAL_NAME);
    state.env = { CLUB_LEGAL_NAME: undefined };
    expect(agreementHostName()).toBe(CLUB_NAME);
    expect(volunteerAgreementLabels("en", NOW).hostSignature).toEqual({ heading: "The Association", name: CLUB_NAME, lines: ["Representative (name and position)", "Signature", "Date"] });
    expect(volunteerAgreementLabels("ro", NOW).hostSignature).toEqual({ heading: "Asociația", name: CLUB_NAME, lines: ["Reprezentant (nume și funcție)", "Semnătura", "Data"] });
  });

  it("is drawn as the configuration says it on the PDF itself, whichever it is", async () => {
    state.env = { CLUB_LEGAL_NAME: undefined };
    const drawn = await measuredRuns(() => renderDeclarationPdf({ entries: [SHAPES.sheet.entry], locale: "ro", generatedAt: NOW, labels: volunteerAgreementLabels("ro", NOW) }));
    expect(texts(blocks(drawn)[0].right).slice(0, 2)).toEqual(["Asociația", CLUB_NAME]);
  });
});
