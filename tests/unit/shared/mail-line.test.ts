import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { mailLine, TOAST_MAX_CHARACTERS, toastSentence } from "@/shared/feedback/mail-line";
import { type FormNotice, noticeOf } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * The toast's mail line (the design «telling the owner about every email a staff press sends», slice 2): what an
 * emailing press sent, to how many, when — from the flash's values, in the reader's language, the type in the words
 * of «Emailuri»; nothing when the press sent nothing; a value the browser rewrote is no line; and, with the act's own
 * sentence, short enough to read: it drops other people's emails, the test addresses, the roles' note, the road, the
 * club's count and Zitadel's note, in that order, before the toast passes 200 characters.
 */

const CATALOGUES = { ro, en } as const;
type Locale = keyof typeof CATALOGUES;

function words(locale: Locale) {
  // The `Feedback` namespace as the provider's translator reads it (`intl-server.ts`'s way: untyped keys).
  const t = createTranslator({ locale, messages: CATALOGUES[locale].Feedback as never }) as unknown as (key: string, values?: Record<string, string>) => string;
  const types = CATALOGUES[locale].Admin.emails.types as Record<string, string>;
  return {
    t: (key: string, values?: Record<string, string>) => t(key, values),
    typeName: (type: string) => types[type] ?? null,
  };
}

function line(values: Record<string, string>, locale: Locale = "ro", room?: number): string | null {
  const { t, typeName } = words(locale);
  return mailLine(values, t, typeName, locale, room);
}

// 10:00 in Brașov on 4 November 2026 (UTC+2); the email leaves at 10:15.
const PRESSED = "2026-11-04T08:00:00.000Z";
const AT = "2026-11-04T08:15:00.000Z";

const cancelled = {
  mail: "at",
  mailAt: AT,
  mailTo: "people",
  mailPeople: "1",
  mailPressedAt: PRESSED,
  mailType: "REGISTRATION_CANCELLED",
  mailClub: "1",
  mailOthers: "1",
  mailOtherType: "WAITLIST_SPOT_OFFER",
};

