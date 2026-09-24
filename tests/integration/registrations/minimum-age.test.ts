import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { cancelRegistrationByStaff, createRegistrationByStaff } from "@/modules/registrations/admin-service";
import { ageOn } from "@/modules/registrations/domain/age";
import { UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §321 — a participant is at least fourteen on the day of the event.
 *
 * The owner, 2026-09-23: "Min age must be 14". Every door a registration can come through is
 * tried here — the public form, a staff entry and the desk's walk-in, a TEST row, a restart of a
 * cancelled registration — because the rule sits in `submitRegistration`, the one door they all
 * share, and a rule proven on one caller is a rule the next caller can walk round.
 *
 * The race is on 21 November 2026 in Brașov. Somebody born on 21 November 2012 is fourteen that
 * morning and may enter; somebody born the day after is thirteen and may not. The guardian rule
 * is untouched (§108): fourteen to seventeen still register through a parent.
 *
 * §329 — the owner, the same day: "actually this min age must be set at event level!". The
 * number is the event's own `events.min_age` now, fourteen by default; the last blocks below try
 * an event that asks for more, one that asks for nothing, and one that never said.
 */
const NOW = new Date("2026-09-23T10:00:00.000Z");
const RACE_START = new Date("2026-11-21T07:00:00.000Z"); // 09:00 in Brașov
const FOURTEEN_ON_RACE_DAY = "2012-11-21";
const FOURTEEN_THE_DAY_AFTER = "2012-11-22";

let db: TestDatabase;
let close: () => Promise<void>;
let volunteer: StaffUser;
let admin: StaffUser;

/*
  The staff form's action, for the one thing only the action decides: what the refusal says.
  Getters, resolved when the action calls them (`signature-name.test.ts` does the same): the
  database under test, and the Voluntar at the desk as the signed-in staff member.
*/
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => volunteer,
  requireStaffRole: async () => admin,
}));

const { createRegistrationAction } = await import("@/app/[locale]/admin/registrations/actions");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
  }
  [volunteer] = await db
    .insert(staffUsers)
    // The Voluntar (§103): the desk only, which is exactly who enters a walk-in on race morning.
    .values({ email: "voluntar@dev.test", displayName: "Voluntar", role: "CONTRIBUTOR" })
    .returning();
  [admin] = await db
    .insert(staffUsers)
    .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
});

/**
 * A race taking registrations here. `minAge` left out writes nothing to the column, so the row
 * carries the database's default — what every event created before §329 was given — and the
 * returned object passes on whatever the row holds, as the three callers that submit do.
 */
async function createRace(startsAt = RACE_START, timezone = "Europe/Bucharest", minAge?: number): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt,
      timezone,
      registrationMode: "INTERNAL",
      capacity: 50,
      ...(minAge === undefined ? {} : { minAge }),
    })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: event.capacity,
    raceId: null,
    publishedAt: NOW,
    timezone: event.timezone,
    minAge: event.minAge,
  };
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Maria",
  lastName: "Popescu",
  birthDate: FOURTEEN_THE_DAY_AFTER,
  sex: "FEMALE",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  guardianName: "Ion Popescu",
  email: "maria@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  ...overrides,
});

/** The refusal's code and the names it carries back to the form, or null when nothing refused. */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; fields: string[] } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { code: error.code, fields: [...error.fields] };
  }
}

async function nothingWritten() {
  expect(await db.select().from(registrations)).toHaveLength(0);
  expect(await db.select().from(participants)).toHaveLength(0);
  expect(await db.select().from(emailOutbox)).toHaveLength(0);
  // Refused before the throttle, so a mistyped year does not spend one of five attempts.
  expect(await db.select().from(rateLimitBuckets)).toHaveLength(0);
}

