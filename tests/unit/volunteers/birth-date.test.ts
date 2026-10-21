import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { ageOn } from "@/modules/registrations/domain/age";
import {
  earliestVolunteerBirthDate,
  latestVolunteerBirthDate,
  refusedFields,
  VOLUNTEER_AGE_MAX,
  VOLUNTEER_MINIMUM_AGE,
  volunteerAgeOn,
  volunteerEventDay,
  volunteerPublicProfileSchemaFor,
  volunteerStaffInputSchemaFor,
} from "@/modules/volunteers/domain/volunteer";
import { bornAgedOn } from "../../helpers/volunteer-birth";

/**
 * §773 — «Data nașterii» instead of the age (the owner, 2026-10-14: «în loc de vârstă vreau să treacă data nașterii»): the pure
 * rules. The age is the date's **on the event's day** — the gun's, else the event's, in the event's own zone — and the minimum
 * (fourteen) and the guardian under eighteen (§768) are judged from it. No database (`tests/integration/volunteers/guardian.test.ts`
 * keeps the same boundaries in the rows).
 */
const ID = "5d7a2f64-3b0c-4f25-9d57-0a9a6b3a1c11";
const EVENT_DAY = "2026-11-21";
const PUBLIC = {
  roleIds: [ID],
  name: "Ana Test",
  email: "ana@example.test",
  phone: "+40712345678",
  message: "",
  locale: "ro",
  consent: true,
  agreement: true,
  sex: "FEMALE",
  city: "Brașov",
};
const GUARDIAN = { guardianName: "Maria Popescu", guardianEmail: "maria@example.test", guardianAware: true };
const STAFF = { roleIds: [ID], assignedRoleIds: [], name: "Ana Test", email: "ana@example.test", phone: "+40712345678", note: "" };

/** The day after a day, `YYYY-MM-DD`. */
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

