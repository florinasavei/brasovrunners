import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventInputConstraints } from "@/modules/content/events/constraints";
import { waitlistLimitSchema } from "@/modules/content/events/fields";
import { htmlConstraints } from "@/shared/forms/constraints";
import {
  createEvent,
  duplicateEvent,
  repeatEvent,
  saveEventAndTranslations,
  type SeriesEditScope,
} from "@/modules/content/events/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-035-01 (§348) — "Lungimea maximă a listei de așteptare" in the editor: a number beside
 * the places, empty for no limit and 0 for no waiting list, refused below nought by the form, the
 * service and the database alike; left alone by a caller that does not post it; stored as none on
 * an event that takes no registrations here, like the capacity (the mode hides both, §350); and
 * carried by a repeat, a duplicate and a series edit, like the capacity. Lowering it below the
 * line removes nobody.
 */
const NOW = new Date("2026-09-19T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;
let declarationId: string;

const FIELDS = () => ({
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-11T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "INTERNAL",
  participantListVisibility: "HIDDEN" as const,
  capacity: "50",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: declarationId,
  externalProvider: "",
  externalRegistrationUrl: "",
});

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  [organizer] = await db
    .insert(staffUsers)
    .values({ email: "organizer@dev.test", displayName: "Organizer", role: "ADMIN" })
    .returning();
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
  ];
  declarationId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
    now: NOW,
  });
});

async function createDraft(slug = "crosul") {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T06:00:00.000Z"), timezone: ZONE, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values(
    (["ro", "en"] as const).map((locale) => ({ eventId: event.id, locale, slug: `${slug}-${locale}`, title: `Crosul ${locale}`, excerpt: "x" })),
  );
  return event;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function save(eventId: string, version: number, fields: Record<string, unknown>, scope?: SeriesEditScope) {
  return saveEventAndTranslations(db, { actor: organizer, eventId, expectedVersion: version, fields, translations: [], scope, now: NOW });
}

async function refusalOf(operation: Promise<unknown>): Promise<{ code: string; fields: readonly string[] } | null> {
  try {
    await operation;
    return null;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: error.fields };
    throw error;
  }
}

describe("BR-REQ-035-01 saving the waiting list's length (§348)", () => {
  it("stores a number, 0 for no waiting list, and an empty box as no limit", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "10" });
    expect((await reload(event.id)).waitlistCapacity).toBe(10);

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistCapacity: "0" });
    expect((await reload(event.id)).waitlistCapacity).toBe(0);

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistCapacity: "" });
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("refuses what is not a count of people, naming the box, and writes nothing", async () => {
    const event = await createDraft();
    for (const value of ["-1", "2.5", "zece", "100001"]) {
      const refusal = await refusalOf(save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistCapacity: value }));
      expect(refusal?.code, value).toBe("VALIDATION_ERROR");
      expect(refusal?.fields, value).toContain("waitlistCapacity");
    }
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("gives the box the bounds the browser refuses first (§315)", () => {
    expect(eventInputConstraints("waitlistCapacity")).toMatchObject({ type: "number", min: 0, step: 1 });
    expect(eventInputConstraints("waitlistCapacity").required).toBeUndefined();
  });

  it("leaves the length alone when a caller says nothing about it", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "7" });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), distanceMeters: "21000" });
    const row = await reload(event.id);
    expect(row.distanceMeters).toBe(21000);
    expect(row.waitlistCapacity).toBe(7);
  });

  /*
    Since the editor's boxes (§350, extending §111 to the mode), a box the chosen mode hides is
    ignored rather than refused — the capacity first, and the waiting list's length with it, since
    it sits beside the capacity inside "Pe site": a length left behind a switch to "Fără înscrieri"
    is a box the organizer can no longer see, and a refusal would name it. Nothing queues on such
    an event either way: the length is stored as none.
  */
  it("stores no length on an event that takes no registrations here, as it stores no capacity", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "5" });
    await save(event.id, (await reload(event.id)).version, {
      ...FIELDS(),
      registrationMode: "NONE",
      capacity: "40",
      declarationDocumentId: "",
      waitlistCapacity: "5",
    });
    const row = await reload(event.id);
    expect(row.registrationMode).toBe("NONE");
    expect(row.capacity).toBeNull();
    expect(row.waitlistCapacity).toBeNull();
  });

  it("clears it on a group run, which takes nobody's registration (§111)", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "5" });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), type: "GROUP_RUN", waitlistCapacity: "5" });
    const row = await reload(event.id);
    expect(row.registrationMode).toBe("NONE");
    expect(row.waitlistCapacity).toBeNull();
  });

  it("is set by the create form too, and a create that does not post it has no limit", async () => {
    const translations = (slug: string) => ({
      ro: { slug: `${slug}-ro`, title: "Crosul", excerpt: "Cursa clubului." },
      en: { slug: `${slug}-en`, title: "The cross", excerpt: "The club's race." },
    });
    const limited = await createEvent(db, { actor: organizer, fields: { ...FIELDS(), waitlistCapacity: "12", translations: translations("cu-lista") } });
    expect(limited.waitlistCapacity).toBe(12);
    const unlimited = await createEvent(db, { actor: organizer, fields: { ...FIELDS(), translations: translations("fara-lista") } });
    expect(unlimited.waitlistCapacity).toBeNull();
  });

  it("may be lowered below the people already waiting: the save removes nobody", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), capacity: "1", waitlistCapacity: "5" });
    const [person] = await db
      .insert(participants)
      .values({ deliveryEmail: "w@example.test", normalizedEmail: "w@example.test", canonicalEmail: "w@example.test", canonicalizationVersion: 1, defaultName: "W" })
      .returning();
    const [waiting] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: person.id,
        status: "WAITLISTED",
        waitlistedAt: NOW,
        locale: "ro",
        registeredName: "W",
        displayName: "W",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
      })
      .returning();

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), capacity: "1", waitlistCapacity: "0" });
    expect((await reload(event.id)).waitlistCapacity).toBe(0);
    const [after] = await db.select().from(registrations).where(eq(registrations.id, waiting.id));
    expect(after.status).toBe("WAITLISTED");
  });
});

