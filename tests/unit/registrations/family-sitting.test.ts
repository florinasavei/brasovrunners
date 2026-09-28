import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, delete: () => undefined, get: () => undefined }),
}));

const {
  afterFormScreen,
  offerHint,
  emailHasLeft,
  openEmailLeavesAt,
  openEmailSubmittedAt,
  peopleAfterYes,
  sealEmailLeavesAt,
  shortScreenEmailLeft,
  compareFamilyOrder,
  doneFamilySentence,
  familyHeldDeclaration,
  sittingCookieMaxAgeSeconds,
  SITTING_COOKIE_GRACE_MINUTES,
  sittingCookieUntil,
  sittingMinutesLeft,
  withFamilyRank,
  SITTING_AT_ONCE_MINUTES,
  isFamilySitting,
  sittingCookieLive,
  sittingEntryFor,
  sittingLinkExpiresAt,
  sittingNames,
  sittingSharedValues,
  withSittingPerson,
  SITTING_NAMES_MAX,
  SITTING_SHARED_FIELDS,
} = await import("@/modules/registrations/domain/family-sitting");
const { openFamilySittingCookie, sealFamilySittingCookie } = await import("@/modules/registrations/family-sitting-cookie");
const { openFormDraft } = await import("@/modules/registrations/form-draft");
const { declarationStateKey } = await import("@/modules/registrations/domain/family-signing");
const { buildOutgoingEmail, joinNames } = await import("@/modules/notifications/templates");
const { DEADLINE_RULES, familySittingHeldUntil, familySittingHolds } = await import("@/modules/deadlines/domain/deadlines");
const { emailLeavesAt, emailLeavesWords } = await import("@/modules/notifications/domain/email-wait");

/**
 * §519 — a family registered in one sitting, with one email: the pure half. What the browser keeps,
 * when the messages become one, who a second form in the sitting is about, how long the family's link
 * lives, the family message's own shape, and each person's declaration on «Toate înscrierile mele».
 */
const NOW = new Date("2026-09-27T10:00:00.000Z");
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

