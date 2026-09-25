import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { RETENTION } from "@/modules/jobs/retention";
import { BULK_CLUB_COPY_MESSAGES, bulkCopyRecipients, isCopiedPerMessage, isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { archivePeriod, buildOutgoingEmail, identityDays, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01 — the emails as the counsel's review of 2026-09-25 left them (§NNN): whose
 * registration a message is about, who signs a minor's declaration, the family link's agreement
 * sentence, the archive copy's periods from the sweep's own constants, and which messages the club
 * gets a copy of — none of an unconfirmed address's, one per bulk send.
 */
const DATA: TemplateData = {
  participantName: "Ioana Pop",
  eventTitle: "Crosul aniversar",
  eventTitleOther: "The anniversary cross",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
  eventStartsAtFormattedOther: "Sunday, 11 Oct 2026, 09:00",
};

const render = (messageType: EmailMessageType, data: TemplateData, locale: "ro" | "en" = "ro") =>
  buildOutgoingEmail({ to: "x@example.test", locale, idempotencyKey: `t:${messageType}`, messageType, data, actionUrl: "https://example.test/ro/EXAMPLE" });

describe("BR-REQ-080-01 §NNN the club's copies: none of an unconfirmed address's, one per bulk send", () => {
  it("copies no address confirmation, no family link and no bulk send per message — and every other participant message as before", () => {
    const none = ["VERIFY_REGISTRATION_EMAIL", "REGISTER_ANOTHER_PERSON", "ORGANIZER_MESSAGE", "EVENT_UPDATE_NOTICE"];
    for (const type of emailMessageType.enumValues) {
      expect(isCopiedPerMessage(type), type).toBe(isParticipantMessage(type) && !none.includes(type));
    }
    // Still participant messages: the privacy line and no envelope copies stay theirs.
    for (const type of none) expect(isParticipantMessage(type as EmailMessageType), type).toBe(true);
    expect([...BULK_CLUB_COPY_MESSAGES].sort()).toEqual(["EVENT_UPDATE_NOTICE", "ORGANIZER_MESSAGE"]);
  });

  it("reads a bulk copy's count only from a club copy's payload", () => {
    expect(bulkCopyRecipients({ clubCopy: true, recipients: 12 })).toBe(12);
    expect(bulkCopyRecipients({ recipients: 12 })).toBeNull();
    expect(bulkCopyRecipients({ clubCopy: true })).toBeNull();
    expect(bulkCopyRecipients({ clubCopy: true, recipients: -1 })).toBeNull();
    expect(bulkCopyRecipients(null)).toBeNull();
  });

  it("a bulk copy greets the club, says how many received it and names nobody", () => {
    const email = render("ORGANIZER_MESSAGE", { ...DATA, participantName: "", clubCopy: true, clubCopyRecipients: 12, organizerBody: "Salut, {participantName}! Startul se mută.", organizerBodyOther: "Hi {participantName}! The start moves." });
    expect(email.text.startsWith("Salut,\n")).toBe(true);
    expect(email.text).toContain("Copie pentru club a mesajului trimis la 12 participanți, fiecăruia în limba înscrierii lui.");
    expect(email.text).toContain("Club copy of the message sent to 12 participants, each in the language of their registration.");
    expect(email.text).not.toContain("Copie pentru club a mesajului trimis participantului.");
    expect(render("ORGANIZER_MESSAGE", { ...DATA, participantName: "", clubCopy: true, clubCopyRecipients: 1 }).text).toContain("trimis la un participant,");
  });
});

describe("BR-REQ-080-01 §NNN a minor's messages speak to the parent", () => {
  const minor: TemplateData = { ...DATA, guardianName: "Maria Pop" };

  it("says both sign, each with their own document, when the text in force asks the minor too", () => {
    const email = render("COMPLETE_DECLARATION", { ...minor, minorSigns: true });
    expect(email.text.startsWith("Salut, Maria Pop,\n")).toBe(true);
    expect(email.text).toContain("Declarația o semnați amândoi, tu ca părinte sau tutore și Ioana Pop, fiecare cu actul lui de identitate; țineți-le pe amândouă la îndemână.");
    expect(email.text).toContain("You both sign the declaration, you as parent or guardian and Ioana Pop, each with your own identity document; keep both to hand.");
  });

  it("greets the parent on every message about the registration, but not on the older declaration message", () => {
    for (const type of ["REGISTRATION_CONFIRMED", "EVENT_REMINDER", "WAITLIST_JOINED"] as const) {
      const email = render(type, minor);
      expect(email.text.startsWith("Salut, Maria Pop,\n"), type).toBe(true);
      expect(email.text, type).toContain("Mesajul privește înscrierea pe care ai făcut-o, ca părinte sau tutore, pentru Ioana Pop.");
      // Who signs is said only where a signature is asked.
      expect(email.text, type).not.toContain("Declarația o semn");
    }
    const legacy = render("DECLARATION_SIGNED", minor);
    expect(legacy.text.startsWith("Salut, Ioana Pop,\n")).toBe(true);
    expect(legacy.text).not.toContain("ca părinte sau tutore");
  });
});

describe("BR-REQ-080-01 §NNN the words the counsel asked for", () => {
  it("asks for the other person's agreement on the family link, and not at the address's limit", () => {
    const link = render("REGISTER_ANOTHER_PERSON", { ...DATA, participantName: "" });
    expect(link.text).toContain("Înscrie pe cineva doar cu acordul lui și spune-i că datele lui ajung la noi și cum le folosim");
    expect(link.text).toContain("Register someone only with their agreement, and tell them that their details come to us and how we use them");
    expect(render("REGISTER_ANOTHER_PERSON", { ...DATA, participantName: "", addressAtCap: true, addressCap: 4 }).text).not.toContain("doar cu acordul lui");
  });

  it("never says the race is free on the confirmation asked in advance", () => {
    const email = render("COMPLETE_DECLARATION", { ...DATA, confirmLater: true, holdExpiresAtFormatted: "vineri, 9 oct. 2026, 09:00" });
    expect(email.text).not.toContain("gratuit");
    expect(email.text).not.toContain("is free");
    expect(email.text).toContain("Locul tău la Crosul aniversar este rezervat. Înscrierea este completă doar după ce semnezi declarația pe proprie răspundere.");
  });

  it("states the archive copy's periods from the retention sweep's own constants", () => {
    expect(archivePeriod("ro")).toBe(durationPhrase("ro", RETENTION.registrationsYearsAfterEvent, "years"));
    expect(archivePeriod("en")).toBe(durationPhrase("en", RETENTION.registrationsYearsAfterEvent, "years"));
    expect(identityDays("ro")).toBe(durationPhrase("ro", RETENTION.identityAndHealthDaysAfterEvent, "days"));
    const email = render("DECLARATION_ARCHIVE", DATA);
    expect(email.text).toContain(`Păstreaz-o în căsuța clubului ${archivePeriod("ro")} de la eveniment`);
    expect(email.text).toContain(`until ${identityDays("en")} after the event`);
    // Words, not the old literals.
    expect(email.text).not.toContain("trei ani");
    expect(email.text).not.toContain("șapte zile");
  });

  it("says years in both languages' own grammar", () => {
    expect(durationPhrase("ro", 1, "years")).toBe("un an");
    expect(durationPhrase("ro", 3, "years")).toBe("3 ani");
    expect(durationPhrase("ro", 20, "years")).toBe("20 de ani");
    expect(durationPhrase("en", 1, "years")).toBe("one year");
    expect(durationPhrase("en", 3, "years")).toBe("3 years");
  });
});
