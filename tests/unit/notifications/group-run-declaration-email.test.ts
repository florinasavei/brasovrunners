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
      // A one-off run's copy names that run and claims no series (§523).
      expect(email.subject).toContain("— Tura pe munte");
      expect(email.text).not.toContain("toate alergările seriei");
      expect(email.text).not.toContain("every run of the series");
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
      // Kept while the declaration is active, then at most the limitation period from the withdrawal
      // (§534, the counsel's second pass) — never "three years from the signing" (§523's words).
      expect(email.text).toContain("Păstreaz-o în căsuța clubului cât timp declarația este activă");
      expect(email.text).toContain("Keep it in the club's mailbox while the declaration is active");
      expect(email.text).toContain(`copia de aici o mai păstrezi cel mult ${ro} de la retragere`);
      expect(email.text).toContain(`keep this copy for at most ${en} from the withdrawal`);
      expect(email.text).not.toMatch(/de la semnare|from the signing/);
      expect(email.text).toContain("dacă alergătorul se opune");
      // The platform's row while the runner comes to the runs, erased at their withdrawal (§503), never a number of days.
      expect(email.text).toContain("cât timp declarația este activă; când alergătorul cere retragerea ei");
      expect(email.text).toContain("while the declaration is active; when the runner asks for its withdrawal");
      expect(email.text).not.toMatch(/Cum folosim datele( tale)?:/);
    }
  });

  /*
    §523 — a series' declaration: both emails name the series and its rhythm, in each half's language,
    from the template data (never a literal), and say it is valid for every run of it; the signer's
    carries their own link to the run's page as its button.
  */
  it("names the series and its rhythm in the subject and body of both messages, in both halves", () => {
    const series: TemplateData = { ...DATA, groupRunSeries: true, seriesRhythm: "în fiecare miercuri, la 19:00", seriesRhythmOther: "every Wednesday at 19:00" };
    const signer = buildOutgoingEmail({
      to: "x@example.test",
      locale: "ro",
      idempotencyKey: "t:series",
      messageType: "GROUP_RUN_DECLARATION_SIGNED",
      data: series,
      actionUrl: "https://example.test/ro/evenimente/tura?declaratie=abc#declaratie",
    });
    expect(signer.subject).toBe("Declarația ta pe propria răspundere — seria Tura pe munte / Your self-declaration — The mountain loop (series)");
    expect(signer.text).toContain("pentru seria de alergări de grup Tura pe munte (în fiecare miercuri, la 19:00), joi, 1 oct. 2026, 11:00.");
    expect(signer.text).toContain("Declarația este valabilă pentru toate alergările seriei, așa că nu o mai semnezi la următoarele");
    expect(signer.text).toContain("for the group run series The mountain loop (every Wednesday at 19:00), on Thursday, 1 Oct 2026, 11:00.");
    expect(signer.text).toContain("The declaration is valid for every run of the series, so you do not sign it again for the next ones");
    // The signer's own link, as the button, in both halves.
    expect(signer.html).toContain("Vezi pe pagina alergării");
    expect(signer.html).toContain("?declaratie=abc#declaratie");

    const club = buildOutgoingEmail({ to: "x@example.test", locale: "ro", idempotencyKey: "t:series-archive", messageType: "GROUP_RUN_DECLARATION_ARCHIVE", data: series });
    expect(club.subject).toContain("Ana Popescu — seria Tura pe munte");
    expect(club.subject).toContain("Ana Popescu — The mountain loop (series)");
    expect(club.text).toContain("pentru seria de alergări de grup Tura pe munte (în fiecare miercuri, la 19:00)");
    expect(club.text).toContain("Este valabilă pentru toate alergările seriei.");
    expect(club.text).toContain("for the group run series The mountain loop (every Wednesday at 19:00)");
    expect(club.text).toContain("It is valid for every run of the series.");
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