describe("§519 the browser's half of a sitting", () => {
  const cookie = {
    sittingId: "00000000-0000-4000-8000-0000000000aa",
    seed: null,
    eventId: EVENT_ID,
    email: "familia.pop@example.ro",
    people: [
      { name: "Ana Pop", birthDate: "1985-03-02" },
      { name: "Maria Pop", birthDate: "2010-07-11" },
    ],
    heldUntil: new Date(NOW.getTime() + 900_000),
    shared: { city: "Brașov", nationality: "RO", guardianName: "Ana Pop" },
    sameBirthDate: null,
  };

  it("seals and opens under its own key, never as a form draft", () => {
    const sealed = sealFamilySittingCookie(cookie)!;
    expect(openFamilySittingCookie(sealed)).toEqual(cookie);
    expect(openFormDraft(sealed)).toBeNull();
    expect(sealed).not.toContain("familia");
  });

  it("carries the last form's birth-date clash, and keeps the sitting without the shared boxes when they would not fit", () => {
    const clash = { ...cookie, sameBirthDate: { typed: "Ioana Pop", kept: "Maria Pop" } };
    expect(openFamilySittingCookie(sealFamilySittingCookie(clash)!)?.sameBirthDate).toEqual({ typed: "Ioana Pop", kept: "Maria Pop" });
    const huge = { ...cookie, shared: { city: "x".repeat(4_000) } };
    const opened = openFamilySittingCookie(sealFamilySittingCookie(huge)!);
    expect(opened?.people).toEqual(cookie.people);
    expect(opened?.shared).toBeUndefined();
  });

  it("carries each person's place — reserved or the waiting list, never «none» (§NNN, the review of 2026-09-28, round three)", async () => {
    const { isNewSittingPerson, sittingReservationFacts, withLatestPlace, withPlace, withSittingPerson } = await import("@/modules/registrations/domain/family-sitting");
    const people = [
      { name: "Ana Pop", birthDate: "1985-03-02" },
      { name: "Maria Pop", birthDate: "2010-07-11", waitlist: true },
      { name: "Dan Pop", birthDate: "2011-05-20" },
    ];
    expect(openFamilySittingCookie(sealFamilySittingCookie({ ...cookie, people })!)?.people).toEqual(people);
    // Every person holds a place or waits for one: the marker counts two reserved and one waiting.
    expect(sittingReservationFacts(people)).toEqual({ firstNames: ["Ana", "Maria", "Dan"], reserved: 2, waiting: 1 });
    expect(withLatestPlace(cookie.people, "waitlist").at(-1)).toEqual({ name: "Maria Pop", birthDate: "2010-07-11", waitlist: true });
    expect(withLatestPlace(cookie.people, undefined)).toEqual(cookie.people);
    expect(withPlace({ name: "Dan Pop", birthDate: "", waitlist: true }, "reserved")).toEqual({ name: "Dan Pop", birthDate: "" });
    // A correction keeps the place the person had, and is not a new person; another name is.
    const corrected = withSittingPerson(people, { name: "Maria  Pop", birthDate: "2010-07-12" });
    expect(corrected.people.at(-1)).toEqual({ name: "Maria Pop", birthDate: "2010-07-12", waitlist: true });
    expect(isNewSittingPerson(people, corrected)).toBe(false);
    expect(isNewSittingPerson(people, withSittingPerson(people, { name: "Ioana Pop", birthDate: "2012-01-01" }))).toBe(true);
    // Another name on a typed birth date is set aside, not a new person (§493).
    expect(isNewSittingPerson(people, withSittingPerson(people, { name: "Ioana Pop", birthDate: "2011-05-20" }))).toBe(false);
  });

  it("a stored reservation holds only while its fixed deadline is ahead, whatever the email is doing (§NNN)", async () => {
    const { familyReservationHoldsAt } = await import("@/modules/registrations/domain/family-reservation");
    const deadline = new Date(NOW.getTime() + 40 * 60_000);
    expect(familyReservationHoldsAt(null, NOW)).toBe(false);
    expect(familyReservationHoldsAt(deadline, NOW)).toBe(true);
    expect(familyReservationHoldsAt(deadline, deadline)).toBe(false);
    expect(familyReservationHoldsAt(deadline, new Date(deadline.getTime() + 60 * 60_000))).toBe(false);
  });

  it("stands for a sitting of this event until its email leaves by itself", () => {
    expect(sittingCookieLive(cookie, EVENT_ID, NOW)).toBe(true);
    expect(sittingCookieLive(cookie, "00000000-0000-4000-8000-000000000002", NOW)).toBe(false);
    expect(sittingCookieLive(cookie, EVENT_ID, cookie.heldUntil)).toBe(false);
    expect(sittingCookieLive(null, EVENT_ID, NOW)).toBe(false);
  });

  it("keeps each person once, the latest last, and at most ten", () => {
    const people = [
      { name: "Ana Pop", birthDate: "1985-03-02" },
      { name: "Maria Pop", birthDate: "2010-07-11" },
    ];
    expect(sittingNames(withSittingPerson(people, { name: "  ana   pop ", birthDate: "1985-03-02" }).people)).toEqual(["Maria Pop", "ana pop"]);
    expect(withSittingPerson([], { name: "   ", birthDate: "2010-01-01" }).people).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `Copil ${index}`, birthDate: `2010-01-${String(index + 1).padStart(2, "0")}` })).reduce<
      { name: string; birthDate: string }[]
    >((kept, person) => withSittingPerson(kept, person).people, []);
    expect(many).toHaveLength(SITTING_NAMES_MAX);
    expect(many.at(-1)?.name).toBe("Copil 11");
  });

  it("lists what the email will name: a corrected date replaces, another name on a typed birth date is not added (§493)", () => {
    const ana = [{ name: "Ana Pop", birthDate: "2015-05-05" }];
    // A corrected birth date: the same person, the new date, one line.
    expect(withSittingPerson(ana, { name: "Ana Pop", birthDate: "2015-05-06" })).toEqual({ people: [{ name: "Ana Pop", birthDate: "2015-05-06" }], sameBirthDate: null });
    // Twins, or a corrected name: nobody added, nobody replaced, and the screen names the two.
    expect(withSittingPerson(ana, { name: "Maria Pop", birthDate: "2015-05-05" })).toEqual({ people: ana, sameBirthDate: { typed: "Maria Pop", kept: "Ana Pop" } });
    // Somebody else: added.
    expect(sittingNames(withSittingPerson(ana, { name: "Ion Pop", birthDate: "1987-02-14" }).people)).toEqual(["Ana Pop", "Ion Pop"]);
  });

  it("starts the next form with the boxes a family shares, a blank one keeping the earlier form's", () => {
    const posted = (values: Record<string, string>) => (name: string) => values[name] ?? "";
    const first = sittingSharedValues(undefined, posted({ city: "Brașov", country: "RO", nationality: "RO", firstName: "Ana", phone: "722000000", emergencyContactName: "Dan Pop" }));
    expect(first).toEqual({ city: "Brașov", country: "RO", nationality: "RO", emergencyContactName: "Dan Pop" });
    // The person's own boxes are never carried.
    expect(first).not.toHaveProperty("firstName");
    expect(first).not.toHaveProperty("phone");
    // A child's form adds the guardian; an adult's blank guardian keeps it.
    const second = sittingSharedValues(first, posted({ city: "Brașov", nationality: "RO", guardianName: "Ana Pop" }));
    expect(sittingSharedValues(second, posted({ city: "Codlea" }))).toEqual({ city: "Codlea", country: "RO", nationality: "RO", guardianName: "Ana Pop", emergencyContactName: "Dan Pop" });
  });

  it("carries the country like the city — a required box the next form must not start at the default (§520)", () => {
    const posted = (values: Record<string, string>) => (name: string) => values[name] ?? "";
    expect(SITTING_SHARED_FIELDS).toContain("country");
    const first = sittingSharedValues(undefined, posted({ city: "Wien", country: "AT" }));
    expect(first).toEqual({ city: "Wien", country: "AT" });
    // The next form posted nothing for it: the earlier form's country is kept.
    expect(sittingSharedValues(first, posted({ city: "Wien" }))).toEqual({ city: "Wien", country: "AT" });
    // And the form reads it back through the same prefill as the city.
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/register/page.tsx"), "utf8");
    expect(page).toContain('defaultValue={prefill("country") || "RO"}');
  });
});

