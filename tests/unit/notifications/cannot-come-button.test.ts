import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { CANNOT_COME_MESSAGES, cannotComeApplies, cannotComeUrlOf } from "@/modules/notifications/domain/cannot-come";
import { emailSampleActionUrl, emailSampleFamilyConfirmed, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { buildTemplateContent, renderBilingual } from "@/modules/notifications/templates";

/**
 * §558 — «Nu mai pot ajunge» / "I can't make it any more" on every email about a live registration,
 * and on no other (BR-REQ-080-01, BR-REQ-036-01; the owner, 2026-09-29: «în fiecare mail trebuie să
 * fie clar butonul de „Nu mai pot ajunge”»). The table names every message type, with the decision's
 * reason, so a type added later fails here until somebody decides.
 */
const EVERY_MESSAGE: Record<EmailMessageType, { button: boolean; why: string }> = {
  VERIFY_REGISTRATION_EMAIL: { button: true, why: "the address to confirm: a place is held" },
  COMPLETE_DECLARATION: { button: true, why: "the declaration to sign, or the participation confirmation" },
  WAITLIST_JOINED: { button: true, why: "on the waiting list: leaving it is the same cancel" },
  WAITLIST_SPOT_OFFER: { button: true, why: "a freed place offered" },
  REGISTRATION_CONFIRMED: { button: true, why: "the confirmation, one person's or a family's" },
  REGISTRATION_CANCELLED: { button: false, why: "after the fact" },
  WAITLIST_OFFER_EXPIRED: { button: true, why: "back on the waiting list" },
  REGISTRATION_MANAGE_LINK: { button: true, why: "the manage link" },
  PROFILE_MANAGE_LINK: { button: false, why: "«Înscrierile mele»: its button lists every person's cancel" },
  REGISTRATION_STATE_NOTICE: { button: false, why: "the resend for a cancelled or expired registration, no token (AGENTS.md §16.3)" },
  EVENT_REMINDER: { button: true, why: "the reminder: its one button" },
  EVENT_THANKS: { button: false, why: "after the fact" },
  DECLARATION_SIGNED: { button: true, why: "the signed declaration of a confirmed registration" },
  DECLARATION_ARCHIVE: { button: false, why: "the club's archive" },
  BIB_ASSIGNED: { button: true, why: "the number given by hand" },
  STAFF_INVITATION: { button: false, why: "no registration" },
  REGISTRATION_OPENED: { button: false, why: "«Anunță-mă»: no registration" },
  CLUB_CONFIRMATION_NOTICE: { button: false, why: "the club's notice" },
  EVENT_UPDATE_NOTICE: { button: true, why: "the organizer's update notice (amending §419)" },
  EVENT_CANCELLED: { button: false, why: "after the fact: the event will not run" },
  ORGANIZER_MESSAGE: { button: true, why: "the organizer's message" },
  GROUP_RUN_DECLARATION_SIGNED: { button: false, why: "a declaration that registers nobody" },
  GROUP_RUN_DECLARATION_ARCHIVE: { button: false, why: "the club's archive" },
  // On the family sitting's shape only (§558): the sample is the kept form's, which carries none — see below.
  REGISTER_ANOTHER_PERSON: { button: true, why: "the family sitting's message: «Toate înscrierile mele» lists the address's people" },
  NEWSLETTER_CONFIRM: { button: false, why: "the newsletter" },
  NEWSLETTER: { button: false, why: "the newsletter" },
  NEW_EVENT_ALERT: { button: false, why: "the newsletter" },
  MEMBER_INVITATION: { button: false, why: "no registration" },
  // A held place that lapsed (§NNN): the registration is over; its button is the form, not a cancel.
  DECLARATION_HOLD_EXPIRED: { button: false, why: "after the fact: the place went to somebody else" },
  // To the Administrators about the club's legal texts (§NNN).
  LEGAL_TEMPLATES_CHANGED: { button: false, why: "no registration" },
};

const TYPES = Object.keys(EVERY_MESSAGE) as EmailMessageType[];
const LINK = "https://example.test/ro/inregistrari/gestionare/SECRET#cancel";

function rendered(messageType: EmailMessageType, extra: Record<string, unknown> = {}) {
  const data = { ...emailSampleFor(messageType, "ro"), cannotComeUrl: LINK, ...extra };
  return renderBilingual(messageType, "ro", data, emailSampleActionUrl("ro"));
}

describe("§558 the «Nu mai pot ajunge» button, message type by message type", () => {
  it("the table names every message type, and the platform's list is exactly its «yes» rows", () => {
    expect([...TYPES].sort()).toEqual([...emailMessageType.enumValues].sort());
    expect([...CANNOT_COME_MESSAGES].sort()).toEqual(TYPES.filter((type) => EVERY_MESSAGE[type].button).sort());
  });

  it.each(TYPES)("%s", (messageType) => {
    const { html, text } = rendered(messageType);
    // The family link's sample is the kept form (§446), which never carries it; its sitting shape is tested below.
    const expected = EVERY_MESSAGE[messageType].button && messageType !== "REGISTER_ANOTHER_PERSON";
    // Both halves, or neither.
    expect(html.match(/data-email-part="cannot-come"/g)?.length ?? 0, EVERY_MESSAGE[messageType].why).toBe(expected ? 2 : 0);
    expect(text.includes(`Nu mai pot ajunge: ${LINK}`)).toBe(expected);
    expect(text.includes(`I can't make it any more: ${LINK}`)).toBe(expected);
    if (expected) {
      expect(text).toContain("Locul se eliberează pentru altcineva.");
      expect(text).toContain("Your place goes to someone else.");
      // The glyph before the words, decorative: a client that blocks pictures shows the words alone.
      expect(html).toContain('/brand/email-cannot-come.png" alt=""');
    }
  });

  it("is under the message's own button, or the one button of the reminder", () => {
    const confirmed = rendered("REGISTRATION_CONFIRMED").html;
    expect(confirmed.indexOf('data-email-part="cannot-come"')).toBeGreaterThan(confirmed.indexOf("Vezi înscrierea"));
    const reminder = buildTemplateContent("EVENT_REMINDER", "ro", { ...emailSampleFor("EVENT_REMINDER", "ro"), cannotComeUrl: LINK }, emailSampleActionUrl("ro"));
    expect(reminder.action).toBeUndefined();
    expect(reminder.cannotCome).toEqual({ label: "Nu mai pot ajunge", url: LINK, note: "Locul se eliberează pentru altcineva." });
    // One cancel per message: the old line under the button is gone.
    expect(rendered("REGISTRATION_CONFIRMED").text).not.toContain("Nu mai pot veni — anulez înscrierea");
    expect(rendered("BIB_ASSIGNED").text).not.toContain("Nu mai pot veni");
  });

  it("on a family's one confirmation too, whose page lists every person", () => {
    const { html } = rendered("REGISTRATION_CONFIRMED", { familyConfirmed: emailSampleFamilyConfirmed() });
    expect(html.match(/data-email-part="cannot-come"/g)).toHaveLength(2);
  });

  it("on the family link only in the family sitting's shape — never beside «Nu înscriu această persoană», at the limit or once the form is gone", () => {
    const shapes: Record<string, Record<string, unknown>> = {
      keptForm: {},
      atCap: { addressAtCap: true },
      gone: { familyEntryGone: true },
    };
    for (const [shape, extra] of Object.entries(shapes)) {
      const { html, text } = rendered("REGISTER_ANOTHER_PERSON", extra);
      expect(html.includes('data-email-part="cannot-come"'), shape).toBe(false);
      expect(text.includes("Nu mai pot ajunge"), shape).toBe(false);
    }
    const sitting = rendered("REGISTER_ANOTHER_PERSON", {
      familySittingPeople: [
        { name: "Ana Pop", birthDate: "2010-05-01" },
        { name: "Ion Pop", birthDate: "2012-07-02" },
      ],
    });
    expect(sitting.html.match(/data-email-part="cannot-come"/g)).toHaveLength(2);
  });

  it("the reminder's words name no link below: the button and its sentence carry it, and a late send has neither", () => {
    const without = buildTemplateContent("EVENT_REMINDER", "ro", { ...emailSampleFor("EVENT_REMINDER", "ro"), cannotComeUrl: undefined }, emailSampleActionUrl("ro"));
    expect(without.cannotCome).toBeUndefined();
    expect(JSON.stringify(without.paragraphs)).not.toContain("linkul de mai jos");
    const withIt = buildTemplateContent("EVENT_REMINDER", "en", { ...emailSampleFor("EVENT_REMINDER", "en"), cannotComeUrl: LINK }, emailSampleActionUrl("en"));
    expect(JSON.stringify(withIt.paragraphs)).not.toContain("link below");
    expect(withIt.cannotCome?.url).toBe(LINK);
  });

  it("is a full-width button of at least 44 pixels (BR-REQ-041-01 criterion 6)", () => {
    const { html } = rendered("EVENT_REMINDER");
    const anchor = /<div data-email-part="cannot-come"[^>]*><a href="[^"]+" style="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(anchor).toContain("display:block");
    expect(anchor).toContain("width:100%");
    // 20 px of line and 14 px of padding above and below, inside a 2 px border: 52 px.
    expect(anchor).toContain("line-height:20px");
    expect(anchor).toContain("padding:14px 16px");
  });
});

