import { describe, expect, it } from "vitest";
import { holdLapsedNext } from "@/modules/notifications/domain/hold-lapsed";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { CANNOT_COME_MESSAGES } from "@/modules/notifications/domain/cannot-come";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §638 — «Locul tău la {event} a expirat» (the owner, 2026-10-02: «Da, fă emailul pentru cel care pierde
 * locul»): the person whose declaration hold was released to somebody who wanted the place is told the
 * deadline that passed, where the place went, and what they can still do — one of three sentences,
 * decided by the allocator's own rules over the event as it stands at the send.
 */
describe("§638 what a person whose hold lapsed can still do", () => {
  const open = { registrationOpen: true, capacity: 10, occupied: 10, waitlisted: 0, openOffers: 0, waitlistCapacity: null };

  it("register again: open, a free place, and nobody waiting", () => {
    expect(holdLapsedNext({ ...open, occupied: 8 })).toBe("register");
    // An uncapped event always has a place.
    expect(holdLapsedNext({ ...open, capacity: null })).toBe("register");
  });

  it("the waiting list: open, no place for a newcomer, and the line takes them", () => {
    expect(holdLapsedNext(open)).toBe("waitlist");
    // Somebody waiting: a newcomer joins the line even with a place free (§615).
    expect(holdLapsedNext({ ...open, occupied: 8, waitlisted: 1 })).toBe("waitlist");
    expect(holdLapsedNext({ ...open, waitlistCapacity: 3, waitlisted: 2 })).toBe("waitlist");
  });

  it("the desk: registration closed, or no place and no room in the line", () => {
    expect(holdLapsedNext({ ...open, registrationOpen: false })).toBe("desk");
    expect(holdLapsedNext({ ...open, registrationOpen: false, occupied: 2 })).toBe("desk");
    // No waiting list at all (a limit of 0), or a line at its limit (§348).
    expect(holdLapsedNext({ ...open, waitlistCapacity: 0 })).toBe("desk");
    expect(holdLapsedNext({ ...open, waitlistCapacity: 2, waitlisted: 1, openOffers: 1 })).toBe("desk");
  });
});

