import UnsubscribeIcon from "@mui/icons-material/Unsubscribe";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { EMAIL_AUDIENCE } from "@/modules/notifications/domain/email-audience";
import { clubMailboxesToFix, groupClubMailboxRejections, type ClubRejectionInput } from "@/modules/notifications/domain/club-mailbox-rejections";
import { REJECTION_CAUSES, type RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import type { OutboxHistoryRow } from "@/modules/registrations/admin-repository";
import { EMAIL_STATE_KINDS, isDeskQrMessage, needsEmailAction } from "@/modules/registrations/domain/email-state";
import EmailStateLine from "@/modules/registrations/ui/EmailStateLine";
import { emailHistoryWords, isClubRow } from "@/modules/registrations/ui/email-history-words";
import {
  causeLabel,
  lineDay,
  rejectedEmailWords,
  type RejectedEmailFacts,
  type RejectedEmailReader,
  resendWarning,
  shortDay,
  unbreakableLine,
  withResendWarning,
} from "@/modules/registrations/ui/rejected-email-words";

/**
 * §NNN (amending §663, §650; the data decision „The runners' own emails tell the truth”) — «Email respins» drawn where the club looks, phone
 * first: one line under the name on the list (BR-REQ-038-01), the to-do by who reads it, the resend
 * questions' first sentence (BR-REQ-037-02), the desk's one QR chip (§67), the registration's «Emailuri»
 * (BR-REQ-037-01) and the club's own mailboxes.
 */
const catalogues = { ro, en } as const;
const READERS: readonly RejectedEmailReader[] = ["administrator", "organizer", "desk"];
const REJECTED_AT = new Date("2026-10-03T09:15:00.000Z");
const LATER = new Date("2026-10-05T10:00:00.000Z");
const NBSP = " ";
const fill = (text: string, values: Record<string, string>) => Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), text);

function facts(overrides: Partial<RejectedEmailFacts> = {}): RejectedEmailFacts {
  return {
    kind: "unreachable",
    messageType: "REGISTRATION_CONFIRMED",
    at: REJECTED_AT,
    atKnown: true,
    sent: true,
    status: "BOUNCED",
    cause: "no-such-address",
    own: true,
    press: "confirmation",
    laterDeliveredAt: null,
    retriedAt: null,
    retriedVia: null,
    emailConfirmedAt: null,
    ...overrides,
  };
}

