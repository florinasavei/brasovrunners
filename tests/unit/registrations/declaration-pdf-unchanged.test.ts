import { describe, expect, it } from "vitest";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import {
  DECLARATION_MARGIN,
  DECLARATION_PAGE,
  DECLARATION_SIGNATURE_COLUMNS,
  type DeclarationEntry,
  type DeclarationPart,
  renderDeclarationParts,
  renderDeclarationPdf,
} from "@/modules/registrations/declaration-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";
import { pdfContentDigest } from "../../helpers/pdf-content";

/**
 * §NNN (the owner, 2026-11-19: «pentru contractele de voluntariat trebuie să modific template-ul și să las în dreapta și
 * „Asociația” ca să printăm și să semnăm fizic») — the volunteer agreement's signature block gained the Association's column
 * on the right, and nothing else did: the race declaration (BR-REQ-033-02), its blank form for the desk, a minor's beside a
 * parent's (§330), the event's bundle (§418) and the group run's (§769) are drawn by the same renderer
 * (`renderDeclarationPdf`), and each is held here against the digest of the file the code drew before the column existed.
 *
 * `pdfContentDigest` is the file with its streams inflated, so the same digest is the same file byte for byte on any one
 * machine's zlib (`agreements-route.test.ts` holds the volunteer agreement's own the same way). The entries are pure and every
 * printed value is fixed, so a digest moves only when what is drawn moves.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const WHEN = new Date("2026-09-24T15:05:12.000Z");
const HASH = "c".repeat(64);
const TEXT_HASH = "d".repeat(64);
const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

/** A race declaration as a club approved it: a heading per clause, a bullet, fill-ins in bold (§225). */
const BODY: DeclarationEntry["body"] = {
  sections: [
    {
      heading: "1. Declarația",
      paragraphs: [
        "Subsemnatul/a {{participant}}, posesor al actului de identitate {{idDocument}}, declar că particip la {{event}}, pe propria răspundere.",
        "Declar că sunt apt din punct de vedere medical și că am citit regulamentul.",
      ],
    },
    {
      heading: "2. Ce înțeleg",
      paragraphs: [
        "• Înțeleg că traseul trece prin pădure și pe drumuri deschise circulației.",
        "• Înțeleg că organizatorul nu răspunde pentru obiectele pierdute.",
        "Am semnat {{signedAt}}.",
      ],
    },
  ],
};

const VALUES = { participant: "Ana Popescu", idDocument: "BV 123456", event: "Crosul aniversar", signedAt: "joi, 24 sept. 2026, la 18:05" };

function signed(overrides: Partial<NonNullable<DeclarationEntry["signature"]>> = {}, extra: Partial<DeclarationEntry> = {}): DeclarationEntry {
  return {
    title: "Declarație pe proprie răspundere",
    body: BODY,
    values: VALUES,
    eventTitle: "Crosul aniversar",
    version: 3,
    contentSha256: HASH,
    effectiveAt: new Date("2026-09-01T00:00:00Z"),
    textHash: TEXT_HASH,
    signature: {
      typedName: "Ana Popescu",
      idDocument: "BV 123456",
      minor: null,
      signedAt: "Joi, 24 sept. 2026, la 18:05",
      signedAtInline: "joi, 24 sept. 2026, la 18:05",
      acceptedAt: WHEN,
      method: "Semnat electronic joi, 24 sept. 2026, la 18:05, din linkul unic trimis pe adresa de email a înscrierii.",
      trace: { ip: "203.0.113.9", userAgent: BROWSER },
      ...overrides,
    },
    ...extra,
  };
}

/** The blank form the desk prints: the text with its dots, no signature. */
function blank(extra: Partial<DeclarationEntry> = {}): DeclarationEntry {
  return { title: "Declarație pe proprie răspundere", body: BODY, values: { event: "Crosul aniversar" }, eventTitle: "Crosul aniversar", version: 3, contentSha256: HASH, effectiveAt: new Date("2026-09-01T00:00:00Z"), ...extra };
}

/** A text long enough that the signature block cannot stay on the first page and moves whole to the next. */
const LONG_BODY: DeclarationEntry["body"] = {
  sections: [{ heading: "1. Declarația", paragraphs: Array.from({ length: 9 }, () => "Acest paragraf umple pagina până aproape de semnătură, ca blocul să trebuiască mutat dacă nu încape. ".repeat(4)) }],
};

const ro = declarationWords("ro", NOW);
const en = declarationWords("en", NOW);