/*
  §NNN — «Lista de așteptare» is a choice in words. The owner typed 0 believing it meant unlimited,
  on a race whose line held twenty people; until now that closed the list. The editor posts the
  answer (`waitlistMode`) beside the number, and the service folds the two into the one stored value
  before its schema reads them: «Nelimitată» null, «Limitată…» the number, «Fără listă» 0 — and a 0
  or an empty box under «Limitată» is unlimited, never "no list".
*/
describe("BR-REQ-035-01 the waiting list as a choice in words (§NNN)", () => {
  it("stores null for «Nelimitată», the number for «Limitată» and 0 for «Fără listă de așteptare»", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "20" });
    expect((await reload(event.id)).waitlistCapacity).toBe(20);

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "NONE", waitlistCapacity: "20" });
    expect((await reload(event.id)).waitlistCapacity).toBe(0);

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "UNLIMITED", waitlistCapacity: "20" });
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("saves «Limitată» with a 0 or an empty box as unlimited, never as no waiting list", async () => {
    const event = await createDraft();
    for (const typed of ["0", "00", " 0 ", "", "   "]) {
      await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "5" });
      expect((await reload(event.id)).waitlistCapacity, typed).toBe(5);
      await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: typed });
      expect((await reload(event.id)).waitlistCapacity, JSON.stringify(typed)).toBeNull();
    }
    // «Limitată» with no number posted at all is the same: no limit.
    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "LIMITED" });
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("stores 0 only by the explicit «Fără listă de așteptare», whatever its hidden box holds", async () => {
    const event = await createDraft();
    for (const typed of ["", "0", "12", "zece", "-3"]) {
      await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "UNLIMITED", waitlistCapacity: "7" });
      await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "NONE", waitlistCapacity: typed });
      expect((await reload(event.id)).waitlistCapacity, typed).toBe(0);
    }
  });

  it("under «Limitată» refuses what is not a count of people, naming the number box", async () => {
    const event = await createDraft();
    for (const value of ["-1", "2.5", "zece", "100001"]) {
      const refusal = await refusalOf(save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: value }));
      expect(refusal?.code, value).toBe("VALIDATION_ERROR");
      expect(refusal?.fields, value).toEqual(["waitlistCapacity"]);
    }
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("refuses an answer that is none of the three, naming the select, and writes nothing", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "9" });
    const refusal = await refusalOf(save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "INFINITE", waitlistCapacity: "" }));
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.fields).toContain("waitlistMode");
    expect((await reload(event.id)).waitlistCapacity).toBe(9);
  });

  it("gives the number under «Limitată» a minimum of one person, while the row keeps 0 for a caller that sends no choice", () => {
    expect(htmlConstraints(waitlistLimitSchema)).toMatchObject({ type: "number", min: 1, max: 100_000, step: 1 });
    expect(htmlConstraints(waitlistLimitSchema).required).toBeUndefined();
    expect(eventInputConstraints("waitlistCapacity")).toMatchObject({ min: 0 });
  });

  it("keeps a service caller that sends only the number on its meaning: empty no limit, 0 no list, N a limit", async () => {
    const event = await createDraft();
    for (const [typed, stored] of [["3", 3], ["0", 0], ["", null]] as const) {
      await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistCapacity: typed });
      expect((await reload(event.id)).waitlistCapacity, typed).toBe(stored);
    }
  });

  it("stores no length behind «Fără înscrieri» or on a group run, whatever the choice says", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "6" });
    await save(event.id, (await reload(event.id)).version, {
      ...FIELDS(),
      registrationMode: "NONE",
      capacity: "",
      declarationDocumentId: "",
      waitlistMode: "NONE",
      waitlistCapacity: "6",
    });
    expect((await reload(event.id)).waitlistCapacity).toBeNull();

    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "6" });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), type: "GROUP_RUN", waitlistMode: "NONE", waitlistCapacity: "6" });
    expect((await reload(event.id)).waitlistCapacity).toBeNull();
  });

  it("is set by the create form's choice, and carried by a series edit and a duplicate as the stored value", async () => {
    const translations = (slug: string) => ({
      ro: { slug: `${slug}-ro`, title: "Crosul", excerpt: "Cursa clubului." },
      en: { slug: `${slug}-en`, title: "The cross", excerpt: "The club's race." },
    });
    const none = await createEvent(db, { actor: organizer, fields: { ...FIELDS(), waitlistMode: "NONE", waitlistCapacity: "", translations: translations("fara") } });
    expect(none.waitlistCapacity).toBe(0);
    const zero = await createEvent(db, { actor: organizer, fields: { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "0", translations: translations("zero") } });
    expect(zero.waitlistCapacity).toBeNull();
    expect((await duplicateEvent(db, { actor: organizer, eventId: none.id })).waitlistCapacity).toBe(0);

    const event = await createDraft("seria");
    await save(event.id, event.version, { ...FIELDS() });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    const source = await reload(event.id);
    await save(source.id, source.version, { ...FIELDS(), waitlistMode: "NONE", waitlistCapacity: "" }, "all");
    for (const date of dates) expect((await reload(date.id)).waitlistCapacity).toBe(0);
    const again = await reload(event.id);
    await save(again.id, again.version, { ...FIELDS(), waitlistMode: "LIMITED", waitlistCapacity: "0" }, "all");
    for (const date of dates) expect((await reload(date.id)).waitlistCapacity).toBeNull();
  });
});