describe("§519 the sitting's decisions", () => {
  it("is a family from the second person on", () => {
    expect(isFamilySitting(0)).toBe(false);
    expect(isFamilySitting(1)).toBe(false);
    expect(isFamilySitting(2)).toBe(true);
  });

  it("replaces a kept form only by its name — a corrected date — and never overwrites it with another name on its birth date", () => {
    const kept = [{ id: "e1", registeredName: "Maria Pop", birthDate: "2010-07-11" }];
    expect(sittingEntryFor(kept, { legalName: "maria  pop", birthDate: "2010-07-11" })).toEqual({ kind: "replace", entry: kept[0] });
    expect(sittingEntryFor(kept, { legalName: "Maria Pop", birthDate: "2010-07-12" })).toEqual({ kind: "replace", entry: kept[0] });
    // §493: twins, or a corrected name — neither replaced nor added.
    expect(sittingEntryFor(kept, { legalName: "Ioana Pop", birthDate: "2010-07-11" })).toEqual({ kind: "sameBirthDate", entry: kept[0] });
    expect(sittingEntryFor(kept, { legalName: "Ion Pop", birthDate: "1987-02-14" })).toBeNull();
  });

  it("lives until the last thing the link can act on lapses", () => {
    const later = new Date(NOW.getTime() + 48 * 3_600_000);
    expect(sittingLinkExpiresAt([new Date(NOW.getTime() - 1), later, null, new Date(NOW.getTime() + 3_600_000)], NOW)).toEqual(later);
    expect(sittingLinkExpiresAt([new Date(NOW.getTime() - 1)], NOW)).toBeNull();
  });

  it("waits the club's window from the last form: ten minutes unless set, between 0 (at once) and sixty", () => {
    expect(DEADLINE_RULES.familySittingMinutes).toEqual({ unit: "minutes", min: 0, max: 60, default: 10 });
    expect(familySittingHolds({ familySittingMinutes: 0 })).toBe(false);
    expect(familySittingHolds({ familySittingMinutes: 1 })).toBe(true);
    expect(familySittingHeldUntil(NOW, { familySittingMinutes: 15 }).getTime() - NOW.getTime()).toBe(900_000);
  });
});

describe("§519 the family message", () => {
  const data = {
    participantName: "",
    eventTitle: "Crosul familiei",
    eventTitleOther: "The family cross",
    familySittingPeople: [
      { name: "Ana Pop", birthDate: "1985-03-02" },
      { name: "Maria Pop", birthDate: "2010-07-11" },
      { name: "Ion Pop", birthDate: "1987-02-14" },
    ],
    familyRegistered: ["Dan P."],
    familyMineUrl: "https://example.test/ro/inscrieri/ale-mele/secret",
    addressCap: 4,
  };

  it("says the family in its subject, everybody in the box, one button for all and the address's own page", () => {
    const email = buildOutgoingEmail({
      to: "familia.pop@example.ro",
      locale: "ro",
      idempotencyKey: "k",
      messageType: "REGISTER_ANOTHER_PERSON",
      data,
      actionUrl: "https://example.test/ro/inregistrari/familie/secret",
    });
    expect(email.subject).toContain("Înscriere de familie: 3 persoane la Crosul familiei");
    for (const words of [
      "Persoana 1 din 3: Ana Pop, data nașterii 2 martie 1985",
      "Persoana 2 din 3: Maria Pop, data nașterii 11 iulie 2010",
      "Înscriși deja cu această adresă: Dan P.",
      "Confirm și semnez declarațiile (3)",
      "Toate înscrierile mele",
      "Person 3 of 3: Ion Pop, date of birth 14 February 1987",
      "Confirm and sign the declarations (3)",
    ]) {
      expect(email.text).toContain(words);
    }
    // Never the single person's second button: the page's ticks say who is not registered.
    expect(email.text).not.toContain("Nu înscriu această persoană");
  });

  it("is the platform's words even where the club rewrote the single person's message", () => {
    const overrides = { "REGISTER_ANOTHER_PERSON:ro": { subject: "Textul clubului", paragraphs: ["Cuvintele clubului"] } } as never;
    const params = { to: "familia.pop@example.ro", locale: "ro" as const, idempotencyKey: "k", messageType: "REGISTER_ANOTHER_PERSON" as const, actionUrl: "https://example.test/ro/inregistrari/familie/secret", overrides };
    // The club's words do reach the single person's message…
    const single = buildOutgoingEmail({ ...params, data: { participantName: "", eventTitle: "Crosul familiei", familyPersonName: "Maria Pop", familyPersonBirthDate: "2010-07-11" } });
    expect(single.subject).toContain("Textul clubului");
    // …and never the family's, whose button and facts are not the single person's.
    const email = buildOutgoingEmail({ ...params, data });
    expect(email.subject).not.toContain("Textul clubului");
    expect(email.text).not.toContain("Cuvintele clubului");
  });
});

