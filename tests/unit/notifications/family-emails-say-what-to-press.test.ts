import { describe, expect, it } from "vitest";
import { emailCopyPrefill, emailSampleFamilyConfirmed, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";

/**
 * §536 (the owner, 2026-09-28) — the three emails of a registration say in one line what to press and
 * what follows: the verification email, a family's one message, and a family's one confirmation. Each
 * is rendered here as `/admin/emails` previews it, from the page's own sample (`emailSampleFor`).
 */
const ACTION = "https://example.invalid/action";

describe("§536 the verification email says what to press first", () => {
  it("names the event in the subject, then one line of what to press and what follows, the facts block, and the link's life in one line", () => {
    const data = emailSampleFor("VERIFY_REGISTRATION_EMAIL", "ro");
    const message = renderBilingual("VERIFY_REGISTRATION_EMAIL", "ro", data, ACTION, null);
    expect(message.subject).toContain("Confirmă adresa — Crosul de toamnă");
    expect(message.subject).toContain("Confirm your address — ");
    const first = "Apasă butonul ca să confirmi adresa. Dacă mai e loc, semnezi apoi declarația și primești codul QR.";
    expect(message.text).toContain(first);
    // The first line of the body, right under the greeting.
    expect(message.text.split("\n\n")[1].startsWith(`${first}\n`)).toBe(true);
    expect(message.text).toMatch(/^Când: /m);
    expect(message.text).toMatch(/Linkul e valabil \d+ de ore; fără confirmare, înscrierea expiră\./);
    expect(message.text).toContain("Press the button to confirm your address. If there is still a place, you then sign the declaration and get your QR code.");
  });

  it("keeps every field a placeholder in the editor's starting text — no literal value (§359)", () => {
    const prefill = emailCopyPrefill("VERIFY_REGISTRATION_EMAIL", "ro");
    expect(prefill.subject).toBe("Confirmă adresa — {eventTitle}");
    expect(prefill.paragraphs[0]).toBe("Apasă butonul ca să confirmi adresa. Dacă mai e loc, semnezi apoi declarația și primești codul QR.");
    expect(prefill.paragraphs.join("\n")).toContain("Linkul e valabil {confirmationHours}; fără confirmare, înscrierea expiră.");
    expect(emailCopyPrefill("VERIFY_REGISTRATION_EMAIL", "en").subject).toBe("Confirm your address — {eventTitle}");
  });

  it("keeps the club copy's shape: its mark on the subject and its note first, no button", () => {
    const data = { ...emailSampleFor("VERIFY_REGISTRATION_EMAIL", "ro"), clubCopy: true };
    const message = renderBilingual("VERIFY_REGISTRATION_EMAIL", "ro", data, ACTION, null);
    expect(message.subject.startsWith("[Copie club] Confirmă adresa — ")).toBe(true);
    expect(message.text.split("\n\n")[1]).toContain("Copie pentru club");
    expect(message.html).not.toContain(ACTION);
  });
});

describe("§536 a family's one message says the one button does everything", () => {
  const people = [
    { name: "Ana Pop", birthDate: "1985-03-02" },
    { name: "Maria Pop", birthDate: "2010-07-11" },
  ];

  function family(extra: Record<string, unknown> = {}) {
    const data = { ...emailSampleFor("REGISTER_ANOTHER_PERSON", "ro"), familySittingPeople: people, familyRegistered: [], ...extra };
    return renderBilingual("REGISTER_ANOTHER_PERSON", "ro", data, ACTION, null);
  }

  it("opens with the one line, then one line per person with the birth date in words, the button with the count, and the link's life", () => {
    const message = family();
    const lead = "Un singur buton: confirmi adresa și cele 2 înscrieri, apoi semnezi pe rând declarațiile celor care mai au loc.";
    expect(message.text.split("\n\n")[1].startsWith(`${lead}\n`)).toBe(true);
    expect(message.text).toContain("Persoana 1 din 2: Ana Pop, data nașterii 2 martie 1985");
    expect(message.text).toContain("Persoana 2 din 2: Maria Pop, data nașterii 11 iulie 2010");
    expect(message.text).not.toContain("la 2 martie");
    expect(message.text).toContain("Confirm și semnez declarațiile (2)");
    expect(message.text).toMatch(/Termen: linkul e valabil \d+ de ore și se folosește o singură dată/);
    // Said once: the old «Ce se întâmplă dacă apeși» row is the first line now.
    expect(message.text).not.toContain("Ce se întâmplă dacă apeși");
    expect(message.text).toContain("One button: you confirm the address and the 2 registrations, then sign, one by one, the declarations of those who still have a place.");
    expect(message.text).toContain("Confirm and sign the declarations (2)");
    expect(message.text).not.toContain("emailul anterior");
  });

  it("says the button covers an earlier email's person too, only when one left before «Da»", () => {
    const message = family({ familyEarlierSent: true });
    expect(message.text).toContain("Acest email îi cuprinde pe toți: butonul de mai jos confirmă și înscrierea din emailul anterior.");
    expect(message.text).toContain("This email covers everybody: the button below also confirms the registration from the earlier email.");
  });

  it("says one person plainly, with no count", () => {
    const message = family({ familySittingPeople: people.slice(0, 1) });
    expect(message.text).toContain("Un singur buton: confirmi adresa și înscrierea, apoi, dacă mai e loc, semnezi declarația.");
  });
});

describe("§536 a family's one confirmation: one line, then one block per person", () => {
  function confirmed(clubCopy: boolean) {
    const data = { ...emailSampleFor("REGISTRATION_CONFIRMED", "ro"), familyConfirmed: emailSampleFamilyConfirmed(), ...(clubCopy ? { clubCopy: true } : {}) };
    return renderBilingual("REGISTRATION_CONFIRMED", "ro", data, ACTION, null);
  }

  it("says in one line what is under each name", () => {
    const message = confirmed(false);
    expect(message.text).toContain("Toți cei de mai jos sunt înscriși la Crosul de toamnă; sub fiecare nume, numărul, codul și QR-ul de arătat la masă.");
    expect(message.text).not.toContain("Vă așteptăm!");
    expect(message.html.match(/data-email-part="family-person"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the club's copy, with no code and no QR, names only the number", () => {
    const message = confirmed(true);
    expect(message.text).toContain("Toți cei de mai jos sunt înscriși la Crosul de toamnă; sub fiecare nume, numărul de concurs.");
    expect(message.text).not.toContain("QR-ul de arătat");
  });
});
