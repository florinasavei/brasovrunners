import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { GROUP_RUN_DECLARATION_RETENTION_DAYS } from "@/modules/group-run-declarations/domain";
import { RETENTION } from "@/modules/jobs/retention";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §393 — a group run's self-declaration is kept for one number of days, and every sentence that
 * says how long reads that number: the sweep, the run's page, the signing page, the backoffice
 * fold and both emails. A "șapte zile" typed into one of them would stay behind the day the rule
 * changed.
 */
const DATA: TemplateData = { participantName: "Ana Popescu", eventTitle: "Tura pe munte", eventTitleOther: "The mountain loop" };

/** The spelled-out or digit forms of the current value, in either language. */
const LITERALS = /șapte zile|seven days|\b7 zile\b|\b7 days\b/i;

describe("§393 one retention for a group run's self-declaration", () => {
  it("is the sweep's own window", () => {
    expect(RETENTION.groupRunDeclarationsDaysAfterEvent).toBe(GROUP_RUN_DECLARATION_RETENTION_DAYS);
  });

  it("reaches the catalogues as a value, never as words typed into the sentence", () => {
    for (const catalogue of [ro, en]) {
      const sentences = [
        catalogue.Event.groupRunDeclaration.line,
        catalogue.Event.groupRunDeclaration.page.idDocumentHelp,
        catalogue.Admin.groupRunDeclarations.help,
      ];
      for (const sentence of sentences) {
        expect(sentence).toContain("{days}");
        expect(sentence).not.toMatch(LITERALS);
      }
    }
  });

  it("is said by both emails through the duration words, in both halves", () => {
    for (const messageType of ["GROUP_RUN_DECLARATION_SIGNED", "GROUP_RUN_DECLARATION_ARCHIVE"] as const) {
      const email = buildOutgoingEmail({ to: "x@example.test", locale: "ro", idempotencyKey: `t:${messageType}`, messageType, data: DATA });
      expect(email.text).toContain(`${durationPhrase("ro", GROUP_RUN_DECLARATION_RETENTION_DAYS, "days")} după alergare`);
      expect(email.text).toContain(`${durationPhrase("en", GROUP_RUN_DECLARATION_RETENTION_DAYS, "days")} after the run`);
    }
  });

  it("is typed as words nowhere in the two templates' source", () => {
    const source = readFileSync("src/modules/notifications/templates.ts", "utf8");
    const entries = [...source.matchAll(/groupRunDeclaration(?:Signed|Archive): \{[\s\S]*?\n {4}\},/g)].map((match) => match[0]);
    // Two entries per language.
    expect(entries).toHaveLength(4);
    for (const entry of entries) expect(entry).not.toMatch(LITERALS);
  });
});