describe("the mail line says what left, to how many, and when", () => {
  it("reads as the design's example, in both languages", () => {
    expect(line(cancelled)).toBe("Pleacă la 10:15 (estimat): „Înscriere anulată” către 1 persoană și 1 email pentru club. În plus, 1 email către altă persoană: „S-a eliberat un loc”.");
    expect(line(cancelled, "en")).toBe("Leaves at 10:15 (estimated): “Registration cancelled” to 1 person and 1 email to the club. Also, 1 email to another person: “A place has freed up”.");
  });

  it("says now, the road the dialog chose, and after Mailgun resumes", () => {
    expect(line({ mail: "now", mailTo: "people", mailPeople: "1", mailPressedAt: PRESSED, mailType: "COMPLETE_DECLARATION", mailRoad: "gmail" })).toBe(
      "Pleacă acum prin Gmail-ul clubului: „Semnează declarația” către 1 persoană.",
    );
    expect(line({ mail: "reset", mailAt: AT, mailTo: "people", mailPeople: "3", mailPressedAt: PRESSED, mailType: "EVENT_REMINDER" })).toBe(
      "Pleacă după ce Mailgun reia, la 10:15 (estimat): „Reminderul dinaintea startului” către 3 persoane.",
    );
  });

  it("names the day when the email leaves on another one, never «la» twice", () => {
    const tomorrow = line({ mail: "at", mailAt: "2026-11-05T06:00:00.000Z", mailTo: "people", mailPeople: "25", mailPressedAt: PRESSED, mailType: "NEWSLETTER" });
    expect(tomorrow).toMatch(/^Pleacă \S.*, la 08:00 \(estimat\): „Newsletter” către 25 de persoane\.$/);
    expect(tomorrow).not.toMatch(/la .* la /);
  });

  it("splits a send: the first part, and how many leave later or over the next days", () => {
    expect(
      line({ mail: "now", mailTo: "people", mailPeople: "40", mailPressedAt: PRESSED, mailType: "ORGANIZER_MESSAGE", mailLater: "5", mailLaterAt: AT }),
    ).toBe("Pleacă acum: „Mesaj de la organizatori” către 40 de persoane; celelalte 5 pleacă la 10:15 (estimat).");
    expect(line({ mail: "at", mailAt: AT, mailTo: "people", mailPeople: "50", mailPressedAt: PRESSED, mailType: "NEWSLETTER", mailLater: "250", mailLaterDays: "1" }, "en")).toBe(
      "Leaves at 10:15 (estimated): “Newsletter” to 50 people; the other 250 leave over the next days.",
    );
    expect(line({ mail: "days", mailTo: "people", mailPeople: "30", mailPressedAt: PRESSED, mailType: "NEWSLETTER" })).toBe(
      "Pleacă în zilele următoare, după limita zilei: „Newsletter” către 30 de persoane.",
    );
  });

  it("names other people's email when the person got none, and test addresses apart", () => {
    expect(line({ mail: "now", mailTo: "others", mailPeople: "1", mailPressedAt: PRESSED, mailType: "WAITLIST_SPOT_OFFER" })).toBe(
      "Pleacă acum: „S-a eliberat un loc” către 1 altă persoană.",
    );
    expect(line({ mail: "now", mailTo: "others", mailPeople: "3", mailPressedAt: PRESSED })).toBe("Pleacă acum: 3 emailuri către alte persoane.");
    expect(line({ mail: "now", mailTo: "test", mailPeople: "2", mailPressedAt: PRESSED, mailType: "VERIFY_REGISTRATION_EMAIL" })).toBe(
      "Pleacă acum: „Confirmă adresa de email” către 2 adrese de test, nenumărate.",
    );
    expect(line({ mail: "now", mailTo: "people", mailPeople: "2", mailPressedAt: PRESSED, mailType: "REGISTRATION_CANCELLED", mailTest: "1" })).toBe(
      "Pleacă acum: „Înscriere anulată” către 2 persoane (+1 către adresă de test, nenumărat).",
    );
  });

  it("adds the roles' hold and Zitadel's own email", () => {
    expect(line({ mail: "at", mailAt: AT, mailTo: "people", mailPeople: "1", mailPressedAt: PRESSED, mailType: "VOLUNTEER_ROLE_ASSIGNED", mailRoles: "1" })).toBe(
      "Pleacă la 10:15 (estimat): „Rolul tău de voluntar” către 1 persoană. Dacă până atunci rolurile nu mai sunt aceleași, emailul se retrage.",
    );
    expect(line({ mail: "now", mailTo: "people", mailPeople: "1", mailPressedAt: PRESSED, mailType: "STAFF_INVITATION", mailZitadel: "1" }, "en")).toBe(
      "Leaving now: “The team invitation” to 1 person. Zitadel sends the password link separately, now.",
    );
  });

  it("is no line when the press sent nothing, or when a value does not add up", () => {
    expect(line({})).toBeNull();
    expect(line({ count: "3" })).toBeNull();
    expect(line({ ...cancelled, mail: "soon" })).toBeNull();
    expect(line({ ...cancelled, mailPeople: "Ana" })).toBeNull();
    expect(line({ ...cancelled, mailPeople: "0" })).toBeNull();
    expect(line({ ...cancelled, mailAt: "tomorrow" })).toBeNull();
    expect(line({ ...cancelled, mailType: "ana@example.ro" })).toBeNull();
    expect(line({ ...cancelled, mailType: "NOT_A_TYPE" })).toBeNull();
    expect(line({ ...cancelled, mailPressedAt: "" })).toBeNull();
  });
});

