import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS } from "@/modules/group-run-declarations/domain";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { PRUNE_STEPS, RETENTION } from "@/modules/jobs/retention";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN (reversing §393's seven days) — a group run's self-declaration is kept until the signer
 * asks for its deletion. Every sentence that says how long says that, and none says a number of
 * days: the run's page, the backoffice fold, both emails, the declaration's own text and the
 * privacy notice. Only an identity document (a text from before §418) still goes at seven days,
 * and the signing page's help line says that one through the domain's number.
 */
const DATA: TemplateData = { participantName: "Ana Popescu", eventTitle: "Tura pe munte", eventTitleOther: "The mountain loop" };

/** A number of days, spelled out or in digits, in either language. */
const DAYS = /șapte zile|seven days|\b\d+ (de )?zile\b|\b\d+ days\b|\{days\}/i;

describe("§NNN a group run's self-declaration is kept until the signer asks", () => {
  it("has no deleting window in the sweep: the step only clears an identity document, at the domain's number", () => {
    expect(RETENTION).not.toHaveProperty("groupRunDeclarationsDaysAfterEvent");
    expect(RETENTION.groupRunIdDocumentDaysAfterEvent).toBe(GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS);
    expect(PRUNE_STEPS).toContain("group-run-identity-documents");
    expect(PRUNE_STEPS).not.toContain("group-run-declarations");
  });

  it("says so on the run's page and in the backoffice fold, in both languages, with no number", () => {
    expect(ro.Event.groupRunDeclaration.line).toMatch(/clubul o păstrează cât timp vii la alergări și o șterge când îi ceri/);
    expect(en.Event.groupRunDeclaration.line).toMatch(/the club keeps it while you keep coming to the runs and deletes it when you ask/);
    expect(ro.Admin.groupRunDeclarations.help).toMatch(/păstrează o declarație cât timp semnatarul vine la alergări și o șterge când îi cere/);
    expect(en.Admin.groupRunDeclarations.help).toMatch(/keeps a declaration while the signer keeps coming to the runs and deletes it when they ask/);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.groupRunDeclaration.line).not.toMatch(DAYS);
      expect(catalogue.Admin.groupRunDeclarations.help).not.toMatch(DAYS);
    }
  });

  it("keeps the identity document's window as a value on the signing page, never words typed into it", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.groupRunDeclaration.page.idDocumentHelp).toContain("{days}");
      expect(catalogue.Event.groupRunDeclaration.page.idDocumentHelp).not.toMatch(/șapte zile|seven days|\b7 zile\b|\b7 days\b/);
    }
  });

  it("is said by both emails, in both halves, with no number of days", () => {
    const signed = buildOutgoingEmail({ to: "x@example.test", locale: "ro", idempotencyKey: "t:s", messageType: "GROUP_RUN_DECLARATION_SIGNED", data: DATA });
    expect(signed.text).toContain("Clubul păstrează declarația cât timp vii la alergări și o șterge când îi ceri.");
    expect(signed.text).toContain("The club keeps the declaration while you keep coming to the runs and deletes it when you ask.");
    const archive = buildOutgoingEmail({ to: "x@example.test", locale: "ro", idempotencyKey: "t:a", messageType: "GROUP_RUN_DECLARATION_ARCHIVE", data: DATA });
    expect(archive.text).toContain("cât timp alergătorul vine la alergări; când cere ștergerea ei");
    expect(archive.text).toContain("while the runner keeps coming to the runs; when they ask for it to be deleted");
    const source = readFileSync("src/modules/notifications/templates.ts", "utf8");
    const entries = [...source.matchAll(/groupRunDeclaration(?:Signed|Archive): \{[\s\S]*?\n {4}\},/g)].map((match) => match[0]);
    // Two entries per language.
    expect(entries).toHaveLength(4);
    for (const entry of entries) expect(entry).not.toMatch(/șapte zile|seven days|RETENTION_DAYS/);
  });

  it("is what the declaration's text and the privacy notice promise, in both languages", () => {
    const text = (key: keyof typeof LEGAL_TEMPLATES, locale: "ro" | "en") =>
      LEGAL_TEMPLATES[key][locale].body.sections.flatMap((section) => section.paragraphs).join(" ");
    for (const key of ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] as const) {
      expect(text(key, "ro")).toMatch(/Platforma clubului păstrează declarația cât timp particip la alergările clubului și o șterge la cererea mea, trimisă la adresa de contact a clubului/);
      expect(text(key, "en")).toMatch(/The club's platform keeps the declaration while I take part in the club's runs and deletes it at my request, sent to the club's contact address/);
      expect(text(key, "ro")).not.toMatch(/șterge declarația la/);
      expect(text(key, "en")).not.toMatch(/deletes the declaration/);
    }
    expect(text("PRIVACY_NOTICE", "ro")).toMatch(/În baza de date o păstrăm cât timp participi la alergările clubului, sau până ne ceri s-o ștergem/);
    expect(text("PRIVACY_NOTICE", "ro")).toMatch(/O declarație semnată pe o alergare de grup: cât timp participi la alergările clubului, sau până ne ceri s-o ștergem;/);
    expect(text("PRIVACY_NOTICE", "en")).toMatch(/We keep it in our database while you take part in the club's runs, or until you ask us to delete it/);
    expect(text("PRIVACY_NOTICE", "en")).toMatch(/A self-declaration signed on a group run: while you take part in the club's runs, or until you ask us to delete it;/);
    expect(text("PRIVACY_NOTICE", "ro")).not.toMatch(/alergare de grup: șapte zile/);
    expect(text("PRIVACY_NOTICE", "en")).not.toMatch(/group run: seven days/);
  });
});