describe("§519 each person's declaration on «Toate înscrierile mele»", () => {
  it("says signed, to sign, after the address, or when a place is offered", () => {
    expect(declarationStateKey("CONFIRMED", NOW)).toBe("signed");
    expect(declarationStateKey("WAITLISTED", NOW)).toBe("signed");
    expect(declarationStateKey("PENDING_DECLARATION", null)).toBe("toSign");
    expect(declarationStateKey("WAITLIST_OFFERED", null)).toBe("toSign");
    expect(declarationStateKey("PENDING_EMAIL_CONFIRMATION", null)).toBe("afterAddress");
    expect(declarationStateKey("WAITLISTED", null)).toBe("waiting");
    expect(declarationStateKey("CANCELLED", null)).toBeNull();
  });
});

describe("§519 the fix round's pure rules", () => {
  const MIN = 60_000;
  const plus = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

  it("holds a place from the moment its request can leave, never before, and never holds a request past its own hold", () => {
    const computeHold = (at: Date) => new Date(at.getTime() + 10 * MIN);
    // A 10-minute hold, the wizard's 30: the hold ends 10 minutes after the request leaves.
    expect(familyHeldDeclaration({ holdExpiresAt: plus(10), releaseAt: plus(30), now: NOW, computeHold })).toEqual({ holdExpiresAt: plus(40), notBefore: plus(30) });
    // A window's deadline days away is kept as it is.
    expect(familyHeldDeclaration({ holdExpiresAt: plus(5000), releaseAt: plus(30), now: NOW, computeHold: () => plus(5000) })).toEqual({ holdExpiresAt: plus(5000), notBefore: plus(30) });
    // The start cuts the hold before the request could leave: it leaves now.
    expect(familyHeldDeclaration({ holdExpiresAt: plus(20), releaseAt: plus(30), now: NOW, computeHold: () => plus(20) })).toEqual({ holdExpiresAt: plus(20), notBefore: NOW });
  });

  it("orders a family by the forms sent: earlier first, one instant by the sitting's own list, then by id", () => {
    const at = new Date("2026-09-27T10:00:00Z");
    const rows = withFamilyRank(
      [
        { id: "c", createdAt: at },
        { id: "a", createdAt: at },
        { id: "z", createdAt: new Date(at.getTime() - MIN) },
        { id: "b", createdAt: at },
      ],
      ["z", "c", "a"],
    );
    expect([...rows].sort(compareFamilyOrder).map((row) => row.id)).toEqual(["z", "c", "a", "b"]);
  });

  it("says the minutes left, rounded up, and keeps the browser's half for the club's window or, at 0, the offer's", () => {
    expect(sittingMinutesLeft(9 * MIN + 1)).toBe(10);
    expect(sittingMinutesLeft(MIN)).toBe(1);
    expect(sittingMinutesLeft(0)).toBe(0);
    expect(sittingCookieUntil(NOW, 10)).toEqual(plus(10));
    expect(sittingCookieUntil(NOW, 0)).toEqual(plus(SITTING_AT_ONCE_MINUTES));
  });
});

describe("§519 the family's one confirmation", () => {
  const data = {
    participantName: "Ana Pop",
    eventTitle: "Crosul familiei",
    eventTitleOther: "The family cross",
    familyConfirmed: [
      { name: "Ana Pop", checkinCode: "AAA111", qrUrl: "https://example.test/api/registrations/qr/AAA111.png", raceNumber: 12, provisional: false },
      { name: "Ion Pop", checkinCode: "BBB222", qrUrl: "https://example.test/api/registrations/qr/BBB222.png", raceNumber: 13, provisional: true },
      { name: "Radu Pop", checkinCode: "CCC333", qrUrl: "https://example.test/api/registrations/qr/CCC333.png", raceNumber: null, provisional: false },
    ],
  };
  const params = { to: "familia.pop@example.ro", locale: "ro" as const, idempotencyKey: "k", messageType: "REGISTRATION_CONFIRMED" as const };

  it("carries every person's QR code, desk code and race number under their name, once, and the address's page as its button", () => {
    const email = buildOutgoingEmail({ ...params, data, actionUrl: "https://example.test/ro/inscrieri/ale-mele/secret" });
    expect(email.subject).toContain("Confirmat: 3 persoane la Crosul familiei");
    expect(email.subject).toContain("Confirmed: 3 people for The family cross");
    for (const words of ["Număr de concurs: 12", "Număr de concurs: 13 (provizoriu", "Număr de concurs: încă fără număr", "Codul pentru masă: BBB222", "Race number: 12", "Toate înscrierile mele"]) {
      expect(email.text).toContain(words);
    }
    // The pictures once, in the first half: the second repeats the words.
    expect(email.html.split('<img src="https://example.test/api/registrations/qr/')).toHaveLength(4);
  });

  it("gives the club's copy the names and numbers, never a code or a QR (§320)", () => {
    const email = buildOutgoingEmail({ ...params, data: { ...data, clubCopy: true } });
    expect(email.text).toContain("Număr de concurs: 12");
    expect(email.text).not.toContain("AAA111");
    expect(email.html).not.toContain("/api/registrations/qr/");
  });

  it("greets everybody by first name in the order of the forms, commas and «și» / “and” (the owner's answer)", () => {
    const email = buildOutgoingEmail({ ...params, data: { ...data, familyConfirmed: data.familyConfirmed.map((person, index) => ({ ...person, firstName: index === 1 ? "Ion" : undefined })) } });
    expect(email.text).toContain("Salut, Ana, Ion și Radu,");
    expect(email.text).toContain("Hi Ana, Ion and Radu,");
    expect(email.text).not.toContain("Salut, Ana Pop,");
    expect(joinNames("ro", ["Ana"])).toBe("Ana");
    expect(joinNames("ro", ["Ana", "Ion"])).toBe("Ana și Ion");
    expect(joinNames("en", ["Ana", "Ion", "Maria"])).toBe("Ana, Ion and Maria");
  });
});

