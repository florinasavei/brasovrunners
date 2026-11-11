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
  invitationFreePlaces,
  invitationRaises,
  invitationState,
  parseInvitationLines,
  readInviteeRows,
  resendDeadlineChoices,
  validInvitationDays,
} from "@/modules/registrations/domain/invitations";
import { eventInvitationsClause } from "@/modules/registrations/invitation-words";

const NOW = new Date("2026-10-02T10:00:00.000Z");
const DAY = 24 * 3_600_000;

describe("§647 BR-REQ-034-01 the invitation's bucket in the one formula", () => {
  it("adds the invitations' held places, and a count without the bucket reads as none", () => {
    expect(computeOccupied({ confirmed: 2, pendingDeclarationHolds: 1, unexpiredWaitlistOfferedHolds: 1, familyReservations: 1, familyPlaceHolds: 1, invitationHolds: 3 })).toBe(9);
    expect(computeOccupied({ confirmed: 2, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0 })).toBe(2);
  });

  it("raises one supplementary place per invitation beyond the free places, none outside the places or uncapped", () => {
    expect(invitationRaises({ capacity: 150, occupied: 150, waiting: 0, needed: 3 })).toBe(3);
    expect(invitationRaises({ capacity: 150, occupied: 148, waiting: 0, needed: 3 })).toBe(1);
    expect(invitationRaises({ capacity: 150, occupied: 140, waiting: 0, needed: 3 })).toBe(0);
    expect(invitationRaises({ capacity: 150, occupied: 150, waiting: 0, needed: 0 })).toBe(0);
    expect(invitationRaises({ capacity: null, occupied: 999, waiting: 4, needed: 3 })).toBe(0);
    // A count above the capacity (no path writes one) needs no more than the people invited.
    expect(invitationRaises({ capacity: 150, occupied: 152, waiting: 0, needed: 2 })).toBe(2);
  });

  it("never takes a free place somebody waits for: the waiting are subtracted before the invitations count", () => {
    expect(invitationRaises({ capacity: 150, occupied: 148, waiting: 1, needed: 3 })).toBe(2);
    expect(invitationRaises({ capacity: 150, occupied: 148, waiting: 2, needed: 3 })).toBe(3);
    expect(invitationRaises({ capacity: 150, occupied: 148, waiting: 9, needed: 1 })).toBe(1);
    expect(invitationFreePlaces({ capacity: 10, occupied: 8, waiting: 1 })).toBe(1);
    expect(invitationFreePlaces({ capacity: 10, occupied: 8, waiting: 5 })).toBe(0);
  });

  it("accepts exactly the capacity the question named, or no raise at all", () => {
    expect(confirmsInvitationRaises(150, 0, null)).toBe(true);
    expect(confirmsInvitationRaises(150, 2, 152)).toBe(true);
    expect(confirmsInvitationRaises(150, 2, 151)).toBe(false);
    expect(confirmsInvitationRaises(150, 2, 153)).toBe(false);
    expect(confirmsInvitationRaises(150, 1, null)).toBe(false);
  });

  it("forecasts the free places as the send will find them: the waiting always subtracted, offers on or off, before or after the close", () => {
    expect(invitationForecastFree({ capacity: 10, occupied: 8, waiting: 1 })).toBe(1);
    expect(invitationForecastFree({ capacity: 10, occupied: 8, waiting: 0 })).toBe(2);
    expect(invitationForecastFree({ capacity: 10, occupied: 12, waiting: 0 })).toBe(0);
    expect(invitationForecastFree({ capacity: null, occupied: 0, waiting: 3 })).toBeNull();
  });
});