describe("the words by cause and by reader (§NNN)", () => {
  for (const locale of ["ro", "en"] as const) {
    const words = catalogues[locale].Admin.registrations.rejected;

    it(`labels every cause in at most four words, the brief's own in Romanian (${locale})`, () => {
      for (const cause of REJECTION_CAUSES) expect(causeLabel(cause, locale).split(/\s+/).length, cause).toBeLessThanOrEqual(4);
      expect(words.label.noLonger.split(/\s+/).length).toBeLessThanOrEqual(4);
      if (locale === "ro") {
        expect(Object.fromEntries(REJECTION_CAUSES.map((cause) => [cause, causeLabel(cause, "ro")]))).toEqual({
          "no-such-address": "Adresa nu există",
          "mailbox-full": "Căsuța e plină",
          blocked: "Blocat la destinatar",
          "gave-up": "Eșuat temporar",
          refused: "Refuzat definitiv",
          suppressed: "Mailgun nu mai trimite",
          unsubscribed: "S-a dezabonat",
          complained: "Marcat ca spam",
          "complaint-suppressed": "Oprit: marcat ca spam",
          account: "Nu a plecat",
          other: "Motiv necunoscut",
        });
        expect(words.label.noLonger).toBe("Adresa nu mai există");
      }
    });

    it(`says «Adresa nu mai există» only when the address answered the person's own click before the refusal (${locale})`, () => {
      const clicked = new Date("2026-10-01T08:00:00.000Z");
      const said = rejectedEmailWords(facts({ emailVerifiedAt: clicked }), locale, "administrator");
      expect(said.label).toBe(words.label.noLonger);
      expect(said.why).toBe(fill(words.why.noLonger, { date: shortDay(clicked, locale) }));
      // Clicked after the refusal, or never, or another cause: the plain label.
      expect(rejectedEmailWords(facts({ emailVerifiedAt: LATER }), locale, "administrator").label).toBe(words.label["no-such-address"]);
      expect(rejectedEmailWords(facts({ emailVerifiedAt: null }), locale, "administrator").label).toBe(words.label["no-such-address"]);
      expect(rejectedEmailWords(facts({ emailVerifiedAt: clicked, cause: "mailbox-full" }), locale, "administrator").label).toBe(words.label["mailbox-full"]);
      // Staff confirming the address is not the person's click: `emailConfirmedAt` alone never says «nu mai».
      expect(rejectedEmailWords(facts({ emailConfirmedAt: clicked }), locale, "administrator").label).toBe(words.label["no-such-address"]);
    });

    it(`gives every cause × reader × own × confirmed × press its words, every sentence under 200 characters (${locale})`, () => {
      let combinations = 0;
      for (const cause of REJECTION_CAUSES) {
        for (const reader of READERS) {
          for (const own of [true, false]) {
            for (const confirmed of [true, false]) {
              for (const press of ["confirmation", "reminder", "resend", null] as const) {
                combinations += 1;
                const label = JSON.stringify({ cause, reader, own, confirmed, press });
                const said = rejectedEmailWords(facts({ cause, own, confirmed, press, status: cause === "complained" ? "COMPLAINED" : "BOUNCED" }), locale, reader);
                for (const sentence of [said.which, said.why, said.context, said.label, said.line]) expect(sentence.length, label).toBeLessThan(200);
                // The to-do is a few catalogue sentences, each one under 200.
                for (const sentence of said.todo.split(/(?<=[.!?])\s+(?=\p{Lu})/u)) expect(sentence.length, `${label}: ${sentence}`).toBeLessThan(200);
                // The Administrator is told the press by its name; nobody else is; the desk never phones.
                if (reader !== "administrator") for (const text of Object.values(words.todoPress)) expect(said.todo, label).not.toContain(text);
                if (reader === "desk") {
                  expect(said.todo, label).toMatch(locale === "ro" ? /^Spune-i persoanei/ : /^Tell the person/);
                  expect(said.todo, label).not.toContain(words.placeKept);
                }
                // A suppression is lifted only when the person confirms the address; an unsubscription only when they ask.
                if (cause === "suppressed" && reader !== "desk") expect(said.todo, label).toContain(words.todoCause.suppressed);
                if (cause === "unsubscribed" && reader !== "desk") expect(said.todo, label).toContain(words.todoCause.unsubscribed);
                // A full mailbox: make room, then the press that clears it.
                if (cause === "mailbox-full" && reader !== "desk") {
                  expect(said.todo, label).toContain(words.todoCause["mailbox-full"]);
                  if (press) expect(said.todo, label).toContain(reader === "administrator" ? words.todoPress[press] : words.todoAskAdmin[press]);
                }
                // Not necessarily the address: wait, then send again.
                if (["blocked", "gave-up", "refused", "other"].includes(cause) && reader !== "desk") expect(said.todo, label).toContain(words.todoCause.retryLater);
                // A family member's press is on that person's registration.
                if (!own && press && reader !== "desk" && ["mailbox-full", "blocked", "suppressed"].includes(cause)) expect(said.todo, label).toContain(fill(words.todoFamily, { todo: "" }).trim());
              }
            }
          }
        }
      }
      expect(combinations).toBe(REJECTION_CAUSES.length * READERS.length * 2 * 2 * 4);
    });
  }
});

