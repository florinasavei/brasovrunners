import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { focusRefusal, newsletterLeaveRefused, parseNewsletterLeaveOutcome } from "@/modules/newsletter/ui/newsletter-box";
import { emailSampleActionUrl, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §550 (amending §445; the owner, 2026-09-28 23:10: «oamenii pot să se și dezaboneze de la
 * newsletter») — «Vreau să mă dezabonez» on the contact page: its words in both languages, its
 * answers in the address, and the message a subscriber receives from it.
 */
describe("§550 «Vreau să mă dezabonez»: the words", () => {
  it("has the same keys in both languages, plain sentences of at most 200 characters, no ICU plural", () => {
    expect(Object.keys(ro.Newsletter.leave).sort()).toEqual(Object.keys(en.Newsletter.leave).sort());
    for (const catalogue of [ro, en]) {
      for (const [key, text] of Object.entries(catalogue.Newsletter.leave)) {
        expect(text.length, key).toBeLessThanOrEqual(200);
        expect(text, key).not.toMatch(/\{[^}]*,\s*(plural|select)/);
        expect(text.trim(), key).not.toBe("");
      }
    }
    expect(ro.Newsletter.leave.open).toBe("Vreau să mă dezabonez");
    expect(en.Newsletter.leave.open).toBe("I want to unsubscribe");
  });

  it("answers one sentence that says nothing about the address", () => {
    expect(ro.Newsletter.leave.sent).toBe("Dacă adresa e abonată, ai primit un email cu linkul de gestionare.");
    expect(en.Newsletter.leave.sent).toBe("If the address is subscribed, you have received an email with the link to manage it.");
  });

  it("reads its answer from `?nleave=` and opens the fold only for a refusal to fix", () => {
    expect(parseNewsletterLeaveOutcome("sent")).toBe("sent");
    expect(parseNewsletterLeaveOutcome("limited")).toBe("limited");
    expect(parseNewsletterLeaveOutcome("open")).toBeNull();
    expect(parseNewsletterLeaveOutcome(undefined)).toBeNull();
    expect(newsletterLeaveRefused("sent")).toBe(false);
    expect(newsletterLeaveRefused(null)).toBe(false);
    for (const refusal of ["invalid", "captcha", "limited"] as const) expect(newsletterLeaveRefused(refusal)).toBe(true);
  });
});

describe("§550 «Vreau să mă dezabonez»: the message", () => {
  it("says what was asked in both halves, with the button to the subscriber's own page and no confirmation words", () => {
    const data = { ...emailSampleFor("NEWSLETTER_CONFIRM", "ro"), newsletterAlready: true, newsletterManageRequest: true };
    const message = renderBilingual("NEWSLETTER_CONFIRM", "ro", data, emailSampleActionUrl("ro"));
    const [romanian, english] = message.text.split("— — —");
    expect(romanian).toContain("a cerut, pe pagina noastră de contact, linkul abonamentului la noutăți");
    expect(romanian).toContain("te dezabonezi de la tot");
    expect(romanian).toContain("Vezi abonamentul");
    expect(english).toContain("asked, on our contact page, for the link to this address's subscription");
    expect(english).toContain("you unsubscribe from everything");
    // Not the "you asked to subscribe again" words, and no confirmation link's life.
    expect(message.text).not.toContain("a cerut din nou");
    expect(message.text).not.toContain("Linkul este valabil");
    expect(message.subject).toContain("Abonamentul tău");
  });
});

describe("§NNN «Vreau să mă dezabonez»: a refusal takes the focus, as a §47 summary does", () => {
  /** A stand-in for the page: one alert, inside a fold that may be closed. */
  function page(open: boolean) {
    const fold = { open };
    const focused: string[] = [];
    const alert = { closest: (selector: string) => (selector === "details" ? fold : null), focus: () => focused.push("newsletter-leave-errors") };
    const root = { getElementById: (id: string) => (id === "newsletter-leave-errors" ? (alert as unknown as HTMLElement) : null) };
    return { root, fold, focused };
  }

  it("focuses the leave form's alert on arrival, opening its fold first", () => {
    const { root, fold, focused } = page(false);
    expect(focusRefusal(root, "newsletter-leave-errors")).toBe(true);
    expect(fold.open).toBe(true);
    expect(focused).toEqual(["newsletter-leave-errors"]);
  });

  it("does nothing without a refusal on the page", () => {
    const { root, focused } = page(true);
    expect(focusRefusal(root, null)).toBe(false);
    expect(focusRefusal(root, "newsletter-errors")).toBe(false);
    expect(focused).toEqual([]);
  });

  it("is asked for by the contact page for a failed check or the hour's limit only", () => {
    const signup = readFileSync("src/modules/newsletter/ui/NewsletterSignup.tsx", "utf8");
    expect(signup).toContain("focusOnArrival={leaveErrorText ? NEWSLETTER_LEAVE_ERROR_ID : null}");
    expect(signup).toContain('const leaveErrorText = leaveOutcome === "captcha" ? t("errors.captcha") : leaveOutcome === "limited" ? t("errors.limited") : null;');
    expect(signup).toMatch(/id=\{NEWSLETTER_LEAVE_ERROR_ID\} role="alert" tabIndex=\{-1\}/);
    expect(readFileSync("src/modules/newsletter/ui/NewsletterDialogButton.tsx", "utf8")).toContain("focusRefusal(document, focusOnArrival);");
  });
});