describe("§321 the public form", () => {
  it("refuses somebody who is thirteen on the race day, names the birth date, and writes nothing", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission(), NOW));
    expect(refused?.code).toBe("VALIDATION_ERROR");
    // The field, so the summary links to it, and the marker, so it says which rule (§231's shape).
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
    await nothingWritten();
  });

  it("names every other field at once, rather than the age first and the rest a round trip later", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission({ city: "" }), NOW));
    expect(refused?.fields).toEqual(expect.arrayContaining(["city", "birthDate", UNDER_MINIMUM_AGE]));
    await nothingWritten();
  });

  it("accepts somebody whose fourteenth birthday is the race day — still through a parent", async () => {
    const event = await createRace();
    expect(await refusal(submitRegistration(db, event, submission({ birthDate: FOURTEEN_ON_RACE_DAY }), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe(FOURTEEN_ON_RACE_DAY);
    expect(row.guardianName).toBe("Ion Popescu");
  });

  it("keeps the guardian rule as it was: fourteen to seventeen without a parent is refused for the parent", async () => {
    const event = await createRace();
    const refused = await refusal(
      submitRegistration(db, event, submission({ birthDate: "2011-05-17", guardianName: undefined }), NOW),
    );
    expect(refused?.fields).toEqual(["guardianName"]);
  });

  it("counts the day in the race's own zone, not in UTC", async () => {
    // 00:30 in Brașov on 21 November is 22:30 UTC on the 20th. On the start line it is the 21st,
    // the fourteenth birthday, so the entry stands — by the UTC date it would have been refused.
    const midnightRace = await createRace(new Date("2026-11-20T22:30:00.000Z"));
    expect(
      await refusal(submitRegistration(db, midnightRace, submission({ birthDate: FOURTEEN_ON_RACE_DAY }), NOW)),
    ).toBeNull();

    // The same instant read in UTC is the 20th, and then the same child is thirteen.
    const utcRace = await createRace(new Date("2026-11-20T22:30:00.000Z"), "UTC");
    const refused = await refusal(
      submitRegistration(db, utcRace, submission({ birthDate: FOURTEEN_ON_RACE_DAY, email: "alta@example.ro" }), NOW),
    );
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
  });
});

describe("§321 a TEST registration is refused exactly like a real one (AGENTS.md §12.6)", () => {
  it("refuses a thirteen-year-old TEST row and writes nothing", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission(), NOW, "TEST"));
    expect(refused).toEqual({ code: "VALIDATION_ERROR", fields: ["birthDate", UNDER_MINIMUM_AGE] });
    await nothingWritten();
  });
});