describe("the toast stays short: 200 characters with the act's sentence", () => {
  const said = "Înscrierea a fost anulată.";
  const full = {
    ...cancelled,
    mailTest: "2",
    mailRoad: "mailgun",
    mailRoles: "1",
    mailZitadel: "1",
  };

  it("drops other people's emails first, then the test addresses, the roles' note, the road, the club's count and Zitadel's note", () => {
    const whole = line(full) as string;
    expect(whole).toContain("În plus");
    const room = whole.length - 1;
    expect(line(full, "ro", room)).not.toContain("În plus");
    expect(line(full, "ro", room)).toContain("test");
    const steps = [
      (text: string) => !text.includes("În plus"),
      (text: string) => !text.includes("adrese de test"),
      (text: string) => !text.includes("rolurile"),
      (text: string) => !text.includes("prin Mailgun"),
      (text: string) => !text.includes("pentru club"),
      (text: string) => !text.includes("Zitadel"),
    ];
    // Each shorter room gives up one more part, in the order above, and never what the person got and when.
    let text = whole;
    for (const step of steps) {
      text = line(full, "ro", text.length - 1) as string;
      expect(step(text), text).toBe(true);
      expect(text).toContain("Pleacă la 10:15 (estimat)");
      expect(text).toContain("„Înscriere anulată” către 1 persoană");
    }
    expect(line(full, "ro", 0)).toBe("Pleacă la 10:15 (estimat): „Înscriere anulată” către 1 persoană.");
  });

  it("keeps a toast with every part within 200 characters, in both languages", () => {
    for (const locale of ["ro", "en"] as const) {
      const text = line(full, locale, TOAST_MAX_CHARACTERS - said.length - 1) as string;
      expect(`${said} ${text}`.length).toBeLessThanOrEqual(TOAST_MAX_CHARACTERS);
    }
  });

  it("has every counted form with its count, in both catalogues, and no ICU plural", () => {
    for (const catalogue of [ro, en]) {
      const mail = catalogue.Feedback.mail as Record<string, unknown>;
      for (const [key, entry] of Object.entries(mail)) {
        if (typeof entry === "string") {
          expect(entry, key).not.toMatch(/\{\w+,\s*plural/);
          continue;
        }
        const forms = entry as Record<string, string>;
        if (!("other" in forms)) continue;
        for (const form of ["one", "few", "other"]) expect(forms[form], `${key}.${form}`).toContain("{count}");
      }
    }
  });
});

/**
 * The whole toast (`toastSentence`, what `ToastProvider` draws): the act's sentence, counted by the notice's `count`, then
 * the mail line — or, without one, the road. The bulk cancel's flash is built here as `flash.ts` builds it: `noticeOf`
 * the action's outcome, the press's `mail…` values merged in.
 */
describe("the toast: the act, then what the press emailed", () => {
  function toast(notice: FormNotice, locale: Locale = "ro"): string {
    const t = createTranslator({ locale, messages: CATALOGUES[locale].Feedback as never }) as unknown as Parameters<typeof toastSentence>[1];
    const types = CATALOGUES[locale].Admin.emails.types as Record<string, string>;
    return toastSentence(notice, t, (type) => types[type] ?? null, locale);
  }
  const withMail = (outcome: Record<string, string>, mail: Record<string, string>): FormNotice => {
    const notice = noticeOf(outcome) as FormNotice;
    return { ...notice, values: { ...notice.values, ...mail } };
  };
  const twoCancelled = { mail: "now", mailTo: "people", mailPeople: "2", mailPressedAt: PRESSED, mailType: "REGISTRATION_CANCELLED", mailRoad: "mailgun" };

  it("the bulk cancel over two real rows: the count's form, then the two emails", () => {
    const notice = withMail({ saved: "registrationsCancelled", cancelled: "2", failed: "0", test: "0" }, twoCancelled);
    expect(toast(notice)).toBe("2 înscrieri anulate. Pleacă acum prin Mailgun: „Înscriere anulată” către 2 persoane.");
    expect(toast(notice, "en")).toBe("2 registrations cancelled. Leaving now by Mailgun: “Registration cancelled” to 2 people.");
  });

  it("the bulk cancel that took a test row too: its own act, then the emails with the test address apart (§30)", () => {
    const notice = withMail({ saved: "registrationsCancelled", cancelled: "2", failed: "1", test: "1" }, { ...twoCancelled, mailTest: "1" });
    expect(notice.key).toBe("registrationsCancelledTest");
    const said = toast(notice);
    expect(said).toMatch(/^2 înscrieri anulate\. Anulate și ele, nenumărate nicăieri: 1 [^.]+\. Pleacă acum prin Mailgun: „Înscriere anulată” către 2 persoane \(\+1 către adresă de test, nenumărat\)\.$/);
    expect(said).not.toContain("2 înscrieri anulate. Pleacă ");
    expect(said.length).toBeLessThanOrEqual(TOAST_MAX_CHARACTERS);
  });

  it("without a mail line: the road the press chose, or the act alone; a key with no sentence says «Salvat.»", () => {
    expect(toast({ kind: "success", key: "registrationsCancelled", values: { count: "1", via: "gmail" } })).toBe("1 înscriere anulată. Pleacă prin Gmail-ul clubului.");
    expect(toast({ kind: "success", key: "registrationsCancelled", values: { count: "21" } })).toBe("21 de înscrieri anulate.");
    expect(toast({ kind: "success", key: "noSuchSentenceYet" })).toBe("Salvat.");
    expect(toast({ kind: "error", key: "x", sentence: "Already in the reader's words." })).toBe("Already in the reader's words.");
  });
});