describe("BR-REQ-035-01 the database's own rule (§348)", () => {
  it("accepts null, 0 and a count, and refuses a negative length whatever writes it", async () => {
    const event = await createDraft();
    for (const value of [null, 0, 25]) {
      await db.update(events).set({ waitlistCapacity: value }).where(eq(events.id, event.id));
    }
    await expectViolation(db.execute(sql`UPDATE events SET waitlist_capacity = -1 WHERE id = ${event.id}`), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "events_waitlist_capacity_non_negative",
    });
  });
});

describe("BR-REQ-035-01 the length is the series', like the places (§348)", () => {
  it("is carried onto every repeated date and by a duplicate", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS(), waitlistCapacity: "8" });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.waitlistCapacity).toBe(8);

    const copy = await duplicateEvent(db, { actor: organizer, eventId: event.id });
    expect(copy.waitlistCapacity).toBe(8);
  });

  it("travels with a series edit to every date", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS() });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    expect(dates.every((date) => date.waitlistCapacity === null)).toBe(true);

    const source = await reload(event.id);
    const result = await save(source.id, source.version, { ...FIELDS(), waitlistCapacity: "4" }, "all");
    expect(result.appliedTo).toBe(dates.length);
    for (const date of dates) expect((await reload(date.id)).waitlistCapacity).toBe(4);
  });
});