describe("§519 the fix round of the second review", () => {
  it("says one email for the family while the window holds, and each person's own at a window of 0 — in both catalogues", async () => {
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"] })).toBe("family");
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"], atOnce: false })).toBe("family");
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"], atOnce: true })).toBe("familyEach");
    expect(doneFamilySentence({ names: ["Ana Pop"], atOnce: true })).toBeNull();
    expect(doneFamilySentence(null)).toBeNull();
    const ro = (await import("../../../messages/ro.json")).default as { Registration: { done: Record<string, unknown>; sitting: Record<string, unknown> } };
    const en = (await import("../../../messages/en.json")).default as { Registration: { done: Record<string, unknown>; sitting: Record<string, unknown> } };
    expect(ro.Registration.done.familyEach).toBe("Fiecare persoană primește emailul ei.");
    expect(en.Registration.done.familyEach).toBe("Each person gets their own email.");
    expect(ro.Registration.sitting.leadNamed).toBe("Formularul lui {name} pentru {event} a ajuns.");
    expect(ro.Registration.sitting.when).toContain("de la ultima apăsare");
    expect(en.Registration.sitting.when).toContain("after your last press");
  });

  it("keeps the browser's half two minutes past the window, and the window the action read", () => {
    expect(SITTING_COOKIE_GRACE_MINUTES).toBe(2);
    expect(sittingCookieMaxAgeSeconds(new Date(NOW.getTime() + 600_000), NOW)).toBe(600 + 120);
    expect(sittingCookieMaxAgeSeconds(new Date(NOW.getTime() - 60_000), NOW)).toBe(60);
    const cookie = {
      sittingId: null,
      seed: null,
      eventId: EVENT_ID,
      email: "familia.pop@example.ro",
      people: [{ name: "Ana Pop", birthDate: "1985-03-02" }],
      heldUntil: new Date(NOW.getTime() + 600_000),
      windowMinutes: 10,
      sameBirthDate: null,
    };
    expect(openFamilySittingCookie(sealFamilySittingCookie(cookie)!)?.windowMinutes).toBe(10);
    expect(openFamilySittingCookie(sealFamilySittingCookie({ ...cookie, windowMinutes: 0 })!)?.windowMinutes).toBe(0);
    expect(openFamilySittingCookie(sealFamilySittingCookie({ ...cookie, windowMinutes: undefined })!)?.windowMinutes).toBeUndefined();
    // The screen reads the window's end, never the grace: the sitting is over when its email leaves.
    expect(sittingCookieLive(cookie, EVENT_ID, new Date(NOW.getTime() + 600_000))).toBe(false);
  });
});

/**
 * §536 (amending §519; the owner, 2026-09-28: «sa inteleg ca nu primesc mailu daca nu apas pe „Nu,
 * gata, trimite mailul”?») — the first form is an ordinary form: its email leaves on the club's
 * timing, the screen says when, and «Da, încă o persoană» is the press that opens the sitting.
 */