describe("§321 a staff entry and the desk's walk-in", () => {
  const staffEntry = (event: EventForRegistration, birthDate: string | undefined, fastTrack = false, guardianName?: string) => ({
    eventId: event.id,
    firstName: "Andrei",
    lastName: "Ionescu",
    details: birthDate ? { birthDate, guardianName } : {},
    email: `andrei-${birthDate ?? "none"}-${fastTrack}@example.ro`,
    locale: "ro" as const,
    listOptOut: true,
    relayedByParticipantRequest: true,
    fastTrack,
  });

  it("refuses a birth date under fourteen on the race day, at the desk as on the telephone", async () => {
    const event = await createRace();
    for (const fastTrack of [false, true]) {
      const refused = await refusal(
        createRegistrationByStaff(db, volunteer, staffEntry(event, FOURTEEN_THE_DAY_AFTER, fastTrack), NOW),
      );
      // The marker is what the backoffice turns into its own sentence (`UNDER_MINIMUM_AGE`).
      expect(refused?.code).toBe("VALIDATION_ERROR");
      expect(refused?.fields).toContain(UNDER_MINIMUM_AGE);
    }
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("does not refuse fourteen on the race day for age, and takes the minor with a parent named", async () => {
    const event = await createRace();
    /*
      The staff schema carries the guardian rule of §108 as the public one does, and since §324
      the staff form asks for the parent once the birth date says under eighteen. Without the
      name the refusal is about `guardianName` and never about age; with it the fourteen-year-old
      is entered at the desk, the parent on the row. An adult's entry goes all the way too.
    */
    const refused = await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, FOURTEEN_ON_RACE_DAY, true), NOW));
    expect(refused?.fields ?? []).not.toContain(UNDER_MINIMUM_AGE);
    expect(refused?.fields).toContain("guardianName");
    expect(
      await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, FOURTEEN_ON_RACE_DAY, true, "Maria Ionescu"), NOW)),
    ).toBeNull();
    const [minor] = await db.select().from(registrations).where(eq(registrations.birthDate, FOURTEEN_ON_RACE_DAY));
    expect(minor.guardianName).toBe("Maria Ionescu");

    expect(await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, "1990-05-17", true, "Nobody"), NOW))).toBeNull();
    const [adult] = await db.select().from(registrations).where(eq(registrations.birthDate, "1990-05-17"));
    // An adult's stray parent names nobody (§108).
    expect(adult.guardianName).toBeNull();
  });

  it("carries the parent's box from the staff form to the row (§324)", async () => {
    const event = await createRace();
    const form = new FormData();
    for (const [name, value] of Object.entries({
      uiLocale: "ro",
      back: "desk",
      eventId: event.id,
      firstName: "Andrei",
      lastName: "Ionescu",
      birthDate: FOURTEEN_ON_RACE_DAY,
      guardianName: "Maria Ionescu",
      email: "andrei-parent@example.ro",
      participantLocale: "ro",
      relayedByParticipantRequest: "on",
    })) {
      form.set(name, value);
    }

    // A success answers with a redirect, which Next.js throws; a refusal would return instead.
    const outcome = await createRegistrationAction(null, form).catch((error: unknown) => {
      if (String((error as { digest?: unknown } | null)?.digest ?? "").startsWith("NEXT_REDIRECT")) return null;
      throw error;
    });

    expect(outcome).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe(FOURTEEN_ON_RACE_DAY);
    expect(row.guardianName).toBe("Maria Ionescu");
  });

  it("accepts an entry that gives no birth date: nothing to count, and BR-REQ-031-04 criterion 5 stands", async () => {
    const event = await createRace();
    expect(await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, undefined), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBeNull();
  });

  it("comes back to the staff form with the rule's own sentence, the birth date named, and every box kept", async () => {
    /*
      The form keeps what was typed (§315) through `refused`, which carries the service's code
      and field names as they are — so without the action's own mapping the volunteer would read
      the generic VALIDATION_ERROR, and the summary would list the rule's marker as if it were a
      box, under its raw name. The sentence is `Admin.errors.UNDER_MINIMUM_AGE`; the marker is
      not a box, so it is not a link.
    */
    const event = await createRace();
    const form = new FormData();
    for (const [name, value] of Object.entries({
      uiLocale: "ro",
      back: "desk",
      eventId: event.id,
      firstName: "Andrei",
      lastName: "Ionescu",
      birthDate: FOURTEEN_THE_DAY_AFTER,
      city: "Brașov",
      email: "andrei@example.ro",
      participantLocale: "ro",
      relayedByParticipantRequest: "on",
    })) {
      form.set(name, value);
    }

    const outcome = await createRegistrationAction(null, form);

    expect(outcome?.error).toBe("UNDER_MINIMUM_AGE");
    expect(outcome?.fields).toContain("birthDate");
    expect(outcome?.fields).not.toContain(UNDER_MINIMUM_AGE);
    // `guardianName` is named as well — §108's rule, and since §324 a box the staff form shows
    // once the birth date says under eighteen; hence `toContain` above.
    expect(outcome?.values).toMatchObject({
      eventId: [event.id],
      firstName: ["Andrei"],
      birthDate: [FOURTEEN_THE_DAY_AFTER],
      city: ["Brașov"],
      email: ["andrei@example.ro"],
    });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });
});

describe("§321 a restart of a cancelled registration", () => {
  it("is refused under fourteen, and the cancelled row keeps what it had", async () => {
    const event = await createRace();
    await submitRegistration(db, event, submission({ birthDate: "1990-05-17", guardianName: undefined }), NOW);
    const [first] = await db.select().from(registrations);
    // A pending email confirmation expires rather than being cancelled; one step on, it can be.
    await confirmEmail(db, event, first.id, NOW);
    await cancelRegistrationByStaff(db, admin, first.id, "a doua încercare", NOW);

    // The same address, back with a child's birth date: the one door is the same door.
    const later = new Date(NOW.getTime() + 60_000);
    const refused = await refusal(
      submitRegistration(db, event, submission({ renderedAt: new Date(later.getTime() - 10_000).toISOString() }), later),
    );
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);

    const [after] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(after.status).toBe("CANCELLED");
    expect(after.birthDate).toBe("1990-05-17");
  });
});

