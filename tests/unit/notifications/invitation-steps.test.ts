import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailCopyKey, emailCopySchema } from "@/modules/notifications/domain/email-copy";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import { signInStepsAfter, signInStepsOf, ZITADEL_LOGIN_LABELS, zitadelInviteButton, zitadelInviteSubject } from "@/modules/staff-identity/domain/zitadel-invite";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §1000 — the club's invitation says the sign-in steps in order (the owner, 2026-11-19: «am o alta problema a invitarea
 * voluntarilor in echpa, cumva trebuie un delay intre mailurile de logare, sau sa fie instructiunile mai clare»).
 *
 * Two shapes, by whose the account is, carried in the payload at the press (`signInSteps`): Zitadel's — its email first,
 * named by its subject, then the button, with the line for an account that already signs in and the trap of a sign-in
 * tried before step 1 — and the person's own — the button, then «Register new user» with exactly this address. Both
 * messages (the team's, the member's), both languages, the privacy paragraph kept. The club's own words for the message
 * are for Zitadel's shape; the other is the platform's alone.
 */
const ACTION = "https://example.test/ro/sign-in";
const BASE: TemplateData = { participantName: "Ana Pop", staffRole: "Organizator", inviterName: "Dan Ionescu", staffEmail: "ana@example.ro" };
const TYPES = ["STAFF_INVITATION", "MEMBER_INVITATION"] as const;
const BUTTON = {
  STAFF_INVITATION: { ro: "Intră în backoffice", en: "Open the backoffice" },
  MEMBER_INVITATION: { ro: "Intră în zona membrilor", en: "Open the members' area" },
} as const;

function render(type: (typeof TYPES)[number], locale: "ro" | "en", data: Partial<TemplateData> = {}, overrides: ReturnType<typeof emailCopySchema.parse> | null = null) {
  return renderBilingual(type, locale, { ...BASE, ...data }, ACTION, overrides);
}

/** Each half of the plain text: the email's language first, the other after the rule. */
function halves(text: string): [string, string] {
  const [first, second] = text.split("\n— — —\n");
  return [first, second];
}

describe("§1000 the invitation's steps when the press asked Zitadel for the account", () => {
  for (const type of TYPES) {
    it(`${type}: says who sends what, Zitadel's email by its subject, and the steps in order, in both halves`, () => {
      const email = render(type, "ro", { signInSteps: "zitadel", zitadelSubject: zitadelInviteSubject("ro"), zitadelButton: zitadelInviteButton("ro") });
      const [ro, en] = halves(email.text);
      const subject = `Invitație la ${CLUB_NAME}`;
      // Romanian half: Zitadel's email by its subject and by its button, as the owner saw it (2026-11-19), and — since §1021 —
      // said to come first, about a minute and a half before this one, which the press makes true.
      expect(ro).toContain(
        `Primești două emailuri: întâi unul de la Zitadel, sistemul nostru de autentificare, cu subiectul „${subject}” și butonul „Acceptare invitație”, cam cu un minut și jumătate înaintea acestuia (caută-l și în Spam); apoi acesta, de la noi. Pașii, în ordine:`,
      );
      const one = ro.indexOf("1. Deschide emailul de la Zitadel, apasă „Acceptare invitație” și alege-ți parola.");
      const two = ro.indexOf(`2. Apoi apasă „${BUTTON[type].ro}”, mai jos, și intră cu adresa ana@example.ro și parola aleasă.`);
      expect(one).toBeGreaterThan(-1);
      expect(two).toBeGreaterThan(one);
      expect(ro).toContain("Ai deja cont (ai mai intrat la noi)? Sari peste pasul 1.");
      expect(ro).toContain(`Nu încerca să intri înainte de pasul 1: până îți alegi parola, fiecare încercare — și „${ZITADEL_LOGIN_LABELS.resendCode}” de pe pagina de autentificare — îți trimite alt email de la Zitadel, cu alt cod, și îl anulează pe cel de dinainte.`);
      expect(ro).toContain("Dacă ai primit mai multe, folosește-l doar pe cel mai nou.");
      // English half: the same steps and the same order, and Zitadel's email by the subject it really has — the account's language.
      expect(en).toContain(
        `You get two emails: first one from Zitadel, our sign-in system, with the subject “${subject}” and the button “Acceptare invitație”, about a minute and a half before this one (look in your spam folder too); then this one, from us. The steps, in order:`,
      );
      expect(en).toContain("1. Open the email from Zitadel, press “Acceptare invitație” and choose your password.");
      expect(en.indexOf("1. Open the email from Zitadel")).toBeLessThan(en.indexOf(`2. Then press “${BUTTON[type].en}”, below, and sign in with ana@example.ro`));
      expect(en).toContain("Already have an account (signed in with us before)? Skip step 1.");
      expect(en).toContain(`“${ZITADEL_LOGIN_LABELS.resendCode}” on the sign-in page`);
      // Not the other shape's words.
      for (const half of [ro, en]) expect(half).not.toContain(ZITADEL_LOGIN_LABELS.register);
      // The subject and the warning are bold where the reader looks first.
      expect(email.html).toContain(`<strong>${subject}</strong>`);
      expect(email.html).toContain("<strong>Acceptare invitație</strong>");
      expect(email.html).toContain("<strong>Nu încerca să intri înainte de pasul 1</strong>");
    });

    it(`${type}: keeps the privacy paragraph, and the button is the one the second step names`, () => {
      const email = render(type, "en", { signInSteps: "zitadel" });
      expect(email.text).toContain("Pentru cont folosim Zitadel, cu numele și adresa ta");
      expect(email.text).toContain("Your account is held by Zitadel, with your name and address");
      expect(email.text).toContain(`${BUTTON[type].en}: ${ACTION}`);
      // Each half's button says the words its own second step names.
      expect(email.html).toContain(`>${BUTTON[type].en}</a>`);
      expect(email.html).toContain(`>${BUTTON[type].ro}</a>`);
    });
  }

  it("names an English account's email “Invitation to …” and its button “Accept invite” in both halves", () => {
    const [en, ro] = halves(render("STAFF_INVITATION", "en", { signInSteps: "zitadel", zitadelSubject: zitadelInviteSubject("en"), zitadelButton: zitadelInviteButton("en") }).text);
    expect(en).toContain(`with the subject “Invitation to ${CLUB_NAME}” and the button “Accept invite”`);
    expect(ro).toContain(`cu subiectul „Invitation to ${CLUB_NAME}” și butonul „Accept invite”`);
  });

  it("reads a row queued before §1000, with no steps in its payload, as Zitadel's shape", () => {
    const [ro] = halves(render("STAFF_INVITATION", "ro").text);
    expect(ro).toContain("1. Deschide emailul de la Zitadel");
    expect(ro).toContain(`cu subiectul „Invitație la ${CLUB_NAME}”`);
  });

  it("tells the team the access begins at the first sign-in, and never sends a member to the backoffice", () => {
    expect(render("STAFF_INVITATION", "ro", { signInSteps: "zitadel" }).text).toContain("Accesul începe la prima autentificare.");
    const member = render("MEMBER_INVITATION", "ro", { signInSteps: "zitadel" }).text;
    expect(member).not.toContain("backoffice");
    expect(member).not.toContain("Accesul începe la prima autentificare.");
  });
});