describe("§558 never in the club's copy (§320)", () => {
  it.each([...CANNOT_COME_MESSAGES])("%s", (messageType) => {
    const { html, text } = rendered(messageType, { clubCopy: true });
    expect(html).not.toContain('data-email-part="cannot-come"');
    expect(text).not.toContain("Nu mai pot ajunge: ");
    expect(text).not.toContain("Locul se eliberează pentru altcineva.");
    expect(text).not.toContain("#cancel");
  });
});

describe("§558 when a send carries it", () => {
  const live = { participantId: "p1", status: "CONFIRMED" as const };
  const ahead = { startsAt: new Date("2026-10-11T07:00:00Z"), eventStatus: "SCHEDULED" };
  const now = new Date("2026-10-01T07:00:00Z");
  const base = { messageType: "ORGANIZER_MESSAGE" as const, clubCopy: false, recipientParticipantId: "p1", registration: live, event: ahead, now };

  it("a live registration at its own address, before the start of an event that will run", () => {
    expect(cannotComeApplies(base)).toBe(true);
    for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED"] as const) {
      expect(cannotComeApplies({ ...base, registration: { ...live, status } }), status).toBe(true);
    }
  });

  it("not on a club copy, another address, a registration no longer active, after the start or on an event that will not run", () => {
    expect(cannotComeApplies({ ...base, clubCopy: true })).toBe(false);
    expect(cannotComeApplies({ ...base, recipientParticipantId: "p2" })).toBe(false);
    expect(cannotComeApplies({ ...base, recipientParticipantId: null })).toBe(false);
    expect(cannotComeApplies({ ...base, registration: null })).toBe(false);
    for (const status of ["CANCELLED", "EXPIRED"] as const) {
      expect(cannotComeApplies({ ...base, registration: { ...live, status } }), status).toBe(false);
    }
    expect(cannotComeApplies({ ...base, now: ahead.startsAt })).toBe(false);
    expect(cannotComeApplies({ ...base, event: { ...ahead, eventStatus: "CANCELLED" } })).toBe(false);
    expect(cannotComeApplies({ ...base, event: { ...ahead, eventStatus: "COMPLETED" } })).toBe(false);
    expect(cannotComeApplies({ ...base, messageType: "EVENT_THANKS" })).toBe(false);
  });

  it("lands on the manage page's own person's cancel", () => {
    expect(cannotComeUrlOf("https://example.test/ro/inregistrari/gestionare/SECRET")).toBe(LINK);
  });
});