describe("§647 the deadline and the state", () => {
  const STARTS = new Date(NOW.getTime() + 30 * DAY);
  it("is min(now + days, the start) — never capped by the close — and none when that is not ahead", () => {
    expect(invitationDeadline({ now: NOW, days: 7, startsAt: STARTS })).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(invitationDeadline({ now: NOW, days: 60, startsAt: STARTS })).toEqual(STARTS);
    expect(invitationDeadline({ now: NOW, days: 7, startsAt: NOW })).toBeNull();
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

describe("§647 «Nume <adresă>, una pe rând»", () => {
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

describe("§737 «Nume» and «Email», one row per person", () => {
  it("reads each row's name and address, skips an empty row, and names the rows it cannot read", () => {
    const rows = readInviteeRows(
      ["Ana  Pop", "", "Bogdan", "", "Carmen Dobre", "Dan Pop"],
      ["ana@example.invalid", "", "", "solo@example.invalid", "not an address", " dan@example.invalid "],
    );
    expect(rows.people).toEqual([
      { name: "Ana Pop", email: "ana@example.invalid", line: 1 },
      { name: "Dan Pop", email: "dan@example.invalid", line: 6 },
    ]);
    // A name with no address, an address with no name, an address that is not one.
    expect(rows.unread).toEqual([3, 4, 5]);
    expect(readInviteeRows([], [])).toEqual({ people: [], unread: [] });
  });

  it("«Locuri» (§925): a row's places, the person named alone when empty or 1; a box that is not a whole number from 1 names its row", () => {
    const rows = readInviteeRows(
      ["Ana Pop", "Dan Pop", "Ion Pop", "Eva Pop", "Rita Pop", "", "Mara Pop"],
      ["ana@example.invalid", "dan@example.invalid", "ion@example.invalid", "eva@example.invalid", "rita@example.invalid", "", "mara@example.invalid"],
      ["3", "", "0", "doi", " 1 ", "2", "-1"],
    );
    expect(rows.people).toEqual([
      { name: "Ana Pop", email: "ana@example.invalid", line: 1, places: 3 },
      { name: "Dan Pop", email: "dan@example.invalid", line: 2 },
      { name: "Rita Pop", email: "rita@example.invalid", line: 5 },
    ]);
    // An empty row stays ignored whatever its «Locuri» says; 0, a word and a sign name their rows.
    expect(rows.unread).toEqual([3, 4, 7]);
  });
});

describe("§647 the EVENT_INVITATION email", () => {
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

describe("§647 BR-REQ-053-01 the privacy notice's sentence", () => {
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

/**
 * «La retrimitere», the list beside «Retrimite» (the owner, 2026-11-10, of the bare box «Zile (opțional)»: «nu înțeleg
 * ce înseamnă asta»; `DECISIONS.md`, «La retrimitere»): which later deadlines the list offers, as a pure rule. The panel
 * drawn from a real database, and each line pressed against the server, are
 * `tests/integration/registrations/invitation-resend-list.test.ts`.
 */
describe("BR-REQ-037-07 the deadlines «La retrimitere» offers", () => {
  const ZONE = "Europe/Bucharest";
  const FAR = new Date(NOW.getTime() + 100 * DAY);
  const HOUR = 3_600_000;
  const daysOf = (choices: ReturnType<typeof resendDeadlineChoices>) => choices.map((choice) => choice.days);
  const dayIn = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

  it("offers each whole number of days from the draw that lands a day later than the deadline it has, never a later minute of the same day", () => {
    // Sent an hour ago with seven days: seven days from now is the same day, an hour later — not a choice.
    const expiresAt = new Date(NOW.getTime() + 7 * DAY - HOUR);
    const choices = resendDeadlineChoices({ drawnAt: NOW, expiresAt, startsAt: FAR, timeZone: ZONE });
    expect(daysOf(choices)).toEqual(Array.from({ length: 53 }, (_, index) => index + 8));
    expect(choices[0]).toEqual({ days: 8, deadline: new Date(NOW.getTime() + 8 * DAY), atStart: false });
    // Sixty days is the longest reach, and none of these is the start.
    expect(choices.at(-1)).toEqual({ days: 60, deadline: new Date(NOW.getTime() + 60 * DAY), atStart: false });
  });

  it("ends at the start, once, and leaves the start's own day to «la start»", () => {
    // The race at 16:00 on the 12th; the page drawn at 13:00: ten days on is the 12th at 13:00, three hours before the start.
    const startsAt = new Date(NOW.getTime() + 10 * DAY + 3 * HOUR);
    const choices = resendDeadlineChoices({ drawnAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY), startsAt, timeZone: ZONE });
    expect(daysOf(choices)).toEqual([8, 9, 11]);
    expect(choices.map((choice) => choice.atStart)).toEqual([false, false, true]);
    expect(choices.at(-1)?.deadline).toEqual(startsAt);
    // No two lines on one day.
    expect(new Set(choices.map((choice) => dayIn(choice.deadline))).size).toBe(choices.length);
  });

  it("keeps the start's own day as a line of its own when sixty days end there, short of the start", () => {
    // Sixty days from the draw is the start's day, an hour before it: no reach lands on the start, so that day is not «la start»'s.
    const startsAt = new Date(NOW.getTime() + 60 * DAY + HOUR);
    const choices = resendDeadlineChoices({ drawnAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY), startsAt, timeZone: ZONE });
    expect(choices.at(-1)).toEqual({ days: 60, deadline: new Date(NOW.getTime() + 60 * DAY), atStart: false });
    expect(choices.some((choice) => choice.atStart)).toBe(false);
  });

  it("leaves the start's own day to «la start» at the sixty days' edge too: the fifty-ninth reach on that day is no line when the sixtieth is the start", () => {
    // The race fifty-nine days and three hours away: fifty-nine days on is its own day, three hours before the start.
    const startsAt = new Date(NOW.getTime() + 59 * DAY + 3 * HOUR);
    const choices = resendDeadlineChoices({ drawnAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY), startsAt, timeZone: ZONE });
    expect(daysOf(choices).slice(-2)).toEqual([58, 60]);
    expect(choices.at(-1)).toEqual({ days: 60, deadline: startsAt, atStart: true });
    // The start exactly sixty days on, at the end of the Sunday of twenty-five hours: the fifty-ninth reach is that Sunday at 00:30.
    const sunday = new Date("2026-10-25T21:30:00.000Z");
    const exact = resendDeadlineChoices({ drawnAt: new Date(sunday.getTime() - 60 * DAY), expiresAt: new Date(sunday.getTime() - 53 * DAY), startsAt: sunday, timeZone: ZONE });
    expect(daysOf(exact).slice(-2)).toEqual([58, 60]);
    expect(exact.at(-1)).toEqual({ days: 60, deadline: sunday, atStart: true });
  });

  it("offers the start even on the deadline's own day — «la start» is a deadline of its own — and nothing once the deadline is the start", () => {
    const startsAt = new Date(NOW.getTime() + 3 * DAY);
    const twoHoursBefore = new Date(startsAt.getTime() - 2 * HOUR);
    expect(resendDeadlineChoices({ drawnAt: NOW, expiresAt: twoHoursBefore, startsAt, timeZone: ZONE })).toEqual([{ days: 3, deadline: startsAt, atStart: true }]);
    expect(resendDeadlineChoices({ drawnAt: NOW, expiresAt: startsAt, startsAt, timeZone: ZONE })).toEqual([]);
  });

  it("offers nothing once the event has started", () => {
    const expiresAt = new Date(NOW.getTime() - DAY);
    expect(resendDeadlineChoices({ drawnAt: NOW, expiresAt, startsAt: new Date(NOW.getTime() - 60_000), timeZone: ZONE })).toEqual([]);
    expect(resendDeadlineChoices({ drawnAt: NOW, expiresAt, startsAt: NOW, timeZone: ZONE })).toEqual([]);
  });

  it("reads «a later day» on the event's own clock, not on UTC's", () => {
    // 23:30 on the 9th in Brașov; a week from 00:30 on the 3rd is 00:30 on the 10th there — the 9th still, by UTC.
    const expiresAt = new Date("2026-10-09T20:30:00.000Z");
    const drawnAt = new Date("2026-10-02T21:30:00.000Z");
    expect(daysOf(resendDeadlineChoices({ drawnAt, expiresAt, startsAt: FAR, timeZone: ZONE }))[0]).toBe(7);
    // Read on UTC's clock both instants are the 9th: seven days is no later day there, and eight is the first.
    expect(daysOf(resendDeadlineChoices({ drawnAt, expiresAt, startsAt: FAR, timeZone: "UTC" }))[0]).toBe(8);
    // The deadline's own day is read there too: 00:30 on the 10th in Brașov is the 9th still by UTC. Seven days from
    // 10:00 on the 3rd is that same 10th, later in the day — no choice, though by UTC it would be a later day.
    expect(daysOf(resendDeadlineChoices({ drawnAt: new Date("2026-10-03T07:00:00.000Z"), expiresAt: new Date("2026-10-09T21:30:00.000Z"), startsAt: FAR, timeZone: ZONE }))[0]).toBe(8);
  });

  it("leaves the start's own day to «la start» on the event's clock too, for a start just after midnight", () => {
    // The race at 00:30 on Sunday the 22nd in Brașov — Saturday still, by UTC. Drawn at 00:10: eleven days on is that Sunday at 00:10.
    const startsAt = new Date("2026-11-21T22:30:00.000Z");
    const choices = resendDeadlineChoices({ drawnAt: new Date("2026-11-10T22:10:00.000Z"), expiresAt: new Date("2026-11-17T08:00:00.000Z"), startsAt, timeZone: ZONE });
    expect(daysOf(choices)).toEqual([7, 8, 9, 10, 12]);
    expect(choices.at(-1)).toEqual({ days: 12, deadline: startsAt, atStart: true });
  });

  it("compares days across a New Year: January is later than December", () => {
    const choices = resendDeadlineChoices({ drawnAt: new Date("2026-12-20T08:00:00.000Z"), expiresAt: new Date("2026-12-27T08:00:00.000Z"), startsAt: new Date("2027-03-01T08:00:00.000Z"), timeZone: ZONE });
    // 28 December to 18 February, every day once.
    expect(daysOf(choices)).toEqual(Array.from({ length: 53 }, (_, index) => index + 8));
  });

  it("writes one line a day on the nights the clocks change: never two reaches on one day", () => {
    // Monday 19 Oct 2026, 00:30: six days on is Sunday the 25th at 00:30, and seven — the clocks went back — Sunday still, at 23:30.
    const autumn = resendDeadlineChoices({ drawnAt: new Date("2026-10-18T21:30:00.000Z"), expiresAt: new Date("2026-10-19T10:00:00.000Z"), startsAt: new Date("2027-01-10T08:00:00.000Z"), timeZone: ZONE });
    expect(daysOf(autumn).slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(new Set(autumn.map((choice) => dayIn(choice.deadline))).size).toBe(autumn.length);
    // The race that same Sunday at 23:30 — exactly one more day's reach after 00:30: the day is «la start»'s alone.
    const sunday = resendDeadlineChoices({ drawnAt: new Date("2026-10-18T21:30:00.000Z"), expiresAt: new Date("2026-10-19T10:00:00.000Z"), startsAt: new Date("2026-10-25T21:30:00.000Z"), timeZone: ZONE });
    expect(daysOf(sunday)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(sunday.at(-1)?.atStart).toBe(true);
    // A quarter of an hour later, at 23:45, two reaches land on that Sunday before the start — 00:30 and 23:30: neither
    // is a line, the day is still «la start»'s alone.
    const later = resendDeadlineChoices({ drawnAt: new Date("2026-10-18T21:30:00.000Z"), expiresAt: new Date("2026-10-19T10:00:00.000Z"), startsAt: new Date("2026-10-25T21:45:00.000Z"), timeZone: ZONE });
    expect(daysOf(later)).toEqual([1, 2, 3, 4, 5, 8]);
    expect(later.at(-1)).toEqual({ days: 8, deadline: new Date("2026-10-25T21:45:00.000Z"), atStart: true });
    expect(new Set(later.map((choice) => dayIn(choice.deadline))).size).toBe(later.length);
    // Saturday 20 Mar 2027, 23:30: eight days on is Monday the 29th at 00:30 — the clocks went forward — and no day is written twice.
    const spring = resendDeadlineChoices({ drawnAt: new Date("2027-03-20T21:30:00.000Z"), expiresAt: new Date("2027-03-21T10:00:00.000Z"), startsAt: new Date("2027-06-10T08:00:00.000Z"), timeZone: ZONE });
    expect(new Set(spring.map((choice) => dayIn(choice.deadline))).size).toBe(spring.length);
    expect(daysOf(spring)).toEqual([...daysOf(spring)].sort((a, b) => a - b));
  });

  it("is the server's own arithmetic from the draw: every choice later than the deadline it replaces, never past the start, at most one of them the start and it the last", () => {
    const startsAt = new Date(NOW.getTime() + 20 * DAY + 5 * HOUR);
    for (const sentDaysAgo of [0, 1, 3, 6]) {
      const expiresAt = new Date(NOW.getTime() + (7 - sentDaysAgo) * DAY);
      const choices = resendDeadlineChoices({ drawnAt: NOW, expiresAt, startsAt, timeZone: ZONE });
      expect(choices.length).toBeGreaterThan(0);
      expect(daysOf(choices)).toEqual([...new Set(daysOf(choices))].sort((a, b) => a - b));
      expect(choices.filter((choice) => choice.atStart)).toHaveLength(1);
      expect(choices.at(-1)?.atStart).toBe(true);
      expect(new Set(choices.map((choice) => dayIn(choice.deadline))).size).toBe(choices.length);
      for (const choice of choices) {
        expect(validInvitationDays(choice.days)).toBe(true);
        expect(choice.deadline).toEqual(invitationDeadline({ now: NOW, days: choice.days, startsAt }));
        expect(choice.deadline.getTime()).toBeGreaterThan(expiresAt.getTime());
        expect(choice.deadline.getTime()).toBeLessThanOrEqual(startsAt.getTime());
        expect(choice.atStart || dayIn(choice.deadline) > dayIn(expiresAt)).toBe(true);
      }
    }
  });

  it("has its words in both languages: the list's name, its resting line, a line by its moment, the start — and the bare box's are gone", () => {
    expect(ro.Admin.invitations.resendWhen).toBe("La retrimitere");
    expect(ro.Admin.invitations.resendKeep).toBe("Termenul rămâne");
    expect(ro.Admin.invitations.resendMove).toBe("Termen nou: {moment}");
    expect(ro.Admin.invitations.resendMoveStart).toBe("Termen nou: la start, {moment}");
    expect(en.Admin.invitations.resendWhen).toBe("On resend");
    expect(en.Admin.invitations.resendKeep).toBe("The deadline stays");
    expect(en.Admin.invitations.resendMove).toBe("New deadline: {moment}");
    expect(en.Admin.invitations.resendMoveStart).toBe("New deadline: the start, {moment}");
    for (const catalogue of [ro, en]) {
      const words = catalogue.Admin.invitations as Record<string, unknown>;
      expect(words.resendDays).toBeUndefined();
      // Each question names what it fills in: the person always, then the deadline kept, or the chosen line's own words where the days are posted.
      expect(words.resendBodyKept).toMatch(/^\{name\} .*: \{deadline\}\.$/);
      expect(words.resendBody).toMatch(/^\{name\} .*\. \{days\}\.$/);
      expect(words.resendBodyStart).toBeUndefined();
      expect(JSON.stringify(words)).not.toMatch(/Zile \(opțional\)|Days \(optional\)|scrie numărul de zile|type a number of days|zile de acum|days from now/);
      // The guide tells the same story, by the screen's own words, and says when there is no list.
      const step = catalogue.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps)).filter((text) => text.includes(`«${words.resendWhen}»`));
      expect(step).toHaveLength(1);
      expect(step[0]).toContain(`«${words.resendKeep}»`);
    }
    // The step whole, in both languages: which way the deadline moves, and when there is no list.
    expect(ro.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps))).toContain(
      "Pe rândul invitației: «Retrimite» trimite un link nou. Lista «La retrimitere» stă pe «Termenul rămâne»; ca să muți termenul mai târziu, alege din ea ziua nouă. Lista «La retrimitere» lipsește când termenul nu mai poate fi mutat: e deja cel mai târziu posibil, la start; sau invitația ocupă un loc și cineva e pe lista de așteptare — la un invitat special lista apare chiar dacă cineva așteaptă. «Retrage» închide invitația și eliberează locul.",
    );
    expect(en.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps))).toContain(
      "On the invitation's row: «Resend» sends a new link. The «On resend» list rests on «The deadline stays»; to move the deadline later, choose the new day in it. The «On resend» list is missing when the deadline cannot be moved: it is already as late as it can be, at the start; or the invitation takes a place and someone is on the waiting list — for a special guest the list is shown even while someone waits. «Withdraw» closes the invitation and frees the place.",
    );
    // What the page is told after the press, in both languages: resent; the chosen deadline not applied for somebody waiting, or because it
    // was moved later meanwhile — and where the deadline in force is read, which is the one the email carries.
    expect(ro.Feedback.toast.invitationResent).toBe("Invitație retrimisă, cu un link nou.");
    expect(ro.Feedback.toast.invitationResentKept).toBe("Invitație retrimisă, cu un link nou. Termenul ales nu s-a aplicat: cineva așteaptă pe lista de așteptare. Termenul valabil, cel din email, e pe rândul invitației.");
    expect(ro.Feedback.toast.invitationResentAlreadyLater).toBe("Invitație retrimisă, cu un link nou. Termenul ales nu s-a aplicat: între timp, termenul a fost mutat mai târziu de altcineva sau din altă filă. Termenul valabil, cel din email, e pe rândul invitației.");
    expect(en.Feedback.toast.invitationResent).toBe("Invitation resent, with a new link.");
    expect(en.Feedback.toast.invitationResentKept).toBe("Invitation resent, with a new link. The deadline you chose was not applied: someone is on the waiting list. The one in force, as in the email, is on its row.");
    expect(en.Feedback.toast.invitationResentAlreadyLater).toBe("Invitation resent, with a new link. The deadline you chose was not applied: meanwhile someone else, or another tab, moved the deadline later. The one in force, as in the email, is on its row.");
  });
});
