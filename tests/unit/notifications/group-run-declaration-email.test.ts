import { describe, expect, it } from "vitest";
import { placeholdersFilledBy } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";

/**
 * §393 — the two messages of a group run's self-declaration: the signer's copy and the club's
 * archive copy. Bilingual like every message (§96), with no action button (there is nothing to
 * manage), the signer's with a privacy line that says why it came (§323), the club's with none.
 */
const DATA: TemplateData = {
  participantName: "Ana Popescu",
  eventTitle: "Tura pe munte",
  eventTitleOther: "The mountain loop",
  signedAtFormatted: "joi, 1 oct. 2026, 11:00",
  signedAtFormattedOther: "Thursday, 1 Oct 2026, 11:00",
};

const render = (messageType: "GROUP_RUN_DECLARATION_SIGNED" | "GROUP_RUN_DECLARATION_ARCHIVE", locale: "ro" | "en") =>
  buildOutgoingEmail({ to: "x@example.test", locale, idempotencyKey: `t:${messageType}:${locale}`, messageType, data: DATA });

describe("§393 the group run's declaration messages", () => {
  it("tells the signer it is their copy, that it registered them for nothing, in both halves", () => {
    for (const locale of ["ro", "en"] as const) {
      const email = render("GROUP_RUN_DECLARATION_SIGNED", locale);
      expect(email.text).toContain("Păstreaz-o: este copia ta.");
      expect(email.text).toContain("Keep it: it is your copy.");
      expect(email.text).toContain("nu te înscrie nicăieri");
      expect(email.text).toContain("registers you for nothing");
      expect(email.text).toContain("pentru că ai semnat o declarație pe site-ul clubului");
      expect(email.text).toContain("because you signed a declaration on the club's website");
      // No button and no registration's link: there is nothing to manage.
      expect(email.text).not.toMatch(/\/(inregistrari|registrations)\//);
    }
  });

  it("greets the club, names who and for which run, says the document is masked, and carries no privacy line", () => {
    for (const locale of ["ro", "en"] as const) {
      const email = render("GROUP_RUN_DECLARATION_ARCHIVE", locale);
      expect(email.subject).toContain("Ana Popescu");
      expect(email.text).toContain("Salut,");
      expect(email.text).toContain("fără seria și numărul actului de identitate");
      expect(email.text).toContain("without the identity document's series and number");
      expect(email.text).not.toContain("Cum folosim datele tale:");
    }
  });

  it("fills the runner's name, the run and the moment of signing — never a registration's status (§373)", () => {
    for (const type of ["GROUP_RUN_DECLARATION_SIGNED", "GROUP_RUN_DECLARATION_ARCHIVE"] as const) {
      const filled = placeholdersFilledBy(type);
      expect(filled).toEqual(expect.arrayContaining(["participantName", "eventTitle", "signedAtFormatted"]));
      expect(filled).not.toContain("currentStatus");
      expect(filled).not.toContain("bibNumber");
    }
  });
});