describe("the line under the name (§NNN)", () => {
  for (const locale of ["ro", "en"] as const) {
    const words = catalogues[locale].Admin.registrations.rejected;
    const short = catalogues[locale].Admin.emails.typesShort;
    const day = lineDay(REJECTED_AT, locale);

    it(`writes the line's day as the day and the month alone — no weekday, no year, no hour — in club time (${locale})`, () => {
      // §452's short style without its weekday: the weekday took the longest usual line to two lines at 400 px.
      const sentence = formatDay(REJECTED_AT, { locale, timeZone: "Europe/Bucharest", style: "short", year: false, position: "inline" });
      expect(sentence.endsWith(day)).toBe(true);
      expect(day).toBe(locale === "ro" ? "3 oct." : "3 Oct");
      expect(day).not.toMatch(/2026|:|,/);
      // Club time: 23:30 UTC on 2 October is already 3 October in Brașov.
      expect(lineDay(new Date("2026-10-02T23:30:00.000Z"), locale)).toBe(day);
    });

    it(`says the address's refusal in red: cause · email · day, each part unbreakable (${locale})`, () => {
      const said = rejectedEmailWords(facts({ cause: "mailbox-full" }), locale, "administrator");
      expect(said.tone).toBe("error");
      expect(said.line).toBe(unbreakableLine(`${words.label["mailbox-full"]} · ${short.REGISTRATION_CONFIRMED} · ${day}`));
      // The line breaks only between parts.
      for (const part of said.line.split(" · ")) expect(part).not.toContain(" ");
      expect(said.line.split(" · ")).toHaveLength(3);
      expect(said.line).toContain(NBSP);
    });

    it(`says an email owed to an address that works again in amber, and one that never left (${locale})`, () => {
      const missing = rejectedEmailWords(facts({ kind: "missing", laterDeliveredAt: LATER }), locale, "administrator");
      expect(missing.tone).toBe("warning");
      expect(missing.line).toBe(unbreakableLine(fill(words.line.missing, { short: short.REGISTRATION_CONFIRMED })));
      const notSent = rejectedEmailWords(facts({ kind: "not-sent", sent: false, cause: "account", messageType: "BIB_ASSIGNED" }), locale, "administrator");
      expect(notSent.tone).toBe("warning");
      expect(notSent.line).toBe(unbreakableLine(`${words.label.account} · ${short.BIB_ASSIGNED} · ${day}`));
    });

    it(`says an email sent again quietly, by its road — and the list draws nothing for it (${locale})`, () => {
      const mailgun = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "mailgun" }), locale, "administrator");
      expect(mailgun.tone).toBe("info");
      expect(mailgun.line).toBe(unbreakableLine(fill(words.line.retried, { date: shortDay(LATER, locale) })));
      const gmail = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "gmail" }), locale, "administrator");
      expect(gmail.line).toBe(unbreakableLine(fill(words.line.retriedGmail, { date: shortDay(LATER, locale) })));
      // The list draws a line only for a state that asks somebody to act.
      expect(needsEmailAction({ kind: "retried" })).toBe(false);
      for (const kind of EMAIL_STATE_KINDS) expect(needsEmailAction({ kind }), kind).toBe(kind !== "retried");
    });

    it(`keeps every short name under four words and names every participant's email (${locale})`, () => {
      const participantTypes = Object.entries(EMAIL_AUDIENCE).filter(([, audience]) => audience === "participant").map(([type]) => type);
      for (const type of participantTypes) {
        const name = (short as Record<string, string>)[type];
        expect(name, type).toBeTruthy();
        expect(name.split(/\s+/).length, type).toBeLessThanOrEqual(4);
      }
    });
  }

  it("draws the line as a 44-pixel link under the name, the filter's glyph, never a tooltip island", () => {
    // The list and the page hand it its href and words (the integration renders read them); here, what it draws.
    type Props = Record<string, unknown> & { children?: ReactNode; sx?: Record<string, unknown> };
    const link = EmailStateLine({ href: "/ro/admin/registrations/r1#emailuri", words: { line: "Adresa nu există · Confirmarea cu QR · 3 oct.", tone: "error" } }) as ReactElement<Props>;
    expect(link.props.component).toBe("a");
    expect(link.props.href).toBe("/ro/admin/registrations/r1#emailuri");
    expect(link.props.sx).toMatchObject({ minHeight: 44, flexBasis: "100%", color: "error.main" });
    const children = (Array.isArray(link.props.children) ? link.props.children : [link.props.children]).filter((child): child is ReactElement<Props> => isValidElement(child));
    // The filter's glyph, hidden from a screen reader, then the words at body weight: nothing that opens on hover.
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe(UnsubscribeIcon);
    expect(children[0].props["aria-hidden"]).toBe(true);
    expect(children[1].props.children).toBe("Adresa nu există · Confirmarea cu QR · 3 oct.");
    expect((children[1].props.sx as Record<string, unknown>).fontWeight).toBe(400);
  });
});