describe("§638 the DECLARATION_HOLD_EXPIRED email's words", () => {
  const ACTION = "https://example.test/ro/evenimente/crosul/inscriere";
  const render = (locale: "ro" | "en", extra: Partial<TemplateData>, action: string | null = ACTION) =>
    renderBilingual("DECLARATION_HOLD_EXPIRED", locale, { ...emailSampleFor("DECLARATION_HOLD_EXPIRED", locale), ...extra }, action ?? undefined);

  it("says the place expired, the deadline that passed, and that it went to the waiting list — in both languages", () => {
    const mail = render("ro", { holdLapsedToWaitlist: true, holdLapsedNext: "waitlist" });
    const sample = emailSampleFor("DECLARATION_HOLD_EXPIRED", "ro");
    expect(mail.subject.startsWith(`Locul pentru ${sample.participantName} la ${sample.eventTitle} a expirat`)).toBe(true);
    expect(mail.text).toContain("a expirat: declarația nu a fost semnată la timp.");
    expect(mail.text).toContain(`Termenul pentru semnare a fost ${sample.holdExpiresAtFormatted}.`);
    expect(mail.text).toContain("Altcineva aștepta un loc, așa că locul tău a trecut la lista de așteptare.");
    expect(mail.text).toContain("Dacă mai vrei să vii, poți intra pe lista de așteptare.");
    expect(mail.text).toContain(`Intră pe lista de așteptare: ${ACTION}`);
    // The English half, in its own words and its own date.
    expect(mail.text).toContain(`The deadline to sign was ${sample.holdExpiresAtFormattedOther}.`);
    expect(mail.text).toContain("Somebody was waiting for a place, so yours went to the waiting list.");
    expect(mail.text).toContain("If you still want to come, you can join the waiting list.");
    // No cancel button: the registration is over (§558), and no manage link either.
    expect(CANNOT_COME_MESSAGES.has("DECLARATION_HOLD_EXPIRED")).toBe(false);
    expect(mail.text).not.toContain("Nu mai pot ajunge");
  });

  it("§NNN the subject names the person and the event, and keeps «Locul tău» when no name is known", () => {
    const sample = emailSampleFor("DECLARATION_HOLD_EXPIRED", "ro");
    expect(render("ro", { participantName: "Ioana Pop", holdLapsedNext: "waitlist" }).subject).toContain(`Locul pentru Ioana Pop la ${sample.eventTitle} a expirat`);
    const english = emailSampleFor("DECLARATION_HOLD_EXPIRED", "en");
    expect(render("en", { participantName: "Ioana Pop", holdLapsedNext: "waitlist" }).subject).toContain(`The place for Ioana Pop at ${english.eventTitle} has expired`);
    expect(render("ro", { participantName: "", holdLapsedNext: "waitlist" }).subject).toContain(`Locul tău la ${sample.eventTitle} a expirat`);
    expect(render("en", { participantName: "", holdLapsedNext: "waitlist" }).subject).toContain(`Your place at ${english.eventTitle} has expired`);
  });

  it("an English registration reads English first", () => {
    const mail = render("en", { holdLapsedToWaitlist: false, holdLapsedNext: "register" }, "https://example.test/en/events/race/register");
    const sample = emailSampleFor("DECLARATION_HOLD_EXPIRED", "en");
    expect(mail.subject.startsWith(`The place for ${sample.participantName} at ${sample.eventTitle} has expired`)).toBe(true);
    expect(mail.text.indexOf("has expired: the declaration was not signed in time.")).toBeLessThan(mail.text.indexOf("a expirat: declarația"));
    expect(mail.text).toContain("Somebody else asked for a place, so yours has been released.");
    expect(mail.text).toContain("If you still want to come, you can register again: there are places free.");
    expect(mail.text).toContain("Register again: https://example.test/en/events/race/register");
    expect(mail.text).toContain("Altcineva a cerut un loc, așa că locul tău a devenit liber.");
    expect(mail.text).toContain("Dacă mai vrei să vii, te poți înscrie din nou: mai sunt locuri libere.");
  });

  it("with nothing more to do online: the desk's sentence, and no button", () => {
    const mail = render("ro", { holdLapsedToWaitlist: true, holdLapsedNext: "desk" }, null);
    expect(mail.text).toContain("Online nu se mai poate face nimic. Dacă în ziua evenimentului rămân locuri libere, le dă masa de înscriere.");
    expect(mail.text).toContain("Nothing more can be done online. If places are left on the day of the event, the registration desk gives them out.");
    expect(mail.text).not.toContain("Intră pe lista de așteptare:");
    expect(mail.text).not.toContain("Înscrie-te din nou:");
  });

  it("without a stored deadline it still says the deadline was missed, never a blank", () => {
    const mail = render("ro", { holdExpiresAtFormatted: undefined, holdExpiresAtFormattedOther: undefined, holdLapsedNext: "waitlist" });
    expect(mail.text).toContain("Termenul pentru semnare a fost depășit.");
    expect(mail.text).toContain("The deadline to sign was missed.");
  });

  it("is a confirmation-group message, queued (not one of §331's silent types), and named on /admin/emails in both languages", () => {
    expect(EMAIL_GROUP_OF.DECLARATION_HOLD_EXPIRED).toBe("confirmations");
    expect(NEVER_QUEUED_MESSAGE_TYPES.has("DECLARATION_HOLD_EXPIRED")).toBe(false);
    // An offer's lapse stays silent (§331).
    expect(NEVER_QUEUED_MESSAGE_TYPES.has("WAITLIST_OFFER_EXPIRED")).toBe(true);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.emails.types.DECLARATION_HOLD_EXPIRED).toBeTruthy();
      expect(catalogue.Admin.emails.when.DECLARATION_HOLD_EXPIRED).toBeTruthy();
      expect(catalogue.Admin.emails.whenShort.DECLARATION_HOLD_EXPIRED).toBeTruthy();
      expect(catalogue.Admin.emails.forecast.sends.holdLapsed).toBeTruthy();
    }
  });
});
