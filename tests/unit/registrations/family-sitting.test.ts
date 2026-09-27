import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, delete: () => undefined, get: () => undefined }),
}));

const {
  isFamilySitting,
  sittingCookieLive,
  sittingEntryFor,
  sittingLinkExpiresAt,
  sittingNames,
  sittingSharedValues,
  withSittingPerson,
  SITTING_NAMES_MAX,
} = await import("@/modules/registrations/domain/family-sitting");
const { openFamilySittingCookie, sealFamilySittingCookie } = await import("@/modules/registrations/family-sitting-cookie");
const { openFormDraft } = await import("@/modules/registrations/form-draft");
const { declarationStateKey } = await import("@/modules/registrations/domain/family-signing");
const { buildOutgoingEmail } = await import("@/modules/notifications/templates");
const { DEADLINE_RULES, familySittingHeldUntil } = await import("@/modules/deadlines/domain/deadlines");

/**
 * §NNN — a family registered in one sitting, with one email: the pure half. What the browser keeps,
 * when the messages become one, who a second form in the sitting is about, how long the family's link
 * lives, the family message's own shape, and each person's declaration on «Toate înscrierile mele».
 */
const NOW = new Date("2026-09-27T10:00:00.000Z");
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

describe("§NNN the browser's half of a sitting", () => {
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
    const first = sittingSharedValues(undefined, posted({ city: "Brașov", nationality: "RO", firstName: "Ana", phone: "722000000", emergencyContactName: "Dan Pop" }));
    expect(first).toEqual({ city: "Brașov", nationality: "RO", emergencyContactName: "Dan Pop" });
    // The person's own boxes are never carried.
    expect(first).not.toHaveProperty("firstName");
    expect(first).not.toHaveProperty("phone");
    // A child's form adds the guardian; an adult's blank guardian keeps it.
    const second = sittingSharedValues(first, posted({ city: "Brașov", nationality: "RO", guardianName: "Ana Pop" }));
    expect(sittingSharedValues(second, posted({ city: "Codlea" }))).toEqual({ city: "Codlea", nationality: "RO", guardianName: "Ana Pop", emergencyContactName: "Dan Pop" });
  });
});

describe("§NNN the sitting's decisions", () => {
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

  it("waits the club's window from the last form: fifteen minutes unless set, between five and sixty", () => {
    expect(DEADLINE_RULES.familySittingMinutes).toEqual({ unit: "minutes", min: 5, max: 60, default: 15 });
    expect(familySittingHeldUntil(NOW, { familySittingMinutes: 15 }).getTime() - NOW.getTime()).toBe(900_000);
  });
});

describe("§NNN the family message", () => {
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

describe("§NNN each person's declaration on «Toate înscrierile mele»", () => {
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
