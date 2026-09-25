import { describe, expect, it } from "vitest";
import { placeholdersFilledBy } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { RETENTION } from "@/modules/jobs/retention";

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

  it("greets the club, names who and for which run, says how long to keep it from RETENTION, and carries no privacy line (§419)", () => {
    for (const locale of ["ro", "en"] as const) {
      const email = render("GROUP_RUN_DECLARATION_ARCHIVE", locale);
      expect(email.subject).toContain("Ana Popescu");
      expect(email.text).toContain("Salut,");
      // The legitimate-interest, three-year choice, from the sweep's own constant, and the objection.
      const ro = durationPhrase("ro", RETENTION.registrationsYearsAfterEvent, "years");
      const en = durationPhrase("en", RETENTION.registrationsYearsAfterEvent, "years");
      expect(email.text).toContain(`Păstreaz-o în căsuța clubului ${ro} de la alergare`);
      expect(email.text).toContain(`Keep it in the club's mailbox for ${en} from the run`);
      expect(email.text).toContain("dacă alergătorul se opune");
      expect(email.text).toContain(`până la ${durationPhrase("ro", RETENTION.groupRunDeclarationsDaysAfterEvent, "days")} după alergare`);
      expect(email.text).not.toMatch(/Cum folosim datele( tale)?:/);
    }
  });

  it("tells the signer the document is masked only when the text asked for one, and always how to have it deleted (§419)", () => {
    const contactUrl = "https://example.test/ro/contact";
    const masked = buildOutgoingEmail({
      to: "x@example.test",
      locale: "ro",
      idempotencyKey: "t:masked",
      messageType: "GROUP_RUN_DECLARATION_SIGNED",
      data: { ...DATA, contactUrl, idDocumentMasked: true },
    });
    expect(masked.text).toContain("În copia ta, seria și numărul actului de identitate apar mascate, pentru siguranță");
    expect(masked.text).toContain("In your copy, your identity document's series and number are masked, for safety");
    expect(masked.text).toContain(`Dacă nu tu ai semnat această declarație, scrie-ne din pagina de contact (${contactUrl}) și o ștergem.`);
    expect(masked.text).toContain("If you did not sign this declaration, write to us from the contact page");

    const plain = buildOutgoingEmail({
      to: "x@example.test",
      locale: "ro",
      idempotencyKey: "t:plain",
      messageType: "GROUP_RUN_DECLARATION_SIGNED",
      data: { ...DATA, contactUrl },
    });
    expect(plain.text).not.toContain("apar mascate");
    expect(plain.text).toContain("Dacă nu tu ai semnat această declarație");
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