describe("the resend questions' first sentence (§NNN, BR-REQ-037-02)", () => {
  for (const locale of ["ro", "en"] as const) {
    const warn = catalogues[locale].Admin.registrations.rejected.warn;
    const state = (cause: RejectionCause, kind: (typeof EMAIL_STATE_KINDS)[number] = "unreachable") => ({ kind, cause, at: REJECTED_AT });

    it(`warns by the cause while the address refuses the club's mail, never blocking the press (${locale})`, () => {
      for (const cause of ["suppressed", "unsubscribed", "complaint-suppressed"] as const) expect(resendWarning(state(cause), locale), cause).toBe(warn.suppressed);
      expect(resendWarning(state("no-such-address"), locale)).toBe(warn.noSuchAddress);
      expect(resendWarning(state("mailbox-full"), locale)).toBe(fill(warn.mailboxFull, { date: shortDay(REJECTED_AT, locale) }));
      for (const cause of ["blocked", "gave-up", "refused", "other"] as const) {
        expect(resendWarning(state(cause), locale), cause).toBe(fill(warn.refused, { label: causeLabel(cause, locale) }));
      }
      expect(resendWarning(state("complained"), locale)).toBe(warn.complained);
      // §452: a date with its weekday takes no preposition.
      expect(warn.mailboxFull).not.toMatch(/ pe \{date\}| on \{date\}/);
    });

    it(`says nothing where sending again is the right press, or nothing asks to act (${locale})`, () => {
      expect(resendWarning(state("account", "not-sent"), locale)).toBeNull();
      expect(resendWarning(state("mailbox-full", "missing"), locale)).toBeNull();
      expect(resendWarning(state("no-such-address", "retried"), locale)).toBeNull();
      expect(resendWarning(null, locale)).toBeNull();
      expect(resendWarning(undefined, locale)).toBeNull();
    });

    it(`puts the warning first and keeps the question's own words (${locale})`, () => {
      expect(withResendWarning("Body.", warn.suppressed)).toBe(`${warn.suppressed} Body.`);
      expect(withResendWarning("Body.", null)).toBe("Body.");
    });
  }
});

describe("the desk's one chip: the QR confirmation only (§NNN, §67)", () => {
  for (const locale of ["ro", "en"] as const) {
    const words = catalogues[locale].Admin.registrations.rejected;

    it(`shows «Fără QR pe email — caută după nume» for the confirmation and the race number, while somebody must act (${locale})`, () => {
      for (const messageType of ["REGISTRATION_CONFIRMED", "BIB_ASSIGNED"]) {
        for (const kind of ["unreachable", "not-sent", "missing"] as const) {
          const desk = rejectedEmailWords(facts({ messageType, kind }), locale, "desk").desk;
          expect(desk?.label, `${messageType} ${kind}`).toBe(words.desk.label);
          expect(desk?.hint.startsWith(words.desk.hint), `${messageType} ${kind}`).toBe(true);
          // No address and no provider words, ever (§67).
          expect(JSON.stringify(desk)).not.toMatch(/@|550|5\.1\.1/);
        }
        // Sent again: it waits, the desk says nothing.
        expect(rejectedEmailWords(facts({ messageType, kind: "retried" }), locale, "desk").desk).toBeNull();
        // An email owed: the hint is what to tell the person, never a press to ask for.
        for (const kind of ["not-sent", "missing"] as const) {
          const hint = rejectedEmailWords(facts({ messageType, kind }), locale, "desk").desk?.hint;
          expect(hint, `${messageType} ${kind}`).toBe(`${words.desk.hint} ${words.desk.tellOwed}`);
          for (const press of Object.values(words.todoAskAdmin)) expect(hint).not.toContain(press);
        }
      }
    });

    it(`shows nothing for a family member's owed QR email — this person's own may have arrived (${locale})`, () => {
      for (const messageType of ["REGISTRATION_CONFIRMED", "BIB_ASSIGNED"]) {
        for (const kind of ["not-sent", "missing"] as const) {
          expect(rejectedEmailWords(facts({ messageType, kind, own: false }), locale, "desk").desk, `${messageType} ${kind}`).toBeNull();
        }
        // An address that refuses every email reaches nobody at it: the chip stays, whosever the email was.
        expect(rejectedEmailWords(facts({ messageType, kind: "unreachable", own: false }), locale, "desk").desk?.label).toBe(words.desk.label);
      }
    });

    it(`shows nothing for any other email, and nothing to any reader but the desk (${locale})`, () => {
      for (const messageType of ["EVENT_REMINDER", "DECLARATION_SIGNED", "EVENT_UPDATE_NOTICE", "VERIFY_REGISTRATION_EMAIL", "ORGANIZER_MESSAGE"]) {
        expect(rejectedEmailWords(facts({ messageType }), locale, "desk").desk, messageType).toBeNull();
      }
      for (const reader of ["administrator", "organizer"] as const) expect(rejectedEmailWords(facts(), locale, reader).desk).toBeNull();
    });
  }

  it("reads the QR confirmation from the cover map and from what carries the desk code", () => {
    // What carries the desk code is rendered in `render.test.ts`; DeskRow's chip in the screens' integration test.
    expect(["REGISTRATION_CONFIRMED", "BIB_ASSIGNED", "EVENT_REMINDER", "DECLARATION_SIGNED", "EVENT_UPDATE_NOTICE"].filter(isDeskQrMessage)).toEqual(["REGISTRATION_CONFIRMED", "BIB_ASSIGNED"]);
  });
});

