import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type ConfirmSpec, fillFromForm, pickConfirm, resolveAlso, resolveEmailCount } from "@/shared/feedback/notice";

/**
 * The one builder of every dialog's email line (the design «telling the owner about every email a staff press sends»,
 * slice 3, `shared/feedback/confirm-words.ts`): the person named — or the count and whom —, the email by its name in
 * «Emailuri», the club's mailboxes as one quiet count counted as the enqueue counts them, the road derived from the email
 * itself, and the test address's sentence in place of the club's line. Both languages.
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  copies: { bcc: 2, archive: 1, notices: 3 } as { bcc: number; archive: number; notices: number } | null,
}));

vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({
    groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" },
    gmail: false,
  }),
}));
// The club's setting, one read per request: a failed read leaves the line out rather than the page.
vi.mock("@/shared/feedback/club-copies-request", () => ({
  clubCopiesForThisRequest: async () => {
    if (state.copies === null) throw new Error("no database");
    return state.copies;
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
    getLocale: async () => state.locale,
  };
});

const { confirmWords, MAIL_LINE_KEYS } = await import("@/shared/feedback/confirm-words");

const texts = (lines: ConfirmSpec["also"]) => (lines ?? []).map((line) => line.text);

beforeEach(() => {
  state.locale = "ro";
  state.copies = { bcc: 2, archive: 1, notices: 3 };
});

describe("confirmWords().mail — one email to a person", () => {
  it("names the person and the email, counts the club's copies and takes the email's own road", async () => {
    const words = await confirmWords();
    const mail = words.mail({ to: "Ana Pop", type: "REGISTRATION_CANCELLED" });
    expect(mail.email).toBe("Pleacă 1 email către Ana Pop: „Înscriere anulată”.");
    expect(texts(mail.also)).toEqual(["Și 2 emailuri pentru căsuțele clubului."]);
    expect(mail.road?.group).toBe("confirmations");
  });

  it("takes the links' road for «Dă-i un loc acum»'s declaration, no longer the confirmations' (the map's mismatch)", async () => {
    const words = await confirmWords();
    expect(words.mail({ to: "Ana Pop", type: "COMPLETE_DECLARATION" }).road?.group).toBe("links");
  });

  it("names the address beside the person where the page already shows it", async () => {
    const words = await confirmWords();
    const mail = words.mail({ to: { name: "Ana Pop", address: "ana@example.test" }, type: "VOLUNTEER_AGREEMENT_REQUEST" });
    expect(mail.email).toBe("Pleacă 1 email către Ana Pop (ana@example.test): „Contractul de voluntariat”.");
    // A volunteer's email is no participant's: the club gets no copy of it (§320).
    expect(mail.also).toEqual([]);
  });

  it("says, for a test row, that the address reaches nobody instead of the club's line", async () => {
    const words = await confirmWords();
    const mail = words.mail({ to: "Test Runner 1-1", type: "BIB_ASSIGNED", test: true });
    expect(mail.email).toBe("Pleacă 1 email către Test Runner 1-1: „Numărul de concurs dat de mână”.");
    expect(texts(mail.also)).toEqual([ro.Admin.confirm.mail.test]);
  });

  it("names both outcomes, and drops the road when the two emails travel by different roads", async () => {
    const words = await confirmWords();
    const across = words.mail({ to: "Ana Pop", type: "WAITLIST_JOINED", or: "COMPLETE_DECLARATION" });
    expect(across.email).toBe("Pleacă 1 email către Ana Pop: „Ești pe lista de așteptare” sau „Semnează declarația”, după cum iese apăsarea.");
    expect(across.road).toBeUndefined();
    const same = words.mail({ to: "Ana Pop", type: "COMPLETE_DECLARATION", or: "WAITLIST_SPOT_OFFER" });
    expect(same.road?.group).toBe("links");
  });

  it("counts the archive and «cineva a confirmat» on a confirmation, and says «cel mult» when the outcome decides", async () => {
    const words = await confirmWords();
    // 2 copies + the archive + 3 notices.
    expect(texts(words.mail({ to: "Ana Pop", type: "REGISTRATION_CONFIRMED", confirms: true }).also)).toEqual(["Și 6 emailuri pentru căsuțele clubului."]);
    // The address's link is never copied (§419); the step a restarted row lands on is.
    expect(texts(words.mail({ to: "Ana Pop", type: "VERIFY_REGISTRATION_EMAIL", or: "COMPLETE_DECLARATION" }).also)).toEqual([
      "Și cel mult 2 emailuri pentru căsuțele clubului.",
    ]);
  });

  it("says nothing of the club when it names no copy, or when its setting cannot be read", async () => {
    state.copies = { bcc: 0, archive: 0, notices: 0 };
    expect((await confirmWords()).mail({ to: "Ana Pop", type: "REGISTRATION_CANCELLED" }).also).toEqual([]);
    state.copies = null;
    expect((await confirmWords()).mail({ to: "Ana Pop", type: "REGISTRATION_CANCELLED" }).also).toEqual([]);
  });

  it("says it in English too", async () => {
    state.locale = "en";
    const words = await confirmWords();
    const mail = words.mail({ to: "Ana Pop", type: "REGISTRATION_CANCELLED" });
    expect(mail.email).toBe("1 email goes to Ana Pop: “Registration cancelled”.");
    expect(texts(mail.also)).toEqual(["And 2 emails to the club's mailboxes."]);
  });
});

describe("confirmWords().mail — a count", () => {
  it("counts per message, in Romanian's three forms", async () => {
    const words = await confirmWords();
    const thanks = words.mail({ to: { count: 25, audience: "present" }, type: "EVENT_THANKS" });
    expect(thanks.email).toBe("Pleacă 25 de emailuri „Mulțumim după cursă”, câte unul către fiecare persoană marcată prezentă.");
    expect(texts(thanks.also)).toEqual(["Și 50 de emailuri pentru căsuțele clubului."]);
    expect(words.mail({ to: { count: 1, audience: "unsigned" }, type: "COMPLETE_DECLARATION" }).email).toBe(
      "Pleacă 1 email „Semnează declarația”, câte unul către fiecare persoană care nu a semnat încă.",
    );
  });

  it("counts a bulk send's club copy once (§419, §445), and says nothing for nobody", async () => {
    const words = await confirmWords();
    expect(texts(words.mail({ to: { count: 40, audience: "participants" }, type: "ORGANIZER_MESSAGE" }).also)).toEqual(["Și 2 emailuri pentru căsuțele clubului."]);
    expect(texts(words.mail({ to: { count: 40, audience: "subscribers" }, type: "NEWSLETTER" }).also)).toEqual(["Și 2 emailuri pentru căsuțele clubului."]);
    expect(words.mail({ to: { count: 0, audience: "participants" }, type: "EVENT_THANKS" })).toEqual({});
  });

  it("says «cel mult» for a count the press's outcome decides", async () => {
    const words = await confirmWords();
    const offers = words.mail({ to: { upTo: 5, audience: "firstWaiting" }, type: "WAITLIST_SPOT_OFFER" });
    expect(offers.email).toBe("Pleacă cel mult 5 emailuri „S-a eliberat un loc”, câte unul către primii de pe lista de așteptare.");
    expect(texts(offers.also)).toEqual(["Și cel mult 10 emailuri pentru căsuțele clubului."]);
  });

  it("counts the lines of a typed list in the browser: distinct, non-empty, without regard to case", async () => {
    const words = await confirmWords();
    const spec: ConfirmSpec = {
      title: "t",
      body: "b",
      confirmLabel: "c",
      cancelLabel: "x",
      ...words.mail({ to: { upToLinesOf: "addresses", audience: "volunteerAddresses" }, type: "VOLUNTEER_INVITATION" }),
    };
    const asked = resolveEmailCount(spec, () => ["ana@example.test\n\n  ANA@example.test \r\nion@example.test\n"]);
    expect(asked.email).toBe("Pleacă cel mult 2 emailuri „Invitația de a fi voluntar”, câte unul către fiecare adresă din listă care nu are deja o invitație deschisă.");
    expect(asked.also).toBeUndefined();
    expect(resolveEmailCount(spec, () => ["  \n"]).email).toBeUndefined();
  });

  it("counts the ticks at the press, with the club's copies of each (`mailCount`)", async () => {
    const words = await confirmWords();
    const spec: ConfirmSpec = {
      title: "t",
      body: "b",
      confirmLabel: "c",
      cancelLabel: "x",
      ...words.mailCount({ field: "registrationId", counts: { a: 1, b: 1, c: 1 }, type: "REGISTRATION_CANCELLED", audience: "ticked", also: [words.nextInLineMaybe(true)] }),
    };
    const asked = resolveEmailCount(spec, () => ["a", "c", "c", "unknown"]);
    expect(asked.email).toBe("Pleacă 2 emailuri „Înscriere anulată”, câte unul către fiecare persoană bifată.");
    expect(texts(asked.also)).toEqual(["Și 4 emailuri pentru căsuțele clubului.", ro.Admin.confirm.mail.nextInLineMaybeMany]);
    expect(asked.road?.group).toBe("confirmations");
  });

  it("counts a series' update notice one club copy per date it writes to (`base` and the ticked dates)", async () => {
    const words = await confirmWords();
    const spec: ConfirmSpec = {
      title: "t",
      body: "b",
      confirmLabel: "c",
      cancelLabel: "x",
      ...words.mailCount({ field: "dates", base: 3, counts: { d2: 4, d3: 0 }, type: "EVENT_UPDATE_NOTICE", audience: "participants" }),
    };
    const asked = resolveEmailCount(spec, () => ["d2", "d3"]);
    expect(asked.email).toBe("Pleacă 7 emailuri „Detalii actualizate (loc, oră, program)”, câte unul către fiecare participant.");
    // Two dates write to somebody: two sends, one copy per Bcc address each.
    expect(texts(asked.also)).toEqual(["Și 4 emailuri pentru căsuțele clubului."]);
  });
});

describe("confirmWords — a press that writes to nobody, and the quieter lines", () => {
  it("says no email as plainly, with the freed place's offer where it may go", async () => {
    const words = await confirmWords();
    const erase = words.noMail("Ana Pop", [words.nextInLineMaybe()]);
    expect(erase.email).toBe("Nu pleacă niciun email către Ana Pop.");
    expect(texts(erase.also)).toEqual([ro.Admin.confirm.mail.nextInLineMaybe]);
    expect(words.noMailMany().email).toBe(ro.Admin.confirm.mail.noneMany);
    // BR-REQ-037-03 criterion 10: the freed place is offered to the first in line, or stays free, by the event's setting.
    for (const catalogue of [ro, en]) expect(catalogue.Admin.confirm.mail.nextInLineMaybe).toMatch(/S-a eliberat un loc|A place has freed up/);
  });

  it("words every quiet line it offers in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const words = await confirmWords();
      for (const key of MAIL_LINE_KEYS) {
        const line = words.line(key, { count: 3, date: "3 nov., 14:05", minutes: 2, type: "X" });
        expect(line.text, `${locale} ${key}`).not.toMatch(/^Admin\.|\{\w+\}/);
      }
    }
  });
});

describe("the dialog's quieter lines follow the form as posted", () => {
  const base: ConfirmSpec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x" };
  const posted = (fields: Record<string, string>) => (field: string) => (field in fields ? fields[field] : null);

  it("keeps a line only while its conditions hold — a raised capacity, any of several boxes moved", () => {
    const spec: ConfirmSpec = {
      ...base,
      also: [
        { text: "always" },
        { text: "offers", when: [{ field: "event.waitlistAutoOffer", equals: "true" }, { field: "event.capacity", raisedFrom: 40 }] },
        { text: "window", when: [{ anyOf: [{ field: "opens", notEquals: "7" }, { field: "deadline", notEquals: "2" }] }] },
      ],
    };
    expect(texts(resolveAlso(spec, posted({ "event.waitlistAutoOffer": "true", "event.capacity": "45", opens: "7", deadline: "2" })).also)).toEqual(["always", "offers"]);
    // Empty is unlimited: raised from any number.
    expect(texts(resolveAlso(spec, posted({ "event.waitlistAutoOffer": "true", "event.capacity": "", opens: "7", deadline: "3" })).also)).toEqual(["always", "offers", "window"]);
    // Not above, not a number, or a form without the box: not raised; the automatic offers off: no offers.
    for (const capacity of ["40", "39", "abc"]) {
      expect(texts(resolveAlso(spec, posted({ "event.waitlistAutoOffer": "true", "event.capacity": capacity, opens: "7", deadline: "2" })).also)).toEqual(["always"]);
    }
    expect(texts(resolveAlso(spec, posted({ "event.waitlistAutoOffer": "true", opens: "7", deadline: "2" })).also)).toEqual(["always"]);
    expect(texts(resolveAlso(spec, posted({ "event.waitlistAutoOffer": "false", "event.capacity": "50", opens: "7", deadline: "2" })).also)).toEqual(["always"]);
  });

  it("fills the person typed into the form into the email line and the quieter lines, as into the body", () => {
    const spec: ConfirmSpec = {
      ...base,
      body: "Garantezi {email}.",
      email: "Pleacă 1 email către {firstName} {lastName}: „X”.",
      also: [{ text: "Și pentru {firstName}." }],
      fillFrom: ["email", "firstName", "lastName"],
    };
    const filled = fillFromForm(spec, posted({ email: " ana@example.test ", firstName: "Ana", lastName: " Pop " }));
    expect([filled.body, filled.email, texts(filled.also)]).toEqual(["Garantezi ana@example.test.", "Pleacă 1 email către Ana Pop: „X”.", ["Și pentru Ana."]]);
    expect(filled.fillFrom).toBeUndefined();
  });

  it("picks a question by any of several conditions too", () => {
    const specs: ConfirmSpec[] = [{ ...base, title: "moved", when: [{ anyOf: [{ field: "a", notEquals: "1" }, { field: "b", notEquals: "2" }] }] }, { ...base, title: "plain" }];
    expect(pickConfirm(specs, posted({ a: "1", b: "2" }))?.title).toBe("plain");
    expect(pickConfirm(specs, posted({ a: "1", b: "5" }))?.title).toBe("moved");
  });
});