describe("§773 the day a volunteer's age is counted on", () => {
  const event = { startsAt: new Date("2026-11-21T07:00:00.000Z"), raceStartsAt: null as Date | null, timezone: "Europe/Bucharest", dateToBeAnnounced: false };

  it("is the gun's day when the race has a gun, else the event's day — in the event's own zone", () => {
    const now = new Date("2026-10-14T10:00:00.000Z");
    expect(volunteerEventDay(event, now)).toBe("2026-11-21");
    // A gun on another day than the gathering: the gun's.
    expect(volunteerEventDay({ ...event, raceStartsAt: new Date("2026-11-22T08:00:00.000Z") }, now)).toBe("2026-11-22");
    // Half past midnight in Brașov is the 22nd there and still the 21st in UTC: the event's own zone decides, as the registration form's does.
    expect(volunteerEventDay({ ...event, startsAt: new Date("2026-11-21T22:30:00.000Z") }, now)).toBe("2026-11-22");
    expect(volunteerEventDay({ ...event, timezone: "UTC", startsAt: new Date("2026-11-21T22:30:00.000Z") }, now)).toBe("2026-11-21");
    // A zone left out reads as the club's.
    expect(volunteerEventDay({ ...event, timezone: null }, now)).toBe("2026-11-21");
  });

  it("is today for an event whose date is still to be announced: there is no day to count on yet, and the next save counts again", () => {
    const now = new Date("2026-10-14T10:00:00.000Z");
    expect(volunteerEventDay({ ...event, dateToBeAnnounced: true }, now)).toBe("2026-10-14");
    expect(volunteerEventDay({ ...event, startsAt: null }, now)).toBe("2026-10-14");
  });

  it("is the announced day for an event whose time alone is still to be announced: the public page and the service count on one day", () => {
    const now = new Date("2026-10-14T10:00:00.000Z");
    // The service reads the raw row: the start's instant is there.
    const service = volunteerEventDay(event, now);
    // The public row hides the instant (`unlessDateToBeAnnounced`) but carries the day on the event's own calendar (`announcedDay`).
    const page = volunteerEventDay({ startsAt: null, raceStartsAt: null, timezone: "Europe/Bucharest", dateToBeAnnounced: false, announcedDay: "2026-11-21" }, now);
    expect(page).toBe("2026-11-21");
    expect(page).toBe(service);
    // A date to be announced wins over a day: there is none.
    expect(volunteerEventDay({ startsAt: null, dateToBeAnnounced: true, announcedDay: "2026-11-21" }, now)).toBe("2026-10-14");
  });

  it("bounds the date box by the same day: not younger than the minimum, not older than the ceiling", () => {
    expect(latestVolunteerBirthDate(EVENT_DAY)).toBe("2012-11-21");
    expect(volunteerAgeOn(latestVolunteerBirthDate(EVENT_DAY), EVENT_DAY)).toBe(VOLUNTEER_MINIMUM_AGE);
    expect(volunteerAgeOn(nextDay(latestVolunteerBirthDate(EVENT_DAY)), EVENT_DAY)).toBe(VOLUNTEER_MINIMUM_AGE - 1);
    const earliest = earliestVolunteerBirthDate(EVENT_DAY);
    expect(volunteerAgeOn(earliest, EVENT_DAY)).toBe(VOLUNTEER_AGE_MAX);
    const dayBefore = new Date(Date.parse(`${earliest}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(volunteerAgeOn(dayBefore, EVENT_DAY)).toBe(VOLUNTEER_AGE_MAX + 1);
    // On 29 February the bound is a real day.
    expect(earliestVolunteerBirthDate("2028-02-29")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("§773 the boundary by date, on the public form", () => {
  const open = volunteerPublicProfileSchemaFor(true, EVENT_DAY);
  const closed = volunteerPublicProfileSchemaFor(false, EVENT_DAY);

  it("takes fourteen on the event's day and refuses thirteen — fourteen today or tomorrow counts when the event is after the birthday", () => {
    // 14 «today» (14 October) and «tomorrow» (15 October), with the event on 21 November: fourteen on the event's day.
    for (const today of ["2026-10-14", "2026-10-15"]) {
      const birthDate = bornAgedOn(VOLUNTEER_MINIMUM_AGE, today);
      expect(open.safeParse({ ...PUBLIC, birthDate, ...GUARDIAN }).success, birthDate).toBe(true);
    }
    // The 14th birthday on the day of the event itself: taken. The day after: thirteen on the event's day, refused.
    expect(open.safeParse({ ...PUBLIC, birthDate: bornAgedOn(14, EVENT_DAY), ...GUARDIAN }).success).toBe(true);
    const late = open.safeParse({ ...PUBLIC, birthDate: nextDay(bornAgedOn(14, EVENT_DAY)), ...GUARDIAN });
    expect(late.success).toBe(false);
    if (!late.success) expect(refusedFields(late.error)).toEqual(["birthDate"]);
  });

  it("tells seventeen from eighteen on the event's day: eighteen that very morning is an adult, eighteen tomorrow is a minor", () => {
    const turnsEighteenToday = bornAgedOn(18, EVENT_DAY);
    const turnsEighteenTomorrow = nextDay(turnsEighteenToday);
    // The adult: no guardian asked, and whatever was typed in the guardian's boxes is dropped.
    expect(open.parse({ ...PUBLIC, birthDate: turnsEighteenToday, ...GUARDIAN })).toMatchObject({ age: 18, guardian: null });
    expect(open.parse({ ...PUBLIC, birthDate: turnsEighteenToday })).toMatchObject({ age: 18, guardian: null });
    // The minor: the guardian is asked, each missing box named.
    expect(open.parse({ ...PUBLIC, birthDate: turnsEighteenTomorrow, ...GUARDIAN })).toMatchObject({ age: 17, guardian: { name: "Maria Popescu" } });
    const alone = open.safeParse({ ...PUBLIC, birthDate: turnsEighteenTomorrow });
    expect(alone.success).toBe(false);
    if (!alone.success) expect(refusedFields(alone.error).sort()).toEqual(["guardianAware", "guardianEmail", "guardianName"]);
    // While the club cannot take minors the same day decides: the adult goes in, the minor is refused on the date's box.
    expect(closed.safeParse({ ...PUBLIC, birthDate: turnsEighteenToday }).success).toBe(true);
    const refused = closed.safeParse({ ...PUBLIC, birthDate: turnsEighteenTomorrow });
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refusedFields(refused.error)).toEqual(["birthDate"]);
  });

  it("counts a leap-day birth the way the registration form does: the birthday of a common year is 1 March", () => {
    // Born 29 February 2008: seventeen on 28 February 2026, eighteen from 1 March.
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
    expect(ageOn("2008-02-29", "2028-02-29")).toBe(20);
    for (const [day, minor] of [["2026-02-28", true], ["2026-03-01", false]] as const) {
      const verdict = volunteerPublicProfileSchemaFor(true, day).parse({ ...PUBLIC, birthDate: "29.02.2008", ...GUARDIAN });
      expect(verdict.age, day).toBe(minor ? 17 : 18);
      expect(verdict.guardian === null, day).toBe(!minor);
    }
    // The date itself must be a day: 29 February 2009 is none.
    expect(open.safeParse({ ...PUBLIC, birthDate: "29.02.2009", ...GUARDIAN }).success).toBe(false);
  });

  it("refuses a day that does not exist on the box, in any shape — never a value the database would reject", () => {
    // `1990-02-30` is the posted shape (autofill, a direct POST): it passes the shape and would roll into March in `ageOn`.
    for (const birthDate of ["1990-02-30", "2009-02-31", "30.02.1990", "1990-13-01", "1990-00-10"]) {
      const verdict = open.safeParse({ ...PUBLIC, birthDate, ...GUARDIAN });
      expect(verdict.success, birthDate).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), birthDate).toEqual(["birthDate"]);
    }
  });

  it("derives the age it keeps: the schema's `age` is the date's on the event's day, `birthDate` the day as the box posts it", () => {
    const parsed = open.parse({ ...PUBLIC, birthDate: "11.05.1984" });
    expect(parsed).toMatchObject({ birthDate: "1984-05-11", age: 42 });
    // The posted shape and the typed shape are one date.
    expect(open.parse({ ...PUBLIC, birthDate: "1984-05-11" })).toMatchObject({ birthDate: "1984-05-11", age: 42 });
  });
});

describe("§773 the boundary by date, on the organizers' entry", () => {
  const entry = volunteerStaffInputSchemaFor(EVENT_DAY);

  it("asks a guardian's name of a person who is seventeen on the event's day, none of one who turns eighteen that morning, and nothing of an empty box", () => {
    const turnsEighteenToday = bornAgedOn(18, EVENT_DAY);
    expect(entry.parse({ ...STAFF, birthDate: turnsEighteenToday })).toMatchObject({ age: 18, guardian: null });
    const minor = entry.safeParse({ ...STAFF, birthDate: nextDay(turnsEighteenToday) });
    expect(minor.success).toBe(false);
    if (!minor.success) expect(refusedFields(minor.error)).toEqual(["guardianName"]);
    expect(entry.parse({ ...STAFF, birthDate: nextDay(turnsEighteenToday), guardianName: "Maria" })).toMatchObject({ age: 17, guardian: { name: "Maria", email: null } });
    expect(entry.parse(STAFF)).toMatchObject({ age: null, birthDate: null, guardian: null });
  });

  it("refuses thirteen on the event's day, a day after the event and a date that is none, each on the date's box", () => {
    for (const birthDate of [nextDay(bornAgedOn(14, EVENT_DAY)), "2026-11-22", "2999-01-01", "31.02.1990", "1990-02-30", "2009-02-31", "abc"]) {
      const verdict = entry.safeParse({ ...STAFF, birthDate });
      expect(verdict.success, birthDate).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), birthDate).toEqual(["birthDate"]);
    }
  });
});

describe("§773 the words are in both catalogues, the same keys", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`)) : [prefix.slice(0, -1)];

  it("has every new sentence in Romanian and in English", () => {
    for (const path of [
      "Event.volunteers.choicesNote",
      "Event.volunteers.roleHelp",
      "Event.volunteers.errors.birthDateMinimum",
      "Event.volunteers.errors.birthDateMinors",
      "Event.volunteers.profile.birthDateHelp",
      "Event.volunteers.profile.birthDateHelpMinors",
      "Admin.volunteers.counts.label",
      "Admin.volunteers.counts.help",
      "Admin.volunteers.person.birthDate",
      "Admin.volunteers.person.birthDateHelp",
      "Admin.volunteers.person.birthDateHelpMinors",
      "Admin.volunteers.person.birthDateKept",
      "Admin.volunteers.person.birthDateTooYoung",
      "Admin.volunteers.person.birthDateValue",
      "Admin.volunteers.csvColumns.dateOfBirth",
      "Feedback.toast.volunteersCountsOn",
      "Feedback.toast.volunteersCountsOff",
    ]) {
      for (const [name, catalogue] of [["ro", ro], ["en", en]] as const) {
        const value = path.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], catalogue);
        expect(typeof value, `${name} ${path}`).toBe("string");
        expect((value as string).length, `${name} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the two catalogues' volunteer keys identical, and the retired age sentences gone from both", () => {
    for (const namespace of ["Event", "Admin"] as const) {
      const roKeys = keys((ro as Record<string, Record<string, unknown>>)[namespace].volunteers).sort();
      const enKeys = keys((en as Record<string, Record<string, unknown>>)[namespace].volunteers).sort();
      expect(roKeys, namespace).toEqual(enKeys);
    }
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.volunteers.profile).not.toHaveProperty("age");
      expect(catalogue.Event.volunteers.profile).not.toHaveProperty("ageHelp");
      expect(catalogue.Admin.volunteers.person).not.toHaveProperty("age");
      expect(catalogue.Admin.volunteers.person).not.toHaveProperty("ageHelp");
    }
  });

  it("says the owner's words, and keeps each sentence short enough to read at once", () => {
    for (const note of [ro.Event.volunteers.choicesNote, en.Event.volunteers.choicesNote]) {
      for (const sentence of note.split(/(?<=[.!?])\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(200);
    }
    // The counts' words say what is shown publicly and what is not; the default «mai sunt locuri» is gone (§780, amended): a role shown has places.
    expect(ro.Event.volunteers.needs).not.toHaveProperty("open");
    expect(en.Event.volunteers.needs).not.toHaveProperty("open");
    expect(ro.Event.volunteers.roleHelp).toBe("Ce presupune rolul {name}");
    expect(en.Event.volunteers.roleHelp).toBe("What the role {name} involves");
  });
});