describe("«Emailuri» rows in two short lines (§NNN, BR-REQ-037-01)", () => {
  const row = (overrides: Partial<OutboxHistoryRow> = {}): OutboxHistoryRow => ({
    messageType: "REGISTRATION_CONFIRMED",
    status: "SENT",
    isManualResend: false,
    requestedByName: null,
    clubCopy: false,
    recipientRole: "participant",
    createdAt: new Date("2026-10-03T09:00:00.000Z"),
    sentAt: new Date("2026-10-03T09:01:00.000Z"),
    transport: "mailgun",
    deliveredAt: null,
    rejectedAt: null,
    rejectionCause: null,
    providerCode: null,
    providerDetail: null,
    laterDeliveredAt: null,
    resolvedAt: null,
    retriedAt: null,
    retriedVia: null,
    ...overrides,
  });
  for (const locale of ["ro", "en"] as const) {
    const emails = catalogues[locale].Admin.registrations.emails;
    const short = catalogues[locale].Admin.emails.typesShort;
    const date = (at: Date) => formatDay(at, { locale, timeZone: "Europe/Bucharest", style: "short", year: false, withTime: true, position: "continues" });

    it(`names the email and whom it was for by role, never an address (${locale})`, () => {
      expect(emailHistoryWords(row(), locale).title).toBe(`${short.REGISTRATION_CONFIRMED} · ${emails.role.participant}`);
      expect(emailHistoryWords(row({ messageType: "DECLARATION_ARCHIVE", recipientRole: "archive" }), locale).title).toBe(`${short.DECLARATION_ARCHIVE} · ${emails.role.archive}`);
      expect(emailHistoryWords(row({ recipientRole: "copy", clubCopy: true }), locale).title).toBe(`${short.REGISTRATION_CONFIRMED} · ${emails.role.copy}`);
      expect(isClubRow(row({ recipientRole: "archive" }))).toBe(true);
      expect(isClubRow(row({ recipientRole: "notice" }))).toBe(true);
      expect(isClubRow(row({ recipientRole: "copy" }))).toBe(true);
      expect(isClubRow(row())).toBe(false);
    });

    it(`says what became of it: queued, sent, delivered, by Gmail, refused by cause, marked as spam, never left (${locale})`, () => {
      const created = new Date("2026-10-03T09:00:00.000Z");
      const sent = new Date("2026-10-03T09:01:00.000Z");
      expect(emailHistoryWords(row({ status: "PENDING", sentAt: null }), locale).state).toBe(fill(emails.state.queued, { date: date(created) }));
      expect(emailHistoryWords(row(), locale).state).toBe(fill(emails.state.sent, { date: date(sent) }));
      expect(emailHistoryWords(row({ deliveredAt: LATER }), locale).state).toBe(fill(emails.state.delivered, { date: date(LATER) }));
      expect(emailHistoryWords(row({ transport: "gmail" }), locale).state).toBe(fill(emails.state.gmail, { date: date(sent) }));
      const refused = emailHistoryWords(row({ status: "BOUNCED", rejectedAt: REJECTED_AT, rejectionCause: "mailbox-full", providerCode: "552 5.2.2", providerDetail: "552 5.2.2 mailbox full" }), locale);
      expect(refused.state).toBe(fill(fill(emails.state.refused, { date: date(REJECTED_AT) }), { label: causeLabel("mailbox-full", locale) }));
      expect(refused.refused).toBe(true);
      // Under it, in small print: the provider's code and words once, then why in plain words.
      expect(refused.notes[0]).toBe(fill(catalogues[locale].Admin.registrations.rejected.reason, { reason: "552 5.2.2 mailbox full" }));
      expect(refused.notes[1]).toBe(catalogues[locale].Admin.registrations.rejected.why.cause["mailbox-full"]);
      expect(emailHistoryWords(row({ status: "COMPLAINED", rejectedAt: REJECTED_AT, rejectionCause: "complained" }), locale).state).toBe(fill(emails.state.spam, { date: date(REJECTED_AT) }));
      const account = emailHistoryWords(row({ status: "BOUNCED", sentAt: null, rejectedAt: REJECTED_AT, rejectionCause: "account" }), locale);
      expect(account.state).toBe(fill(fill(emails.state.notSent, { date: date(REJECTED_AT) }), { reason: emails.notSentReason.account }));
      expect(account.notes).toContain(catalogues[locale].Admin.registrations.rejected.why.account);
      expect(emailHistoryWords(row({ status: "FAILED", sentAt: null }), locale).state).toBe(fill(fill(emails.state.notSent, { date: date(created) }), { reason: emails.notSentReason.failed }));
      // What came after a refusal.
      expect(emailHistoryWords(row({ status: "BOUNCED", rejectionCause: "other", resolvedAt: LATER }), locale).notes.at(-1)).toBe(fill(emails.after.resolved, { date: date(LATER) }));
      expect(emailHistoryWords(row({ status: "BOUNCED", rejectionCause: "other", retriedAt: LATER, retriedVia: "gmail" }), locale).notes.at(-1)).toBe(fill(emails.after.retriedGmail, { date: date(LATER) }));
    });

    it(`says who asked for a resend by hand (${locale})`, () => {
      expect(emailHistoryWords(row({ isManualResend: true, requestedByName: "Ana" }), locale).state).toContain(fill(emails.resentBy, { staff: "Ana" }));
      expect(emailHistoryWords(row({ isManualResend: true }), locale).state).toContain(emails.resentByNobody);
    });
  }
});

