import { describe, expect, it } from "vitest";
import { emailSampleLiteralsIn } from "@/modules/notifications/domain/email-sample";
import { emailCopyPrefill } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §800 — the receipt email a volunteer gets (`VOLUNTEER_RECEIVED`, §754) says what comes next in the facts the volunteers' page and its
 * thank-you give as steps: the organizers choose the role and confirm, the role comes by email with the date and the place, nothing is
 * owed until then, the day. Placeholders only (§357): no number, no deadline, no club name, nothing the club could change elsewhere.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
  volunteer: { name: "Ana Pop", roleRo: null, roleEn: null, chosenRo: ["Punct de apă"], chosenEn: ["Water point"], agreementAttached: true },
};

function receipt(data: TemplateData = DATA) {
  return buildOutgoingEmail({ to: "ana@example.test", locale: "ro", idempotencyKey: "test:VOLUNTEER_RECEIVED", messageType: "VOLUNTEER_RECEIVED", data });
}

describe("§800 the receipt says «ce urmează» in both languages", () => {
  it("names the organizers' choice, the role by email with the date and place, nothing owed until then, and the day", () => {
    const { text } = receipt();
    expect(text).toContain("Ce urmează: organizatorii îți aleg rolul și te confirmă. Îți scriem pe email rolul tău, cu data și locul");
    // One subject in the sentence: «Îți scriem … și te căutăm», never «…și te caută» after «îți scriem».
    expect(text).toContain("Îți scriem pe email rolul tău, cu data și locul, și te căutăm pe email sau la telefon dacă mai trebuie ceva.");
    expect(text).toContain("Ora de întâlnire și ce mai e de știut le afli de la organizatori, înainte de eveniment. Până atunci nu ai nimic de făcut");
    expect(text).toContain("nu e o înscriere la cursă și nu ține loc");
    expect(text).toContain("În ziua evenimentului vii la ora și la locul pe care ți le spun organizatorii.");
    expect(text).toContain("What happens next: the organizers choose your role and confirm you. We email you your role, with the date and place");
    expect(text).toContain("The meeting time and anything else you need to know come from the organizers, before the event. Until then there is nothing for you to do");
    expect(text).toContain("On the day of the event you come at the time and place the organizers tell you.");
  });

  it("keeps the subject, the agreement line, the not-you line and the privacy line exactly as they were", () => {
    const email = receipt();
    expect(email.subject).toBe("Ți-am primit oferta de voluntar pentru Crosul aniversar / We received your offer to volunteer for Crosul aniversar");
    expect(email.text).toContain("Contractul de voluntariat pe care l-ai acceptat e atașat, ca PDF. Păstrează-l: e copia ta.");
    expect(email.text).toContain("The volunteer agreement you accepted is attached as a PDF. Keep it: it is your copy.");
    expect(email.text).toContain("Dacă nu tu ai trimis oferta, scrie-ne din pagina de contact și o ștergem");
  });

  it("says the parent's consent only for a minor whose parent has not accepted, and the «ce urmează» is the same either way", () => {
    const minor = receipt({ ...DATA, volunteer: { ...DATA.volunteer!, guardianPending: true } });
    expect(minor.text).toContain("Fiind sub 18 ani, ai nevoie și de acordul unui părinte sau tutore.");
    expect(minor.text).toContain("Being under 18, you also need a parent's or guardian's consent.");
    expect(minor.text).toContain("Ce urmează: organizatorii îți aleg rolul și te confirmă.");
    expect(receipt().text).not.toContain("Fiind sub 18 ani");
  });

  it("says the agreement and the parent's condition before «Ce urmează», so a minor reads the condition before «te confirmă»", () => {
    const { text } = receipt({ ...DATA, volunteer: { ...DATA.volunteer!, guardianPending: true } });
    const next = text.indexOf("Ce urmează:");
    expect(text.indexOf("Contractul de voluntariat pe care l-ai acceptat")).toBeLessThan(next);
    expect(text.indexOf("Fiind sub 18 ani")).toBeLessThan(next);
    expect(text.indexOf("Being under 18")).toBeLessThan(text.indexOf("What happens next:"));
    expect(text.indexOf("The volunteer agreement you accepted")).toBeLessThan(text.indexOf("What happens next:"));
    // …and the not-you line stays last.
    expect(text.indexOf("Dacă nu tu ai trimis oferta")).toBeGreaterThan(text.indexOf("În ziua evenimentului vii la ora"));
  });

  it("holds no number, no deadline and no club name of its own in the new paragraphs", () => {
    const { text } = receipt();
    const from = text.indexOf("Ce urmează:");
    const to = text.indexOf("În ziua evenimentului vii la ora și la locul pe care ți le spun organizatorii.") + 90;
    const ro = text.slice(from, to);
    expect(ro).not.toMatch(/\d/);
    expect(ro).not.toContain(CLUB_NAME);
    const en = text.slice(text.indexOf("What happens next:"), text.indexOf("On the day of the event you come") + 90);
    expect(en).not.toMatch(/\d/);
    expect(en).not.toContain(CLUB_NAME);
  });
});

describe("§800 the club's copy editor starts from the new words, and a text the club saved is not touched", () => {
  it("starts from the platform's words — «Ce urmează» in the editor's prefill, in both languages, with the event as its one field", () => {
    for (const [locale, lead, day] of [
      ["ro", "Ce urmează: organizatorii îți aleg rolul și te confirmă.", "În ziua evenimentului vii la ora și la locul pe care ți le spun organizatorii."],
      ["en", "What happens next: the organizers choose your role and confirm you.", "On the day of the event you come at the time and place the organizers tell you."],
    ] as const) {
      const prefill = emailCopyPrefill("VOLUNTEER_RECEIVED", locale);
      expect(prefill.paragraphs.some((paragraph) => paragraph.startsWith(lead)), locale).toBe(true);
      expect(prefill.paragraphs, locale).toContain(day);
      // The prefill is made of fields, never of the page's sample values (§359).
      expect(emailSampleLiteralsIn(prefill.paragraphs.join("\n"), "VOLUNTEER_RECEIVED"), locale).toEqual([]);
      expect(prefill.paragraphs.join("\n"), locale).toContain("{eventTitle}");
    }
  });
});