/** Every shape the race's renderer draws for something that is not a volunteer agreement, in one file each. */
const SHAPES: Record<string, () => Promise<Buffer>> = {
  // The runner's copy, signed from the link: the name in its hand, the trace, the method, the version and the proof (§771, §556).
  signedByLink: () => renderDeclarationPdf({ entries: [signed()], locale: "ro", generatedAt: NOW, labels: ro }),
  // Recorded on paper at the desk, in English: no trace.
  signedOnPaperEn: () =>
    renderDeclarationPdf({
      entries: [signed({ trace: null, method: "Signed on paper at the registration desk; recorded by Ion Pop on Thursday, 24 Sept 2026 at 18:05." }, { title: "Declaration" })],
      locale: "en",
      generatedAt: NOW,
      labels: en,
    }),
  // A minor beside a parent (§330): both signatures and both documents under one date, «DREPT PENTRU CARE SEMNĂM».
  minorBesideParent: () =>
    renderDeclarationPdf({ entries: [signed({ typedName: "Maria Popescu", minor: { typedName: "Ion Popescu", idDocument: "BV 654321" } })], locale: "ro", generatedAt: NOW, labels: ro }),
  // The group run's minor beside a parent (§769): no document asked of either.
  groupRunMinor: () =>
    renderDeclarationPdf({ entries: [signed({ typedName: "Maria Popescu", idDocument: null, minor: { typedName: "Ion Popescu", idDocument: null } })], locale: "ro", generatedAt: NOW, labels: ro }),
  // The blank form, an adult's and a minor's (§95, §330): the dotted lines.
  blankForm: () => renderDeclarationPdf({ entries: [blank()], locale: "ro", generatedAt: NOW, labels: ro }),
  blankFormForMinor: () => renderDeclarationPdf({ entries: [blank({ forMinor: true })], locale: "ro", generatedAt: NOW, labels: ro }),
  // The event's bundle, while it carries whole identity documents (§418): two entries, the footer's second line.
  eventBundle: () =>
    renderDeclarationPdf({
      entries: [signed(), signed({ typedName: "Bogdan Pop", idDocument: "BV 999888", trace: { ip: "198.51.100.4", userAgent: "curl/8.0" } })],
      locale: "ro",
      generatedAt: NOW,
      labels: ro,
      idDocumentsNotice: ro.idDocumentsNotice,
    }),
  // A long text pushes the block to the next page, and a long name under a long label goes under it.
  blockOnTheNextPage: () =>
    renderDeclarationPdf({
      entries: [signed({ typedName: "Alexandra-Maria Constantinescu-Popovici", minor: { typedName: "Ioana-Alexandra Constantinescu-Popovici", idDocument: null } }, { body: LONG_BODY })],
      locale: "ro",
      generatedAt: NOW,
      labels: ro,
    }),
  // The renderer's own flags without the Association's column — no document line, a signer's own label — draw as they did.
  noIdDocumentWithOwnLabel: () =>
    renderDeclarationPdf({ entries: [signed({ idDocument: null }, { noIdDocument: true, signatureLabel: "Semnătura părintelui sau tutorelui" }), blank({ forMinor: true, noIdDocument: true })], locale: "ro", generatedAt: NOW, labels: ro }),
  // Several documents in one file (§966): each part its own pages and count; an empty part is the page that says so.
  parts: () => {
    const parts: [DeclarationPart, ...DeclarationPart[]] = [
      { entries: [signed()], labels: ro },
      { entries: [blank()], labels: en },
      { entries: [], labels: ro },
    ];
    return renderDeclarationParts(parts, { locale: "ro", generatedAt: NOW });
  },
};

describe("§NNN the race declaration's PDF draws exactly what it drew before the Association's column (BR-REQ-033-02)", () => {
  /*
    Captured from the code as it stood before the volunteer agreement's signature block learned a second column (§NNN). A change
    to the race declaration's own PDF captures them again, deliberately; the Association's column moved none.
  */
  const GOLDEN: Record<keyof typeof SHAPES, string> = {
    signedByLink: "cfbe08d1c25f3a3cc3153225abcc2ef98ed57b60952cb24eb0178135a155f717",
    signedOnPaperEn: "a43845947981d3d57eab6bee86de5685c1dc315f96ac0a9b1dc3912dc06693c4",
    minorBesideParent: "5390401e4333a5c42d16dd76a488b0c8cfffd5b4bff4ba57e3deb5716afe0e7a",
    groupRunMinor: "bffb5e750bb12eb82c26ef4b812aad66f641cbf434b3ecde321d6c747de5f902",
    blankForm: "610c0b40f38b51ac7d2ceb33f3624bc80f42bc24e75129dfae915fcda265c204",
    blankFormForMinor: "5b93a7e9b5eeff5a67013d473441bfe8a1743854790068f85fe0c18eb92fa978",
    eventBundle: "20823e877245c0a2838a89af4ae54ea6b1628d9abcac61c945ad12026d59f6cc",
    blockOnTheNextPage: "2965109c45856d77fb3778b61b55b071c67a70929640fedeb0787788149e64ec",
    noIdDocumentWithOwnLabel: "4f978db4fbbfe242432b72b1b1fdf60fd711bea97fca7e76db9b07e1e1a92070",
    parts: "e4eb0164e927aa88768e9dd07635e3405884ba16fca0f2a84b5dcbd8ac820272",
  };

  it("is byte for byte the same file for every shape: signed by link or on paper, a minor beside a parent, the blank forms, the bundle and the parts", async () => {
    const seen: Record<string, string> = {};
    for (const [name, render] of Object.entries(SHAPES)) seen[name] = pdfContentDigest(await render());
    expect(seen, "the race declaration's PDF changed: when the change is deliberate, the digests received here are the new GOLDEN").toEqual(GOLDEN);
  });

  it("names no Association and draws no column of a host: its signature block's rows all start left of where the host's would", async () => {
    for (const [name, render] of Object.entries(SHAPES)) {
      const runs = await drawnRuns(render);
      expect(runs.some((run) => /Asocia(ț|t)ia|The Association|Reprezentant|Representative/.test(run.text)), name).toBe(false);
      for (const [index, run] of runs.entries()) {
        if (!/^(DREPT PENTRU CARE SEMN|IN WITNESS WHEREOF)/.test(run.text)) continue;
        // The block down the left margin, as it always was: every row from the margin, every value beside its label.
        const block = runs.slice(index + 1).filter((next) => next.page === run.page && (next.y ?? 0) < DECLARATION_PAGE.height - DECLARATION_MARGIN.bottom);
        expect(block.length, name).toBeGreaterThan(0);
        for (const next of block) expect(next.x, `${name}: «${next.text}»`).toBeLessThan(DECLARATION_SIGNATURE_COLUMNS.host.x);
      }
    }
  });
});
