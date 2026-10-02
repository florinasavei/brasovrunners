import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesEventInvitations } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { renderBilingual } from "@/modules/notifications/templates";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import {
  confirmsInvitationRaises,
  INVITATION_REFUSALS,
  invitationDeadline,
  invitationForecastFree,
  invitationRaises,
  invitationState,
  parseInvitationLines,
  validInvitationDays,
} from "@/modules/registrations/domain/invitations";
import { eventInvitationsClause } from "@/modules/registrations/invitation-words";

const NOW = new Date("2026-10-02T10:00:00.000Z");
const DAY = 24 * 3_600_000;

describe("§NNN BR-REQ-034-01 the invitation's bucket in the one formula", () => {
  it("adds the invitations' held places, and a count without the bucket reads as none", () => {
    expect(computeOccupied({ confirmed: 2, pendingDeclarationHolds: 1, unexpiredWaitlistOfferedHolds: 1, familyReservations: 1, familyPlaceHolds: 1, invitationHolds: 3 })).toBe(9);
    expect(computeOccupied({ confirmed: 2, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0 })).toBe(2);
  });

  it("raises one supplementary place per invitation beyond the free places, none outside the places or uncapped", () => {
    expect(invitationRaises({ capacity: 150, occupied: 150, needed: 3 })).toBe(3);
    expect(invitationRaises({ capacity: 150, occupied: 148, needed: 3 })).toBe(1);
    expect(invitationRaises({ capacity: 150, occupied: 140, needed: 3 })).toBe(0);
    expect(invitationRaises({ capacity: 150, occupied: 150, needed: 0 })).toBe(0);
    expect(invitationRaises({ capacity: null, occupied: 999, needed: 3 })).toBe(0);
    // A count above the capacity (no path writes one) needs no more than the people invited.
    expect(invitationRaises({ capacity: 150, occupied: 152, needed: 2 })).toBe(2);
  });

  it("accepts exactly the capacity the question named, or no raise at all", () => {
    expect(confirmsInvitationRaises(150, 0, null)).toBe(true);
    expect(confirmsInvitationRaises(150, 2, 152)).toBe(true);
    expect(confirmsInvitationRaises(150, 2, 151)).toBe(false);
    expect(confirmsInvitationRaises(150, 2, 153)).toBe(false);
    expect(confirmsInvitationRaises(150, 1, null)).toBe(false);
  });

  it("forecasts the free places as the send will find them: the line served first while offers go by themselves", () => {
    expect(invitationForecastFree({ capacity: 10, occupied: 8, waiting: 1, offersNow: true })).toBe(1);
    expect(invitationForecastFree({ capacity: 10, occupied: 8, waiting: 1, offersNow: false })).toBe(2);
    expect(invitationForecastFree({ capacity: 10, occupied: 12, waiting: 0, offersNow: false })).toBe(0);
    expect(invitationForecastFree({ capacity: null, occupied: 0, waiting: 0, offersNow: true })).toBeNull();
  });
});

describe("§NNN the deadline and the state", () => {
  const STARTS = new Date(NOW.getTime() + 30 * DAY);
  it("is min(now + days, the close, the start), and none when that is not ahead", () => {
    expect(invitationDeadline({ now: NOW, days: 7, registrationClosesAt: null, startsAt: STARTS })).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(invitationDeadline({ now: NOW, days: 7, registrationClosesAt: new Date(NOW.getTime() + 2 * DAY), startsAt: STARTS })).toEqual(new Date(NOW.getTime() + 2 * DAY));
    expect(invitationDeadline({ now: NOW, days: 60, registrationClosesAt: null, startsAt: STARTS })).toEqual(STARTS);
    expect(invitationDeadline({ now: NOW, days: 7, registrationClosesAt: NOW, startsAt: STARTS })).toBeNull();
  });

  it("days are a whole number from 1 to 60", () => {
    expect([0, 1, 7, 60, 61, 1.5, Number.NaN].map(validInvitationDays)).toEqual([false, true, true, true, false, false, false]);
  });

  it("reads the stamps first, then the deadline", () => {
    const open = { acceptedAt: null, withdrawnAt: null, expiredAt: null, expiresAt: new Date(NOW.getTime() + DAY) };
    expect(invitationState(open, NOW)).toBe("sent");
    expect(invitationState(open, new Date(NOW.getTime() + DAY))).toBe("expired");
    expect(invitationState({ ...open, acceptedAt: NOW }, NOW)).toBe("accepted");
    expect(invitationState({ ...open, withdrawnAt: NOW }, NOW)).toBe("withdrawn");
    expect(invitationState({ ...open, expiredAt: NOW }, NOW)).toBe("expired");
  });
});