describe("§1000 the invitation's steps when the person makes the account", () => {
  for (const type of TYPES) {
    it(`${type}: the button, then «${ZITADEL_LOGIN_LABELS.register}» with exactly this address, in both halves`, () => {
      const email = render(type, "ro", { signInSteps: "self" });
      const [ro, en] = halves(email.text);
      expect(ro).toContain("Contul de autentificare ți-l faci singur, în doi pași:");
      const one = ro.indexOf(`1. Apasă „${BUTTON[type].ro}”, mai jos.`);
      const two = ro.indexOf(`2. Pe pagina de autentificare alege „${ZITADEL_LOGIN_LABELS.register}” și fă-ți contul cu exact adresa ana@example.ro (contul e legat de adresă). Dacă ai deja cont, intră direct cu adresa și parola ta.`);
      expect(one).toBeGreaterThan(-1);
      expect(two).toBeGreaterThan(one);
      expect(en).toContain("You make your sign-in account yourself, in two steps:");
      expect(en).toContain(`1. Press “${BUTTON[type].en}”, below.`);
      expect(en).toContain(`2. On the sign-in page choose “${ZITADEL_LOGIN_LABELS.register}” and create your account with exactly ana@example.ro (the account is tied to the address).`);
      // No email from Zitadel is coming: none is announced, no step waits for it, and no gap is said (§1021).
      for (const half of [ro, en]) {
        expect(half).not.toContain("Invitație la");
        expect(half).not.toContain("Invitation to");
        expect(half).not.toContain(ZITADEL_LOGIN_LABELS.resendCode);
        expect(half).not.toMatch(/un minut și jumătate|a minute and a half/);
      }
      // The privacy paragraph stays.
      expect(ro).toContain("Pentru cont folosim Zitadel, cu numele și adresa ta");
      expect(en).toContain("Your account is held by Zitadel, with your name and address");
    });
  }

  it("falls back to «aceasta» / “this address” for a message with no address, as the old text did", () => {
    const [ro, en] = halves(render("STAFF_INVITATION", "ro", { signInSteps: "self", staffEmail: undefined }).text);
    expect(ro).toContain("cu exact adresa aceasta (contul e legat de adresă)");
    expect(en).toContain("with exactly this address (the account is tied to the address)");
  });
});

