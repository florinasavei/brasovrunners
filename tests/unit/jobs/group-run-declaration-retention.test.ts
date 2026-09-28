import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS } from "@/modules/group-run-declarations/domain";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { PRUNE_STEPS, RETENTION } from "@/modules/jobs/retention";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §503 (reversing §393's seven days) — a group run's self-declaration is kept until the signer
 * asks for its deletion. Every sentence that says how long says that, and none says a number of
 * days: the run's page, the backoffice fold, both emails, the declaration's own text and the
 * privacy notice. Only an identity document (a text from before §418) still goes at seven days,
 * and the signing page's help line says that one through the domain's number.
 */
const DATA: TemplateData = { participantName: "Ana Popescu", eventTitle: "Tura pe munte", eventTitleOther: "The mountain loop" };

/** A number of days, spelled out or in digits, in either language. */
const DAYS = /șapte zile|seven days|\b\d+ (de )?zile\b|\b\d+ days\b|\{days\}/i;

describe("§503 a group run's self-declaration is kept until the signer asks", () => {
  it("has no deleting window in the sweep: the step only clears an identity document, at the domain's number", () => {
    expect(RETENTION).not.toHaveProperty("groupRunDeclarationsDaysAfterEvent");
    expect(RETENTION.groupRunIdDocumentDaysAfterEvent).toBe(GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS);
    expect(PRUNE_STEPS).toContain("group-run-identity-documents");
    expect(PRUNE_STEPS).not.toContain("group-run-declarations");
  });

  it("says so on the run's page and in the backoffice fold, in both languages, with no number", () => {
    expect(ro.Event.groupRunDeclaration.line).toMatch(/clubul o păstrează cât timp este necesară pentru alergările la care se aplică și nu o mai folosește dacă ceri retragerea ei/);
    expect(en.Event.groupRunDeclaration.line).toMatch(/the club keeps it as long as it is needed for the runs it applies to and stops using it when you ask for its withdrawal/);
    expect(ro.Admin.groupRunDeclarations.help).toMatch(/Clubul o păstrează cât e necesară; când semnatarul cere retragerea ei, o ștergi aici/);
    expect(en.Admin.groupRunDeclarations.help).toMatch(/The club keeps it while it is needed; when the signer asks for its withdrawal, erase it here/);
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
    expect(signed.text).toContain("Clubul o păstrează cât timp este necesară pentru alergările la care se aplică; dacă ceri retragerea ei, nu o mai folosește, iar o copie o păstrează cel mult termenul de prescripție, apoi o șterge.");
    expect(signed.text).toContain("The club keeps it as long as it is needed for the runs it applies to; if you ask for its withdrawal, it no longer uses it, keeps a copy at most for the limitation period, then deletes it.");
    const archive = buildOutgoingEmail({ to: "x@example.test", locale: "ro", idempotencyKey: "t:a", messageType: "GROUP_RUN_DECLARATION_ARCHIVE", data: DATA });
    // Erased at the runner's withdrawal (§NNN, the counsel's second pass, in place of «ștergerea»).
    expect(archive.text).toContain("cât timp declarația este activă; când alergătorul cere retragerea ei");
    expect(archive.text).toContain("while the declaration is active; when the runner asks for its withdrawal");
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
      // Kept by its purpose (§NNN, the counsel's second pass, amending §503's words): no job sweeps it,
      // and the text states no number of days — the withdrawal at the signer's request ends its use.
      expect(text(key, "ro")).toMatch(/Declarația activă se păstrează cât timp este necesară pentru gestionarea participării mele la alergările la care se aplică\. Dacă cer retragerea ei, la adresa de contact a clubului, nu mai este folosită pentru participările viitoare/);
      expect(text(key, "en")).toMatch(/The active declaration is kept as long as it is needed to manage my taking part in the runs it applies to\. If I ask for its withdrawal, at the club's contact address, it is no longer used for any later run/);
      expect(text(key, "ro")).not.toMatch(/șterge declarația la|trei ani de la semnare/);
      expect(text(key, "en")).not.toMatch(/deletes the declaration|three years from the signing/);
    }
    expect(text("PRIVACY_NOTICE", "ro")).toMatch(/O păstrăm cât timp este necesară pentru participarea ta la alergările la care se aplică\. Dacă ne ceri să o retragem \(secțiunea 8\), nu o mai folosim pentru alergările următoare/);
    expect(text("PRIVACY_NOTICE", "ro")).toMatch(/O declarație semnată pe o alergare de grup: cât timp este necesară pentru alergările la care se aplică; după ce ne ceri să o retragem, o copie doar cât o cere un drept în instanță/);
    expect(text("PRIVACY_NOTICE", "en")).toMatch(/We keep it as long as it is needed for your taking part in the runs it applies to\. If you ask us to withdraw it \(section 8\), we no longer use it for later runs/);
    expect(text("PRIVACY_NOTICE", "en")).toMatch(/A self-declaration signed on a group run: as long as it is needed for the runs it applies to; once you ask us to withdraw it, a copy only as long as a legal claim needs it/);
    expect(text("PRIVACY_NOTICE", "ro")).not.toMatch(/trei ani de la semnare/);
    // §3's group-run paragraph follows the same retention: no "no end date", no "only at your request" (§NNN).
    for (const locale of ["ro", "en"] as const) {
      expect(text("PRIVACY_NOTICE", locale)).not.toMatch(/fără termen|no end date|ștergem doar la cererea ta|delete both only at your request/);
    }
    expect(text("PRIVACY_NOTICE", "ro")).toMatch(/acoperă atunci fiecare dată a ei, până când o retragi sau este înlocuită cu o versiune nouă/);
    expect(text("PRIVACY_NOTICE", "en")).toMatch(/it then covers every date of it, until you withdraw it or it is replaced by a new version/);
    // Law 214/2024 by its number alone beside a signature: nothing reads as a qualified time stamp (§NNN).
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
      expect(text(key, "ro")).not.toMatch(/mărcii temporale/);
      expect(text(key, "en")).not.toMatch(/time stamps/);
    }
    expect(text("PRIVACY_NOTICE", "en")).not.toMatch(/three years from the signing/);
    expect(text("PRIVACY_NOTICE", "ro")).not.toMatch(/alergare de grup: șapte zile/);
    expect(text("PRIVACY_NOTICE", "en")).not.toMatch(/group run: seven days/);
  });
});
