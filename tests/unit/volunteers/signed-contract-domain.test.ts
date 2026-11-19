import { describe, expect, it } from "vitest";
import { SIGNED_CONTRACT_MAX_BYTES, SIGNED_CONTRACT_NAME_MAX } from "@/db/schema/event-volunteer-documents";
import { BROWSER_SEND_BYTES } from "@/modules/media/limits";
import { formatBytes } from "@/modules/media/ui/stored-facts";
import {
  cleanFileName,
  downloadNameOf,
  foldPersonName,
  matchContractFiles,
  mayBeSignedContract,
  nameInContractFile,
  SIGNED_CONTRACT_ACCEPT,
  SIGNED_CONTRACT_FORMATS,
  SIGNED_CONTRACT_PART_BYTES,
  sniffSignedContract,
} from "@/modules/volunteers/domain/signed-contract";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { pdfOfSize, SAMPLE_FILES } from "../../helpers/signed-contract-files";

/**
 * «Contract semnat» (§998), the pure half: what a file is, read from its own bytes and never from its name; the name kept as it was
 * uploaded, made safe; and which volunteer of the event a file of «Încarcă contractele semnate» is, by the name it carries.
 */

describe("§998 a signed agreement is what its own bytes say", () => {
  it("reads a PDF, a Word file (DOCX and DOC), a JPEG, a PNG and a phone's HEIC / HEIF", () => {
    expect(sniffSignedContract(SAMPLE_FILES.pdf())).toBe("PDF");
    expect(sniffSignedContract(SAMPLE_FILES.docx())).toBe("DOCX");
    expect(sniffSignedContract(SAMPLE_FILES.doc())).toBe("DOC");
    expect(sniffSignedContract(SAMPLE_FILES.jpeg())).toBe("JPEG");
    expect(sniffSignedContract(SAMPLE_FILES.png())).toBe("PNG");
    expect(sniffSignedContract(SAMPLE_FILES.heic())).toBe("HEIC");
    expect(sniffSignedContract(SAMPLE_FILES.heif())).toBe("HEIF");
  });

  it("refuses everything else whatever it is named: a program, a page, text, an AVIF, an Excel (new or old), a plain archive, nothing", () => {
    for (const kind of ["exe", "html", "text", "avif", "xlsx", "xls", "zip"] as const) expect(sniffSignedContract(SAMPLE_FILES[kind]()), kind).toBeNull();
    expect(sniffSignedContract(new Uint8Array())).toBeNull();
  });

  it("takes a PDF whose signature stands within the first kilobyte, and no later", () => {
    const late = (at: number) => Buffer.concat([Buffer.alloc(at, 0x20), SAMPLE_FILES.pdf()]);
    expect(sniffSignedContract(late(3))).toBe("PDF");
    expect(sniffSignedContract(late(1024))).toBe("PDF");
    expect(sniffSignedContract(late(1025))).toBeNull();
  });

  it("never takes a file that opens with another signature for a PDF because «%PDF-» is written inside it", () => {
    const zipWithPdfText = Buffer.concat([SAMPLE_FILES.zip(), Buffer.from("%PDF-1.7", "latin1")]);
    expect(sniffSignedContract(zipWithPdfText)).toBeNull();
  });

  it("lets the first piece of a large file go on only when it opens like one of the formats", () => {
    for (const kind of ["pdf", "docx", "doc", "jpeg", "png", "heic", "heif"] as const) expect(mayBeSignedContract(SAMPLE_FILES[kind]()), kind).toBe(true);
    for (const kind of ["exe", "html", "text", "avif"] as const) expect(mayBeSignedContract(SAMPLE_FILES[kind]()), kind).toBe(false);
  });

  it("serves each format with its own type, and offers the picker the extensions and the types", () => {
    expect(SIGNED_CONTRACT_FORMATS.PDF.contentType).toBe("application/pdf");
    expect(SIGNED_CONTRACT_FORMATS.DOCX.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(SIGNED_CONTRACT_FORMATS.DOC.contentType).toBe("application/msword");
    expect(SIGNED_CONTRACT_FORMATS.HEIC.contentType).toBe("image/heic");
    for (const piece of [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png", ".heic", ".heif", "application/pdf", "image/heic"]) expect(SIGNED_CONTRACT_ACCEPT.split(","), piece).toContain(piece);
  });

  it("is ten megabytes at most, sent in pieces of the house's browser send limit, under the host's 4.5 MB request", () => {
    expect(SIGNED_CONTRACT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(SIGNED_CONTRACT_PART_BYTES).toBe(BROWSER_SEND_BYTES);
    expect(SIGNED_CONTRACT_PART_BYTES).toBeLessThan(4.5 * 1000 * 1000);
    expect(pdfOfSize(SIGNED_CONTRACT_MAX_BYTES)).toHaveLength(SIGNED_CONTRACT_MAX_BYTES);
    expect(formatBytes(SIGNED_CONTRACT_MAX_BYTES, "ro")).toBe("10 MB");
    // The limit is written once: the card's intro and the upload's reason say it through `{max}`, filled from the constant, and
    // the refusal names no number, so a changed limit can never leave a sentence saying the old one.
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.volunteers.contract.intro).toContain("{max}");
      expect(catalogue.Admin.volunteers.contract.reasons.tooLarge).toContain("{max}");
      expect(catalogue.Admin.errors.VOLUNTEER_CONTRACT_TOO_LARGE).not.toMatch(/\d/);
    }
  });
});

describe("§998 the name a signed agreement keeps, and the one it downloads under", () => {
  it("keeps the name as uploaded, without a path, control characters or the marks that turn a line's direction", () => {
    expect(cleanFileName("Contract-voluntariat-Anais-Meyson.docx")).toBe("Contract-voluntariat-Anais-Meyson.docx");
    expect(cleanFileName("C:\\fakepath\\Contract Ana Pop.pdf")).toBe("Contract Ana Pop.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("contract\u202Efdp.exe")).toBe("contractfdp.exe");
    expect(cleanFileName("con\u0000tract\n  semnat .pdf")).toBe("contract semnat .pdf");
    expect(cleanFileName("Mus\u0326at.pdf")).toBe("Mușat.pdf");
    expect(cleanFileName("   ")).toBe("");
  });

  it("cuts a long name at the limit and keeps its extension", () => {
    const cut = cleanFileName(`${"Ă".repeat(400)}.docx`);
    expect([...cut]).toHaveLength(SIGNED_CONTRACT_NAME_MAX);
    expect(cut.endsWith(".docx")).toBe(true);
  });

  it("downloads under the name it came with, adding the format's extension only when the name does not say it", () => {
    expect(downloadNameOf("Contract-voluntariat-Ana-Pop.docx", "DOCX")).toBe("Contract-voluntariat-Ana-Pop.docx");
    expect(downloadNameOf("IMG_1234.JPG", "JPEG")).toBe("IMG_1234.JPG");
    expect(downloadNameOf("scan.jpeg", "JPEG")).toBe("scan.jpeg");
    expect(downloadNameOf("contract.pdf", "JPEG")).toBe("contract.pdf.jpg");
    expect(downloadNameOf("contract", "PDF")).toBe("contract.pdf");
    expect(downloadNameOf("photo.heif", "HEIC")).toBe("photo.heif");
  });
});

describe("§998 «Încarcă contractele semnate» matches each file to one volunteer of the event by name", () => {
  const people = [
    { id: "anais", name: "Anaïs Meyson", cancelled: false },
    { id: "musat", name: "Ion Mușat", cancelled: false },
    { id: "tampu", name: "Țâmpu Elena", cancelled: false },
    { id: "ana-1", name: "Ana Pop", cancelled: false },
    { id: "ana-2", name: "ana  pop", cancelled: false },
    { id: "gone", name: "Radu Stan", cancelled: true },
    { id: "mara", name: "Mara-Ioana Dinu", cancelled: false },
  ];
  const match = (...names: string[]) => matchContractFiles(names, people);

  it("folds case, diacritics in either spelling, hyphens, underscores and spacing — on both sides", () => {
    expect(foldPersonName("Anaïs Meyson")).toBe("anais meyson");
    expect(foldPersonName("Ion Mușat")).toBe(foldPersonName("ION MUŞAT"));
    expect(foldPersonName("Țâmpu Elena")).toBe("tampu elena");
    expect(foldPersonName("Ţâmpu_Elena")).toBe("tampu elena");
    expect(foldPersonName("Mara-Ioana  Dinu")).toBe("mara ioana dinu");
    expect(foldPersonName("Paweł Øster")).toBe("pawel oster");
  });

  it("strips the extensions, a browser's « (1)» and a leading «Contract-voluntariat-» in any case or spelling", () => {
    expect(nameInContractFile("Contract-voluntariat-Anais-Meyson.docx")).toBe("anais meyson");
    expect(nameInContractFile("contract voluntariat Anais Meyson.PDF")).toBe("anais meyson");
    expect(nameInContractFile("CONTRACT_DE_VOLUNTARIAT_Anais_Meyson.docx.pdf")).toBe("anais meyson");
    expect(nameInContractFile("Contract-voluntariat-Anais-Meyson (1).docx")).toBe("anais meyson");
    expect(nameInContractFile("Anais Meyson.jpg")).toBe("anais meyson");
    expect(nameInContractFile("Contract-voluntariat.docx")).toBe("");
  });

  it("attaches the owner's own file names to the right people: «Anaïs», «Mușat», «Țâmpu», a hyphenated name", () => {
    expect(match("Contract-voluntariat-Anais-Meyson.docx", "Contract-voluntariat-Ion-Musat.docx", "Contract-voluntariat-Tampu-Elena.docx", "Contract-voluntariat-Mara-Ioana-Dinu.pdf")).toEqual([
      { kind: "matched", volunteerId: "anais" },
      { kind: "matched", volunteerId: "musat" },
      { kind: "matched", volunteerId: "tampu" },
      { kind: "matched", volunteerId: "mara" },
    ]);
  });

  it("matches the same words in another order only when nobody has them in the file's order", () => {
    expect(match("Contract-voluntariat-Meyson-Anais.docx")).toEqual([{ kind: "matched", volunteerId: "anais" }]);
    const twins = [
      { id: "ion-andrei", name: "Ion Andrei", cancelled: false },
      { id: "andrei-ion", name: "Andrei Ion", cancelled: false },
    ];
    expect(matchContractFiles(["Contract-voluntariat-Ion-Andrei.docx"], twins)).toEqual([{ kind: "matched", volunteerId: "ion-andrei" }]);
  });

  it("reports and never attaches an ambiguous name, an unknown one, a cancelled volunteer's, a file naming nobody, and a second file for the same person", () => {
    expect(match("Contract-voluntariat-Ana-Pop.docx", "Contract-voluntariat-Maria-Nimeni.docx", "Contract-voluntariat-Radu-Stan.docx", "Contract-voluntariat.docx")).toEqual([
      { kind: "refused", reason: "ambiguous" },
      { kind: "refused", reason: "noMatch" },
      { kind: "refused", reason: "cancelledOnly" },
      { kind: "refused", reason: "noName" },
    ]);
    // The second file for the same person carries the person's id: the sender tries it only if the first was refused by its bytes.
    expect(match("Contract-voluntariat-Anais-Meyson.docx", "Anais Meyson scan.pdf", "Contract-voluntariat-Anais-Meyson.pdf")).toEqual([
      { kind: "matched", volunteerId: "anais" },
      { kind: "refused", reason: "noMatch" },
      { kind: "refused", reason: "twice", volunteerId: "anais" },
    ]);
  });

  it("matches among the candidates it is given and nobody else: another event's volunteer is never one", () => {
    expect(matchContractFiles(["Contract-voluntariat-Anais-Meyson.docx"], [{ id: "other", name: "Ion Pop", cancelled: false }])).toEqual([{ kind: "refused", reason: "noMatch" }]);
  });
});