describe("§536 no sitting without a press", () => {
  const cookie = {
    sittingId: "00000000-0000-4000-8000-0000000000aa",
    seed: null,
    eventId: EVENT_ID,
    email: "familia.pop@example.ro",
    people: [{ name: "Ana Pop", birthDate: "1985-03-02" }],
    heldUntil: new Date(NOW.getTime() + 600_000),
    sameBirthDate: null,
  };
  const registrationSeed = { kind: "registration" as const, id: "00000000-0000-4000-8000-0000000000b1", outboxId: "00000000-0000-4000-8000-0000000000c1" };

  it("shows the one question after the first form, and the sitting's screen only after «Da»", () => {
    expect(afterFormScreen({ ...cookie })).toBe("offer");
    expect(afterFormScreen({ ...cookie, joined: false })).toBe("offer");
    expect(afterFormScreen({ ...cookie, joined: true })).toBe("sitting");
    expect(afterFormScreen(null)).toBeNull();
  });

  it("says when the email leaves: now under «imediat», at the next scheduled pass otherwise — before «Da» and after it alike", () => {
    expect(emailLeavesWords(null, NOW, "ro")).toEqual({ key: "leavesNow" });
    // The club's clock (Bucharest, UTC+3 in September): 10:15 UTC is 13:15, today, said as the hour alone.
    expect(emailLeavesWords(new Date(NOW.getTime() + 15 * 60_000), NOW, "ro")).toEqual({ key: "leavesToday", at: "13:15" });
    // Another day on the club's clock: the inline short day, which brings its own «la» before the hour (§452).
    expect(emailLeavesWords(new Date(NOW.getTime() + 24 * 60 * 60_000), NOW, "ro")).toEqual({ key: "leavesOn", at: "lun., 28 sept. 2026, la 13:00" });
    expect(emailLeavesAt({ timing: "immediate", now: NOW, pingerMinutes: 15, intervalMinutes: 0, governorFloorMinutes: 0 })).toBeNull();
    const next = emailLeavesAt({ timing: "scheduled", now: NOW, pingerMinutes: 15, intervalMinutes: 0, governorFloorMinutes: 0 })!;
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(NOW.getTime() + 15 * 60_000);
    expect(next.getUTCMinutes() % 15).toBe(0);
    // A minimum interval counted from now: the latest the pass can be, never one that comes first.
    const slow = emailLeavesAt({ timing: "scheduled", now: NOW, pingerMinutes: 15, intervalMinutes: 60, governorFloorMinutes: 0 })!;
    expect(slow.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 60 * 60_000);
  });

  it("keeps the first form's seed in the browser's half, sealed to one length whatever it names (§39)", () => {
    const withSeed = { ...cookie, seed: registrationSeed };
    expect(openFamilySittingCookie(sealFamilySittingCookie(withSeed)!)).toEqual(withSeed);
    const noMessage = { ...cookie, seed: { kind: "entry" as const, id: registrationSeed.id, outboxId: null } };
    expect(openFamilySittingCookie(sealFamilySittingCookie(noMessage)!)?.seed).toEqual(noMessage.seed);
    expect(openFamilySittingCookie(sealFamilySittingCookie(cookie)!)?.seed).toBeNull();
    const joined = { ...cookie, joined: true };
    expect(openFamilySittingCookie(sealFamilySittingCookie(joined)!)?.joined).toBe(true);
    const lengths = new Set([cookie, withSeed, noMessage].map((value) => sealFamilySittingCookie(value)!.length));
    expect(lengths.size).toBe(1);
  });

  it("keeps when the first form's email leaves, computed once at submit, at one length under either timing (the review of 2026-09-28)", () => {
    const pass = new Date(NOW.getTime() + 15 * 60_000);
    const scheduled = { ...cookie, seed: registrationSeed, emailLeavesAt: pass };
    const immediate = { ...cookie, seed: registrationSeed, emailLeavesAt: null };
    expect(openFamilySittingCookie(sealFamilySittingCookie(scheduled)!)?.emailLeavesAt).toEqual(pass);
    expect(openFamilySittingCookie(sealFamilySittingCookie(immediate)!)?.emailLeavesAt).toBeNull();
    // A half written before it was kept: absent, and the screen computes it as before.
    expect(openFamilySittingCookie(sealFamilySittingCookie({ ...cookie, seed: registrationSeed })!)?.emailLeavesAt).toBeUndefined();
    expect(sealFamilySittingCookie(scheduled)!.length).toBe(sealFamilySittingCookie(immediate)!.length);
    expect(sealEmailLeavesAt(pass)).toHaveLength(25);
    expect(sealEmailLeavesAt(null)).toHaveLength(25);
    expect(openEmailLeavesAt(sealEmailLeavesAt(pass))).toEqual(pass);
    expect(openEmailLeavesAt("x")).toBeUndefined();
    expect(openEmailLeavesAt("")).toBeUndefined();
  });

  it("under «imediat» seals the submit instant in the same 25 characters, so a reload can say the email left (§540)", () => {
    const immediate = { ...cookie, seed: registrationSeed, emailLeavesAt: null, emailSubmittedAt: NOW };
    const opened = openFamilySittingCookie(sealFamilySittingCookie(immediate)!);
    expect(opened?.emailLeavesAt).toBeNull();
    expect(opened?.emailSubmittedAt).toEqual(NOW);
    expect(sealEmailLeavesAt(null, NOW)).toHaveLength(25);
    expect(sealFamilySittingCookie(immediate)!.length).toBe(sealFamilySittingCookie({ ...immediate, emailLeavesAt: new Date(NOW.getTime() + 60_000) })!.length);
    // The epoch an older half sealed is no instant: the old «pleacă acum».
    expect(openEmailSubmittedAt(sealEmailLeavesAt(null))).toBeUndefined();
    expect(openEmailSubmittedAt(sealEmailLeavesAt(new Date(NOW.getTime() + 60_000)))).toBeUndefined();
    expect(shortScreenEmailLeft({ leavesAt: null, submittedAt: NOW, now: new Date(NOW.getTime() + 3_000) })).toBe(false);
    expect(shortScreenEmailLeft({ leavesAt: null, submittedAt: NOW, now: new Date(NOW.getTime() + 60 * 60_000) })).toBe(true);
    expect(shortScreenEmailLeft({ leavesAt: null, now: new Date(NOW.getTime() + 60 * 60_000) })).toBe(false);
  });

  it("lists after «Da» only the people the sitting's email covers (the review of 2026-09-28)", () => {
    const people = [{ name: "Ana Pop", birthDate: "2015-04-02" }];
    // The seed opened a sitting: the first person is in it.
    expect(peopleAfterYes({ holding: true, seed: registrationSeed, opened: "00000000-0000-4000-8000-0000000000aa", people })).toEqual({ people, seedSpent: false });
    // Nothing left to open (the first person confirmed from the email that left before «Da»): not named.
    expect(peopleAfterYes({ holding: true, seed: registrationSeed, opened: null, people })).toEqual({ people: [], seedSpent: true });
    // A form that left no seed keeps its name as always (§39), and a window of 0 holds nobody.
    expect(peopleAfterYes({ holding: true, seed: null, opened: null, people }).people).toEqual(people);
    expect(peopleAfterYes({ holding: false, seed: registrationSeed, opened: null, people }).people).toEqual(people);
  });

  it("chooses the one sentence under «Da» by what the line above says (the review of 2026-09-28, nit F0)", () => {
    const later = new Date(NOW.getTime() + 15 * 60_000);
    // Scheduled: the email still waits, so «Da» holds it and the address gets one for everybody.
    expect(offerHint({ atOnce: false, leavesAt: later, now: NOW })).toBe("addHint");
    // «Imediat»: it has left, so the next person's email is the one that names everybody.
    expect(offerHint({ atOnce: false, leavesAt: null, now: NOW })).toBe("addHintLeft");
    // A window of 0: nothing is held under either timing.
    expect(offerHint({ atOnce: true, leavesAt: later, now: NOW })).toBe("addHintAtOnce");
    expect(offerHint({ atOnce: true, leavesAt: null, now: NOW })).toBe("addHintAtOnce");
  });

  it("promises no hold once the stored pass has come (the review of 2026-09-28: a reload after 13:15)", () => {
    const pass = new Date(NOW.getTime() + 15 * 60_000);
    const after = new Date(pass.getTime() + 60_000);
    expect(emailHasLeft(pass, NOW)).toBe(false);
    expect(emailHasLeft(pass, pass)).toBe(true);
    expect(emailHasLeft(null, NOW)).toBe(true);
    expect(offerHint({ atOnce: false, leavesAt: pass, now: pass })).toBe("addHintLeft");
    expect(offerHint({ atOnce: false, leavesAt: pass, now: after })).toBe("addHintLeft");
    expect(offerHint({ atOnce: true, leavesAt: pass, now: after })).toBe("addHintAtOnce");
  });

  it("words the short screen in both catalogues: the form in, when it leaves, one true sentence under «Da»", async () => {
    type Catalogue = { Registration: { done: Record<string, string>; sitting: Record<string, unknown> } };
    const ro = (await import("../../../messages/ro.json")).default as unknown as Catalogue;
    const en = (await import("../../../messages/en.json")).default as unknown as Catalogue;
    // «pentru», never the colloquial «lui» before a feminine name in -a (the review of 2026-09-28, nit 4).
    expect(ro.Registration.done.formIn).toBe("Formularul pentru {name} a ajuns.");
    expect(en.Registration.done.formIn).toBe("The form for {name} is in.");
    expect(ro.Registration.done.leavesNow).toBe("Emailul către {email} pleacă acum.");
    expect(en.Registration.done.leavesNow).toBe("The email to {email} leaves now.");
    expect(ro.Registration.sitting.addHint).toBe("Dacă înscrii încă o persoană până la {at}, emailul îi așteaptă formularul, cel mult {window}, și primiți unul singur pentru toți.");
    expect(ro.Registration.sitting.addHintOn).toBe("Dacă înscrii încă o persoană până {at}, emailul îi așteaptă formularul, cel mult {window}, și primiți unul singur pentru toți.");
    expect(ro.Registration.done.leftAlready).toBe("Emailul către {email} a plecat.");
    expect(en.Registration.done.leftAlready).toBe("The email to {email} has left.");
    expect(en.Registration.done.leavesOn).toBe("The email to {email} leaves on {at}.");
    expect(ro.Registration.sitting.addHintLeft).toBe("Dacă înscrii încă o persoană, următorul email așteaptă cel mult {window} după ultimul formular și îi cuprinde pe toți.");
    expect(ro.Registration.sitting.addHintAtOnce).toBe("Fiecare persoană primește emailul ei.");
    for (const key of ["addHint", "addHintOn", "addHintLeft", "addHintAtOnce"]) {
      expect(en.Registration.sitting[key]).toBeTruthy();
      expect(String(ro.Registration.sitting[key]).length).toBeLessThanOrEqual(200);
      expect(String(en.Registration.sitting[key]).length).toBeLessThanOrEqual(200);
    }
    // «Gata» stays, on the sitting's screen after «Da» (§519).
    expect(ro.Registration.sitting.done).toBe("Nu, gata — trimite-mi emailul");
  });
});