describe("§NNN «Nume <adresă>, una pe rând»", () => {
  it("reads a name and an address in the orders a person types them, and names the lines it cannot", () => {
    const parsed = parseInvitationLines(
      ["Ana Pop <ana@example.invalid>", "", "Bogdan Ionescu bogdan@example.invalid", "carmen@example.invalid Carmen Dobre", "Dan Pop, dan@example.invalid", "Fără adresă", "solo@example.invalid", "two@example.invalid three@example.invalid Pop"].join("\n"),
    );
    expect(parsed.people).toEqual([
      { name: "Ana Pop", email: "ana@example.invalid", line: 1 },
      { name: "Bogdan Ionescu", email: "bogdan@example.invalid", line: 3 },
      { name: "Carmen Dobre", email: "carmen@example.invalid", line: 4 },
      { name: "Dan Pop", email: "dan@example.invalid", line: 5 },
    ]);
    expect(parsed.unread).toEqual([6, 7, 8]);
  });
});

describe("§NNN the EVENT_INVITATION email", () => {
  const data = { participantName: "Ana Pop", eventTitle: "Crosul", eventStartsAtFormatted: "sâmbătă, 21 nov. 2026, 10:00", holdExpiresAtFormatted: "vineri, 9 octombrie 2026, la 10:00" };
  it("names the club, the event, the deadline, the button and «ignoră-l», in both languages", () => {
    const email = renderBilingual("EVENT_INVITATION", "ro", data, "https://example.test/ro/inregistrari/invitatie/SECRET");
    expect(email.subject).toContain("Invitație la Crosul");
    for (const words of ["Brașov Runners te invită la Crosul", "vineri, 9 octombrie 2026, la 10:00", "Acceptă invitația", "ignoră-l", "Accept the invitation", "ignore it"]) {
      expect(email.text).toContain(words);
    }
    // The privacy line says why a person who never registered received it.
    expect(email.text).toContain("ți-a trecut numele și adresa ca să te invite");
  });

  it("takes the links' road, and is no participant's message: no club copy, no «Nu mai pot ajunge»", () => {
    expect(EMAIL_GROUP_OF.EVENT_INVITATION).toBe("links");
    expect(isParticipantMessage("EVENT_INVITATION")).toBe(false);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.emails.types.EVENT_INVITATION).toBeTruthy();
      expect(catalogue.Admin.emails.when.EVENT_INVITATION).toBeTruthy();
      expect(catalogue.Admin.emails.whenShort.EVENT_INVITATION).toBeTruthy();
    }
  });
});

describe("§NNN BR-REQ-053-01 the privacy notice's sentence", () => {
  it("the template names {{eventInvitations}} once in each language, filled with the section's own name", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesEventInvitations(body)).toBe(true);
      expect(body.sections.flatMap((section) => section.paragraphs).filter((paragraph) => paragraph.includes("{{eventInvitations}}"))).toHaveLength(1);
    }
    expect(eventInvitationsClause("ro")).toBe(`„${ro.Admin.invitations.title}”`);
    expect(eventInvitationsClause("en")).toBe(`“${en.Admin.invitations.title}”`);
    expect(describesEventInvitations({ sections: [{ paragraphs: ["Nothing about invitations."] }] })).toBe(false);
  });

  it("every refusal of a send has its sentence, in both languages, under 200 characters", () => {
    for (const catalogue of [ro, en]) {
      const errors = catalogue.Admin.invitations.errors as Record<string, string>;
      for (const code of [...INVITATION_REFUSALS, "SUPPLEMENTARY_PLACE_UNCONFIRMED", "generic"]) {
        expect(errors[code], code).toBeTruthy();
        expect(errors[code].length, code).toBeLessThanOrEqual(200);
      }
    }
  });
});
