import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, delete: () => undefined, get: () => undefined }),
}));

const {
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
  it("says the newest email names the family while there is a window, and each person's own at a window of 0 — in both catalogues", async () => {
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"] })).toBe("family");
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"], atOnce: false })).toBe("family");
    expect(doneFamilySentence({ names: ["Ana Pop", "Ion Pop"], atOnce: true })).toBe("familyEach");
    expect(doneFamilySentence({ names: ["Ana Pop"], atOnce: true })).toBeNull();
    expect(doneFamilySentence(null)).toBeNull();
    const ro = (await import("../../../messages/ro.json")).default as { Registration: { done: Record<string, unknown>; sitting: Record<string, string> } };
    const en = (await import("../../../messages/en.json")).default as { Registration: { done: Record<string, unknown>; sitting: Record<string, string> } };
    expect(ro.Registration.done.familyEach).toBe("Fiecare persoană primește emailul ei.");
    expect(en.Registration.done.familyEach).toBe("Each person gets their own email.");
    // One question, one answer (§NNN): no «Gata» to press, no promise of an email held for one.
    expect(ro.Registration.sitting.question).toBe("Mai înscrii pe cineva cu aceeași adresă?");
    expect(ro.Registration.sitting.addHint).toContain("{window}");
    expect(en.Registration.sitting.addHint).toContain("{window}");
    expect(ro.Registration.sitting).not.toHaveProperty("done");
    expect(en.Registration.sitting).not.toHaveProperty("done");
    expect(ro.Registration.done.family).toContain("Cel mai nou email");
    expect(en.Registration.done.family).toContain("The newest email");
  });

  it("keeps the browser's half two minutes past the window, and the window the action read", () => {
    expect(SITTING_COOKIE_GRACE_MINUTES).toBe(2);
    expect(sittingCookieMaxAgeSeconds(new Date(NOW.getTime() + 600_000), NOW)).toBe(600 + 120);
    expect(sittingCookieMaxAgeSeconds(new Date(NOW.getTime() - 60_000), NOW)).toBe(60);
    const cookie = {
      sittingId: null,
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