/**
 * The review of 2026-09-28 (should-fix 2, nits 4 and 5): the leaving time in two shapes — today «la
 * HH:MM», another day the weekday-led date that brings its own «la» (§452) — and the sentence under
 * «Da» naming the club's window, each variant true, in both languages.
 */
describe("§536 the short screen's sentences, formatted", () => {
  type Words = (key: string, values?: Record<string, string>) => string;
  const words = async (locale: "ro" | "en", namespace: "Registration.done" | "Registration.sitting"): Promise<Words> => {
    const { createTranslator } = await import("next-intl");
    const messages = (await import(`../../../messages/${locale}.json`)).default;
    return createTranslator({ locale, messages, namespace }) as unknown as Words;
  };
  const leaving = async (locale: "ro" | "en", at: Date): Promise<string> => {
    const said = emailLeavesWords(at, NOW, locale, "prose");
    return (await words(locale, "Registration.done"))(said.key, { email: "ana@example.ro", at: said.at });
  };

  it("says today's hour after «la» / «at», once", async () => {
    const soon = new Date(NOW.getTime() + 15 * 60_000);
    expect(await leaving("ro", soon)).toBe("Emailul către ana@example.ro pleacă la 13:15.");
    expect(await leaving("en", soon)).toBe("The email to ana@example.ro leaves at 13:15.");
  });

  it("says another day as the long weekday and month without the year, its own «la» / «at», never a second one before the weekday", async () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60_000);
    const ro = await leaving("ro", tomorrow);
    expect(ro).toBe("Emailul către ana@example.ro pleacă luni, 28 septembrie, la 13:00.");
    expect(ro).not.toMatch(/la luni|la .* la /);
    const en = await leaving("en", tomorrow);
    expect(en).toBe("The email to ana@example.ro leaves on Monday, 28 September, at 13:00.");
    expect(en).not.toMatch(/at Monday/);
  });

  it("keeps the queue panel's short day, with its year", () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60_000);
    expect(emailLeavesWords(tomorrow, NOW, "ro").at).toBe("lun., 28 sept. 2026, la 13:00");
    expect(emailLeavesWords(tomorrow, NOW, "ro", "short").at).toBe("lun., 28 sept. 2026, la 13:00");
  });

  it("says «now» with the address when the request sends", async () => {
    const ro = await words("ro", "Registration.done");
    const en = await words("en", "Registration.done");
    expect(ro("leavesNow", { email: "ana@example.ro" })).toBe("Emailul către ana@example.ro pleacă acum.");
    expect(en("leavesNow", { email: "ana@example.ro" })).toBe("The email to ana@example.ro leaves now.");
  });

  it("names the club's window under «Da» on the scheduled round and under «imediat», and nothing held at a window of 0", async () => {
    const later = new Date(NOW.getTime() + 15 * 60_000);
    for (const locale of ["ro", "en"] as const) {
      const t = await words(locale, "Registration.sitting");
      const window = locale === "ro" ? "10 minute" : "10 minutes";
      const scheduled = t(offerHint({ atOnce: false, leavesAt: later, now: NOW }), { window, at: "13:15" });
      const immediate = t(offerHint({ atOnce: false, leavesAt: null, now: NOW }), { window });
      const atOnce = t(offerHint({ atOnce: true, leavesAt: later, now: NOW }), { window });
      expect(scheduled).toContain(window);
      expect(immediate).toContain(window);
      expect(atOnce).not.toContain(window);
      for (const sentence of [scheduled, immediate, atOnce]) expect(sentence.length).toBeLessThanOrEqual(200);
    }
    const ro = await words("ro", "Registration.sitting");
    expect(ro("addHint", { window: "10 minute", at: "13:15" })).toBe("Dacă înscrii încă o persoană până la 13:15, emailul îi așteaptă formularul, cel mult 10 minute, și primiți unul singur pentru toți.");
    expect(ro("addHintOn", { window: "10 minute", at: "luni, 28 septembrie, la 13:00" })).toBe(
      "Dacă înscrii încă o persoană până luni, 28 septembrie, la 13:00, emailul îi așteaptă formularul, cel mult 10 minute, și primiți unul singur pentru toți.",
    );
    expect(ro("addHintLeft", { window: "10 minute" })).toBe("Dacă înscrii încă o persoană, următorul email așteaptă cel mult 10 minute după ultimul formular și îi cuprinde pe toți.");
    const en = await words("en", "Registration.sitting");
    expect(en("addHint", { window: "10 minutes", at: "13:15" })).toBe("If you register one more person by 13:15, the email waits for their form, at most 10 minutes, and you get one email for everybody.");
    expect(en("addHintLeft", { window: "10 minutes" })).toBe("If you register one more person, the next email waits at most 10 minutes after the last form and covers everybody.");
    expect(en("addHintAtOnce")).toBe("Each person gets their own email.");
  });
});