/*
  §329 — the number is the event's. The race is still on 21 November 2026 in Brașov; the birth
  dates below are each the last day that reaches a number on that morning, or the day after it.
*/
const SIXTEEN_ON_RACE_DAY = "2010-11-21";
const FIFTEEN_ON_RACE_DAY = "2010-11-22";
/** Adults on the day of submission, so §108's guardian rule is not what a refusal is about. */
const TWENTY_ONE_ON_RACE_DAY = "2005-11-21";
const TWENTY_ON_RACE_DAY = "2005-11-22";

const staffEntryFor = (event: EventForRegistration, birthDate: string, fastTrack: boolean) => ({
  eventId: event.id,
  firstName: "Andrei",
  lastName: "Ionescu",
  details: { birthDate },
  email: `andrei-${birthDate}-${fastTrack}-${event.id.slice(0, 8)}@example.ro`,
  locale: "ro" as const,
  listOptOut: true,
  relayedByParticipantRequest: true,
  fastTrack,
});

describe("§329 an event with a minimum of its own", () => {
  it("refuses fifteen on the race day at an event that asks for sixteen, names the birth date, and writes nothing", async () => {
    const event = await createRace(RACE_START, "Europe/Bucharest", 16);
    const refused = await refusal(submitRegistration(db, event, submission({ birthDate: FIFTEEN_ON_RACE_DAY }), NOW));
    expect(refused).toEqual({ code: "VALIDATION_ERROR", fields: ["birthDate", UNDER_MINIMUM_AGE] });
    await nothingWritten();
  });

  it("takes somebody whose sixteenth birthday is the race day — still through a parent (§108)", async () => {
    const event = await createRace(RACE_START, "Europe/Bucharest", 16);
    expect(await refusal(submitRegistration(db, event, submission({ birthDate: SIXTEEN_ON_RACE_DAY }), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe(SIXTEEN_ON_RACE_DAY);
    expect(row.guardianName).toBe("Ion Popescu");
  });

  it("counts the event's number, not the club's fourteen: the same child the default would take", async () => {
    // Fifteen on the day is fourteen-plus, so the default takes them; sixteen does not.
    const club = await createRace();
    const older = await createRace(RACE_START, "Europe/Bucharest", 16);
    expect(await refusal(submitRegistration(db, club, submission({ birthDate: FIFTEEN_ON_RACE_DAY }), NOW))).toBeNull();
    const refused = await refusal(
      submitRegistration(db, older, submission({ birthDate: FIFTEEN_ON_RACE_DAY, email: "alta@example.ro" }), NOW),
    );
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
  });

  it("refuses a TEST row under the event's number exactly as a real one (AGENTS.md §12.6)", async () => {
    const event = await createRace(RACE_START, "Europe/Bucharest", 21);
    const refused = await refusal(
      submitRegistration(db, event, submission({ birthDate: TWENTY_ON_RACE_DAY, guardianName: undefined }), NOW, "TEST"),
    );
    expect(refused).toEqual({ code: "VALIDATION_ERROR", fields: ["birthDate", UNDER_MINIMUM_AGE] });
    await nothingWritten();
  });

  it("gives a TEST batch on a race that asks for forty a made-up entrant who is forty on the day", async () => {
    /*
      "Add test registrations" types its own birth date. Left at 1990 it would be thirty-six on
      this race — refused, for a reason no rehearsal is about. The rule is not relaxed; the
      made-up fact is chosen to meet it (`test-registrations.ts#syntheticBirthDate`).
    */
    const [row] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: RACE_START, registrationMode: "INTERNAL", capacity: 50, minAge: 40, publishedAt: NOW })
      .returning();
    expect(await addTestRegistrations(db, admin, { eventId: row.id, count: 2, now: NOW })).toEqual({ created: 2 });
    const rows = await db.select().from(registrations);
    expect(rows).toHaveLength(2);
    for (const registration of rows) {
      expect(registration.kind).toBe("TEST");
      expect(ageOn(registration.birthDate as string, "2026-11-21")).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("§329 an event with no minimum", () => {
  it("takes anyone the birth-date range allows — a six-year-old, through a parent", async () => {
    const event = await createRace(RACE_START, "Europe/Bucharest", 0);
    expect(await refusal(submitRegistration(db, event, submission({ birthDate: "2020-03-01" }), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe("2020-03-01");
    expect(row.guardianName).toBe("Ion Popescu");
  });

  it("still refuses a birth date outside the range (BR-REQ-031-04 criterion 4), for the date and never for the age", async () => {
    const event = await createRace(RACE_START, "Europe/Bucharest", 0);
    for (const birthDate of ["2027-01-01", "1890-01-01"]) {
      const refused = await refusal(submitRegistration(db, event, submission({ birthDate }), NOW));
      expect(refused?.fields, birthDate).toContain("birthDate");
      expect(refused?.fields, birthDate).not.toContain(UNDER_MINIMUM_AGE);
    }
    await nothingWritten();
  });
});

describe("§329 an event that never said", () => {
  it("was given fourteen by the column's default, and fourteen is what every door counts", async () => {
    // Inserted without the column, as every event that existed before it was.
    const event = await createRace();
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.minAge).toBe(14);

    // The staff door reads the row itself (`admin-service.ts#eventForRegistration`).
    const refused = await refusal(createRegistrationByStaff(db, volunteer, staffEntryFor(event, FOURTEEN_THE_DAY_AFTER, true), NOW));
    expect(refused?.fields).toContain(UNDER_MINIMUM_AGE);
    const onTheDay = await refusal(createRegistrationByStaff(db, volunteer, staffEntryFor(event, FOURTEEN_ON_RACE_DAY, true), NOW));
    expect(onTheDay?.fields ?? []).not.toContain(UNDER_MINIMUM_AGE);
  });
});

describe("§329 a staff entry and the desk's walk-in follow the chosen event", () => {
  it("refuses twenty at a race that asks for twenty-one and takes the same person at one that asks for nothing", async () => {
    const adultsOnly = await createRace(RACE_START, "Europe/Bucharest", 21);
    const open = await createRace(RACE_START, "Europe/Bucharest", 0);
    for (const fastTrack of [false, true]) {
      const refused = await refusal(
        createRegistrationByStaff(db, volunteer, staffEntryFor(adultsOnly, TWENTY_ON_RACE_DAY, fastTrack), NOW),
      );
      expect(refused?.code).toBe("VALIDATION_ERROR");
      expect(refused?.fields).toContain(UNDER_MINIMUM_AGE);
      expect(await refusal(createRegistrationByStaff(db, volunteer, staffEntryFor(open, TWENTY_ON_RACE_DAY, fastTrack), NOW))).toBeNull();
    }
    const rows = await db.select().from(registrations);
    expect(rows.map((row) => row.eventId)).toEqual([open.id, open.id]);
  });

  it("takes twenty-one on the race day at the race that asks for twenty-one", async () => {
    const adultsOnly = await createRace(RACE_START, "Europe/Bucharest", 21);
    expect(
      await refusal(createRegistrationByStaff(db, volunteer, staffEntryFor(adultsOnly, TWENTY_ONE_ON_RACE_DAY, true), NOW)),
    ).toBeNull();
  });

  it("comes back to the staff form naming the chosen event's number, in the backoffice's language", async () => {
    const adultsOnly = await createRace(RACE_START, "Europe/Bucharest", 21);
    const formFor = (uiLocale: "ro" | "en") => {
      const form = new FormData();
      for (const [name, value] of Object.entries({
        uiLocale,
        back: "desk",
        eventId: adultsOnly.id,
        firstName: "Andrei",
        lastName: "Ionescu",
        birthDate: TWENTY_ON_RACE_DAY,
        email: "andrei@example.ro",
        participantLocale: "ro",
        relayedByParticipantRequest: "on",
      })) {
        form.set(name, value);
      }
      return form;
    };

    const romanian = await createRegistrationAction(null, formFor("ro"));
    expect(romanian?.error).toBe("UNDER_MINIMUM_AGE");
    // "21 de ani": the sentence's `{age}`, in the words `yearsPhrase` gives the number.
    expect(romanian?.errorValues).toEqual({ age: "21 de ani" });
    expect(romanian?.fields).toEqual(["birthDate"]);
    expect(romanian?.values).toMatchObject({ eventId: [adultsOnly.id], birthDate: [TWENTY_ON_RACE_DAY] });

    const english = await createRegistrationAction(null, formFor("en"));
    expect(english?.errorValues).toEqual({ age: "21 years" });

    expect(await db.select().from(registrations)).toHaveLength(0);
  });
});
