import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { type FamilyStep, familyStepWordsKey, signActionKey } from "@/modules/registrations/domain/family-signing";
import { NO_RACE_NUMBER, qrIdentity } from "@/modules/registrations/domain/qr-identity";
import FamilySittingOffer from "@/modules/registrations/ui/FamilySittingOffer";
import { buildTemplateContent, qrIdentityLine, renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the family's screens after the owner's walk on QA (2026-09-28, 17:45–18:00), amending the
 * family branch (a family sitting reserves every place), §471 and §77: the discreet «Înscriu încă o persoană», the wizard's button by
 * position, the name and number beside every QR, and one cancellation email per person
 * (BR-REQ-031-01, BR-REQ-033-02, BR-REQ-036-01, BR-REQ-036-04).
 */

const words = (locale: "ro" | "en") => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Registrations" });

const step = (id: string, state: FamilyStep["state"], status: FamilyStep["status"] = "PENDING_DECLARATION"): FamilyStep => ({
  id,
  registeredName: `Persoana ${id}`,
  status,
  state,
  holdExpiresAt: null,
  checkinCode: null,
  raceNumber: null,
});

describe("§NNN the wizard's button says «… și treci la următoarea persoană» only while another person follows", () => {
  it("picks the words by position: first and middle go on, the last and a single declaration just sign", () => {
    const first = [step("a", "current"), step("b", "next"), step("c", "next")];
    const middle = [step("a", "signed", "CONFIRMED"), step("b", "current"), step("c", "next")];
    const last = [step("a", "signed", "CONFIRMED"), step("b", "signed", "CONFIRMED"), step("c", "current")];
    // A person put off for later is not "next": the current one is the last to sign here.
    const beforeLater = [step("a", "signed", "CONFIRMED"), step("b", "current"), step("c", "later")];
    expect(signActionKey(first)).toBe("declare.family.nextAction");
    expect(signActionKey(middle)).toBe("declare.family.nextAction");
    expect(signActionKey(last)).toBe("declare.sign");
    expect(signActionKey(beforeLater)).toBe("declare.sign");
    expect(signActionKey(null)).toBe("declare.sign");
  });

  it("says the words the owner asked for, in both languages", () => {
    expect(words("ro")("declare.family.nextAction")).toBe("Semnează și treci la următoarea persoană");
    expect(words("en")("declare.family.nextAction")).toBe("Sign and go to the next person");
    expect(words("ro")("declare.sign")).toBe("Semnează");
    expect(words("en")("declare.sign")).toBe("Sign");
  });

  it("names a withdrawn person's step «înscriere anulată», and asks first naming the person", () => {
    expect(familyStepWordsKey(step("b", "closed", "CANCELLED"))).toBe("cancelled");
    expect(familyStepWordsKey(step("b", "closed", "EXPIRED"))).toBe("closed");
    expect(familyStepWordsKey(step("b", "signed", "WAITLISTED"))).toBe("waitlisted");
    expect(words("ro")("declare.family.state.cancelled")).toBe("înscriere anulată");
    expect(words("ro")("declare.family.withdraw", { name: "Mihai Pop" })).toBe("Renunț la înscrierea pentru Mihai Pop");
    expect(words("en")("declare.family.withdraw", { name: "Mihai Pop" })).toBe("Withdraw the registration for Mihai Pop");
    expect(words("ro")("declare.family.withdrawTitle", { name: "Mihai Pop" })).toBe("Renunți la înscrierea pentru Mihai Pop?");
    for (const locale of ["ro", "en"] as const) {
      const body = words(locale)("declare.family.withdrawBody", { name: "Mihai Pop", event: "Crosul Tâmpei" });
      expect(body).toContain("Mihai Pop");
      expect(body).toContain("Crosul Tâmpei");
      expect(body.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("§NNN «Înscriu încă o persoană cu această adresă» is one quiet line, never the primary button", () => {
  const html = renderToStaticMarkup(
    createElement(FamilySittingOffer, {
      words: { add: ro.Registration.sitting.addLink, addPending: ro.Registration.sitting.addPending, hint: "Fiecare persoană primește emailul ei." },
      locale: "ro",
      slug: "crosul-tampei",
      continueAction: async () => {},
    }),
  ).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

  it("is a text-styled press with its glyph and its one sentence under it", () => {
    expect(html).toContain("Înscriu încă o persoană cu această adresă");
    expect(html).toContain("MuiButton-text");
    expect(html).not.toContain("MuiButton-contained");
    expect(html).not.toContain("MuiButton-fullWidth");
    // The glyph beside the word (§521): the person-add icon, drawn in the button.
    expect(html).toMatch(/<svg[^>]*data-testid="PersonAddIcon"/);
    expect(html).toContain('data-testid="family-sitting-offer-hint"');
    expect(html).toContain("Fiecare persoană primește emailul ei.");
  });

  it("asks no bold question and says no «Da»", () => {
    expect(html).not.toContain(ro.Registration.sitting.question);
    expect(html).not.toContain("<h3");
    expect(html).not.toContain("Da, încă o persoană");
    // The sentences under it no longer answer a «Da» the screen does not show.
    for (const key of ["addHint", "addHintOn", "addHintLeft"] as const) {
      expect(ro.Registration.sitting[key]).not.toContain("„Da”");
      expect(en.Registration.sitting[key]).not.toContain("“Yes”");
    }
  });
});

describe("§NNN the name and the race number beside every QR", () => {
  it("reads the name and the race number through raceNumberOf, «—» before one is given, never «provisional»", () => {
    expect(qrIdentity({ registeredName: " Ana Pop ", status: "CONFIRMED", bibNumber: 12 })).toEqual({ name: "Ana Pop", number: "12" });
    expect(qrIdentity({ registeredName: "Ioana Pop", status: "CONFIRMED", bibNumber: null })).toEqual({ name: "Ioana Pop", number: NO_RACE_NUMBER });
    // A number on a row not confirmed (a restarted registration) is not shown: the one rule decides.
    expect(qrIdentity({ registeredName: "Ion Pop", status: "PENDING_DECLARATION", bibNumber: 7 })).toEqual({ name: "Ion Pop", number: NO_RACE_NUMBER });
    expect(NO_RACE_NUMBER).toBe("—");
    expect(words("ro")("qr.number", { number: "12" })).toBe("Număr de concurs: 12");
    expect(words("en")("qr.number", { number: NO_RACE_NUMBER })).toBe("Race number: —");
    // The race number exists once the registration is confirmed (the sibling change): nothing beside the QR qualifies it.
    expect(JSON.stringify(ro.Registrations.qr)).not.toMatch(/provizoriu/i);
    expect(JSON.stringify(en.Registrations.qr)).not.toMatch(/provisional/i);
  });

  const confirmed: TemplateData = {
    participantName: "Mihai Pop",
    eventTitle: "Crosul Tâmpei",
    checkinCode: "ABC123",
    checkinQrUrl: "https://example.test/api/registrations/qr/ABC123.png",
    bibNumber: 12,
  };

  it("captions the confirmation's QR with the person and the number, in both languages", () => {
    const content = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", confirmed, "https://example.test/ro/manage");
    expect(content.image?.caption).toBe("Mihai Pop · Număr de concurs: 12 · Codul tău: ABC123");
    expect(content.image?.alt).toContain("Mihai Pop");
    expect(buildTemplateContent("REGISTRATION_CONFIRMED", "en", confirmed, undefined).image?.caption).toBe("Mihai Pop · Race number: 12 · Your code: ABC123");
    // No number yet: the slot reads «—», whatever the numbering decides later.
    const unnumbered = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", { ...confirmed, bibNumber: undefined }, undefined);
    expect(unnumbered.image?.caption).toBe("Mihai Pop · Număr de concurs: — · Codul tău: ABC123");
    expect(buildTemplateContent("EVENT_REMINDER", "ro", confirmed, undefined).image?.caption).toContain("Mihai Pop · Număr de concurs: 12");
  });

  it("says whose the QR was on the club's copy, which carries no QR (§320)", () => {
    const copy = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", { ...confirmed, clubCopy: true }, undefined);
    expect(copy.image).toBeUndefined();
    expect(copy.paragraphs).toContain("Mihai Pop · Număr de concurs: 12");
    expect(copy.paragraphs.join(" ")).not.toContain("ABC123");
    expect(qrIdentityLine("en", { participantName: "Mihai Pop", bibNumber: undefined })).toBe("Mihai Pop · Race number: —");
    // Not on the participant's own copy: there the line is the QR's caption.
    expect(buildTemplateContent("REGISTRATION_CONFIRMED", "ro", confirmed, undefined).paragraphs).not.toContain("Mihai Pop · Număr de concurs: 12");
  });
});

describe("§NNN one cancellation email per person", () => {
  const cancelled: TemplateData = {
    participantName: "Mihai Pop",
    eventTitle: "Crosul Tâmpei",
    eventStartsAtFormatted: "sâmbătă, 21 noiembrie 2026, la 10:00",
    eventStartsAtFormattedOther: "Saturday, 21 November 2026, at 10:00",
    cancelledOthers: [
      { name: "Ana P.", state: "confirmed" },
      { name: "Ioana P.", state: "declaration" },
    ],
  };

  it("names the person, the event and the date, the place released and who the address still holds", () => {
    const message = renderBilingual("REGISTRATION_CANCELLED", "ro", cancelled, undefined);
    expect(message.subject).toContain("Înscrierea pentru Mihai Pop la Crosul Tâmpei a fost anulată");
    expect(message.subject).toContain("The registration for Mihai Pop at Crosul Tâmpei has been cancelled");
    expect(message.text).toContain("Înscrierea pentru Mihai Pop la Crosul Tâmpei, sâmbătă, 21 noiembrie 2026, la 10:00, a fost anulată.");
    expect(message.text).toContain("Locul a fost eliberat.");
    expect(message.text).toContain("Pe această adresă rămân înscriși: Ana P. (confirmat), Ioana P. (semnează declarația).");
    expect(message.text).toContain("The place has been released.");
    expect(message.text).toContain("Still registered on this address: Ana P. (confirmed), Ioana P. (signing the declaration).");
  });

  it("says the waiting list was left for a person who waited, and names nobody else when nobody is left", () => {
    const message = renderBilingual("REGISTRATION_CANCELLED", "ro", { ...cancelled, cancelledOthers: undefined, cancelledFromWaitlist: true }, undefined);
    expect(message.text).toContain("Mihai Pop nu mai este pe lista de așteptare.");
    expect(message.text).toContain("Mihai Pop is no longer on the waiting list.");
    expect(message.text).not.toContain("rămân înscriși");
    expect(message.text).not.toContain("Locul a fost eliberat.");
  });
});
