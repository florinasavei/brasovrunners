import { describe, expect, it } from "vitest";
import { mergeTextSegments } from "@/modules/legal-documents/domain/merge-fields";
import { runText } from "@/modules/registrations/declaration-pdf";

/**
 * §225 as fixed by §330 — the signed declaration's paragraphs are drawn a run at a time so the
 * fill-ins can be bold, and each run is drawn straight after the one before it. The runs after
 * the first used to lose their options (pdfkit reads a third argument only when an `x` is given),
 * which broke the line after every fill-in; once they flowed, `plainInline`'s trim showed as
 * "Subsemnatul/aAna Pop". pdfkit writes an embedded font's text as glyph ids in a deflated
 * stream, so the page cannot be searched; what each run hands the PDF is asserted instead.
 */
describe("§330 a declaration paragraph's runs keep the spaces between them", () => {
  it("keeps a space at either end of a run, and strips the marks", () => {
    expect(runText("Subsemnatul/a ")).toBe("Subsemnatul/a ");
    expect(runText(", posesor al actului de identitate ")).toBe(", posesor al actului de identitate ");
    expect(runText(" citește [regulamentul](/ro/regulament) ")).toBe(" citește regulamentul (/ro/regulament) ");
    expect(runText("  two spaces are one  ")).toBe(" two spaces are one ");
    expect(runText(" ")).toBe(" ");
    expect(runText("")).toBe("");
  });

  it("joins a merged paragraph back into the sentence the reader sees", () => {
    const runs = mergeTextSegments("Subsemnatul/a {{participant}}, posesor al actului de identitate {{participantIdDocument}}, declar.", {
      participant: "Maria Pop",
      participantIdDocument: "MP 654321",
    });
    expect(runs.map((run) => runText(run.text)).join("")).toBe("Subsemnatul/a Maria Pop, posesor al actului de identitate MP 654321, declar.");
  });
});