describe("the club's own mailboxes (§NNN)", () => {
  const at = (minutes: number) => new Date(REJECTED_AT.getTime() - minutes * 60_000);
  const input = (overrides: Partial<ClubRejectionInput>): ClubRejectionInput => ({
    role: "archive",
    recipientEmail: "archive@example.org",
    messageType: "DECLARATION_ARCHIVE",
    at: at(0),
    cause: "no-such-address",
    ...overrides,
  });

  it("groups by address while it is still the club's, by role once removed, newest first, with the window's count", () => {
    const groups = groupClubMailboxRejections(
      [
        input({}),
        input({ at: at(10), cause: "mailbox-full" }),
        input({ role: "notice", recipientEmail: "office@example.org", messageType: "CLUB_CONFIRMATION_NOTICE", at: at(20), cause: "suppressed" }),
        input({ role: "copy", recipientEmail: null, messageType: "REGISTRATION_CONFIRMED", at: at(30), cause: "mailbox-full" }),
        input({ role: "copy", recipientEmail: null, messageType: "BIB_ASSIGNED", at: at(40) }),
        // The club's account refused at the send: nothing about a mailbox.
        input({ recipientEmail: "copies@example.org", role: "archive", cause: "account", at: at(50) }),
        input({ recipientEmail: "copies@example.org", role: "archive", cause: "blocked", at: at(60) }),
      ],
      { declarationCopies: ["Copies@example.org"] },
    );
    expect(groups).toEqual([
      { address: "archive@example.org", role: "archive", messageType: "DECLARATION_ARCHIVE", at: at(0), cause: "no-such-address", count: 2, todo: "fix" },
      { address: "office@example.org", role: "notice", messageType: "CLUB_CONFIRMATION_NOTICE", at: at(20), cause: "suppressed", count: 1, todo: "suppressed" },
      { address: null, role: "copy", messageType: "REGISTRATION_CONFIRMED", at: at(30), cause: "mailbox-full", count: 2, todo: "removed" },
      { address: "copies@example.org", role: "archiveCopy", messageType: "DECLARATION_ARCHIVE", at: at(60), cause: "blocked", count: 1, todo: "fix" },
    ]);
    // A removed mailbox asks nothing of anybody.
    expect(clubMailboxesToFix(groups)).toBe(3);
    expect(groupClubMailboxRejections([input({ cause: "mailbox-full" })], { declarationCopies: [] })[0].todo).toBe("mailbox");
    for (const cause of ["suppressed", "unsubscribed", "complaint-suppressed"] as const) {
      expect(groupClubMailboxRejections([input({ cause })], { declarationCopies: [] })[0].todo, cause).toBe("suppressed");
    }
  });

  for (const locale of ["ro", "en"] as const) {
    it(`says every role, count and to-do under 200 characters (${locale})`, () => {
      const words = catalogues[locale].Admin.emails.clubRejections;
      const strings = (node: unknown): string[] =>
        typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(strings) : [];
      for (const text of strings(words)) expect(text.length, text).toBeLessThan(200);
      expect(Object.keys(words.role).sort()).toEqual(["archive", "archiveCopy", "copy", "notice"]);
      expect(Object.keys(words.todo).sort()).toEqual(["fix", "mailbox", "removed", "suppressed"]);
    });
  }
});