describe("§1000 the club's own words for the invitation", () => {
  const written = emailCopySchema.parse({
    [emailCopyKey("STAFF_INVITATION", "ro")]: { subject: "Bun venit în echipă", paragraphs: ["Textul clubului, cu pașii lui."] },
    [emailCopyKey("STAFF_INVITATION", "en")]: { subject: "Welcome to the team", paragraphs: ["The club's own words, with its steps."] },
  });

  it("are what Zitadel's shape sends, as before", () => {
    const email = render("STAFF_INVITATION", "ro", { signInSteps: "zitadel" }, written);
    expect(email.subject).toContain("Bun venit în echipă");
    expect(email.text).toContain("Textul clubului, cu pașii lui.");
    expect(email.text).not.toContain("1. Deschide emailul de la Zitadel");
  });

  it("are not sent with the person's own steps: those words were written for Zitadel's email, which is not coming", () => {
    const email = render("STAFF_INVITATION", "ro", { signInSteps: "self" }, written);
    expect(email.text).not.toContain("Textul clubului");
    expect(email.text).not.toContain("The club's own words");
    expect(email.text).toContain(`2. Pe pagina de autentificare alege „${ZITADEL_LOGIN_LABELS.register}”`);
  });
});

describe("§1000 «Setări» → «Emailuri» previews both shapes", () => {
  it("previews Zitadel's shape on the message's own card, the sample's subject named in both halves", () => {
    for (const type of TYPES) {
      const [first, second] = halves(renderBilingual(type, "ro", emailSampleFor(type, "ro"), ACTION, null).text);
      expect(first).toContain("1. Deschide emailul de la Zitadel");
      expect(first).toContain(`„Invitație la ${CLUB_NAME}”`);
      expect(second).toContain(`“Invitație la ${CLUB_NAME}”`);
    }
  });

  it("previews the person's own shape on a second card of the type, the platform's words, in both catalogues", () => {
    for (const type of TYPES) {
      const own = renderBilingual(type, "en", { ...emailSampleFor(type, "en"), signInSteps: "self" }, ACTION, null).text;
      expect(own).toContain(`2. On the sign-in page choose “${ZITADEL_LOGIN_LABELS.register}”`);
    }
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/settings/emails/page.tsx"), "utf8");
    expect(page).toContain('renderBilingual(messageType, emailLocale, { ...sample, signInSteps: "self" }, actionUrl, written.copy)');
    expect(page).toContain("id: `${messageType}-self`");
    for (const catalogue of [ro, en]) {
      const words = catalogue.Admin.emails.selfSignIn as Record<string, string>;
      for (const key of ["name", "whenShort", "when", "platformWords"]) expect(words[key]?.length, key).toBeGreaterThan(0);
      expect(words.name).toContain("{type}");
    }
  });
});

describe("§1000 the invitation's steps for an account that already signs in with its password (`ready`)", () => {
  for (const type of TYPES) {
    it(`${type}: the button alone, with the address and the person's own password — no email of Zitadel's announced`, () => {
      const email = render(type, "ro", { signInSteps: "ready" });
      const [ro, en] = halves(email.text);
      expect(ro).toContain(`Ai deja cont de autentificare (Zitadel), cu parolă: apasă „${BUTTON[type].ro}”, mai jos, și intră cu adresa ana@example.ro și parola ta.`);
      expect(en).toContain(`You already have a sign-in account (Zitadel) with a password: press “${BUTTON[type].en}”, below, and sign in with ana@example.ro and your password.`);
      for (const half of [ro, en]) {
        expect(half).not.toContain("Primești două emailuri");
        expect(half).not.toContain("You get two emails");
        expect(half).not.toContain(ZITADEL_LOGIN_LABELS.register);
        expect(half).not.toMatch(/un minut și jumătate|a minute and a half/);
      }
      // The privacy paragraph stays.
      expect(email.text).toContain("Pentru cont folosim Zitadel, cu numele și adresa ta");
    });
  }

  it("is the platform's words: the club's own text was written for Zitadel's email, which is not coming", () => {
    const overrides = emailCopySchema.parse({ [emailCopyKey("STAFF_INVITATION", "ro")]: { subject: "Bun venit în echipă", paragraphs: ["Textul clubului pentru invitație."] } });
    expect(render("STAFF_INVITATION", "ro", { signInSteps: "zitadel" }, overrides).text).toContain("Textul clubului pentru invitație.");
    expect(render("STAFF_INVITATION", "ro", { signInSteps: "ready" }, overrides).text).not.toContain("Textul clubului pentru invitație.");
  });

  it("is what Zitadel's `ready` answer writes, and what the payload reads back", () => {
    expect(signInStepsAfter("ready")).toBe("ready");
    expect(signInStepsAfter("invited")).toBe("zitadel");
    expect(signInStepsAfter("exists")).toBe("zitadel");
    expect(signInStepsAfter("unconfigured")).toBe("self");
    expect(signInStepsAfter("failed")).toBe("self");
    expect(signInStepsOf("ready")).toBe("ready");
    expect(signInStepsOf("self")).toBe("self");
    expect(signInStepsOf(undefined)).toBe("zitadel");
    expect(signInStepsOf("anything")).toBe("zitadel");
  });
});
