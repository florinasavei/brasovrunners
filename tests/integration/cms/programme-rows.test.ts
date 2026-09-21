import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 criterion 13 (`DECISIONS.md` §117) — the programme as rows, saved through the
 * editor: wall-clock boxes in the event's zone become instants, a blank row is the spare line,
 * a half row is refused by its number, a group run stores none, and a repeated event carries
 * its rows to each occurrence at the same wall time.
 */
const NOW = new Date("2026-09-19T10:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
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
  registrationMode: "NONE",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const ROWS = [
  { date: "2026-10-11", time: "10:00", endTime: "", ro: "Start", en: "Start", place: "" },
  { date: "2026-10-10", time: "16:00", endTime: "19:00", ro: "Ridicarea kiturilor", en: "Kit pickup", place: "Cortul de start" },
  { date: "", time: "", endTime: "", ro: "", en: "", place: "" },
];

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;

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
});

async function createDraft(type: "RACE" | "GROUP_RUN" = "RACE") {
  const [event] = await db
    .insert(events)
    .values({ type, startsAt: new Date("2026-10-11T06:00:00.000Z"), timezone: "Europe/Bucharest", locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values(
    (["ro", "en"] as const).map((locale) => ({ eventId: event.id, locale, slug: `crosul-${locale}`, title: `Crosul ${locale}`, excerpt: "x" })),
  );
  return event;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

async function save(eventId: string, version: number, fields: Record<string, unknown>) {
  await saveEventAndTranslations(db, { actor: organizer, eventId, expectedVersion: version, fields, translations: [], now: NOW });
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return `${error.code}: ${error.message}`;
    throw error;
  }
}

describe("BR-REQ-050-02 criterion 13 — the programme's rows", () => {
  it("stores the rows as instants in the event's zone, soonest first, and drops the blank line", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, scheduleRows: ROWS });
    const rows = readScheduleItems((await reload(event.id)).scheduleItems);
    expect(rows).toEqual([
      { startsAt: "2026-10-10T13:00:00.000Z", endsAt: "2026-10-10T16:00:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Cortul de start" },
      { startsAt: "2026-10-11T07:00:00.000Z", endsAt: null, label: { ro: "Start", en: "Start" }, place: null },
    ]);
  });

  it("refuses a half-filled row by its number, and an end before its start", async () => {
    const event = await createDraft();
    expect(await codeOf(save(event.id, event.version, { ...FIELDS, scheduleRows: [ROWS[0], { ...ROWS[1], en: "" }] }))).toContain("schedule[2]: the label is needed in both languages");
    expect(await codeOf(save(event.id, event.version, { ...FIELDS, scheduleRows: [{ ...ROWS[1], time: "" }] }))).toContain("schedule[1]: a date and time are required");
    expect(await codeOf(save(event.id, event.version, { ...FIELDS, scheduleRows: [{ ...ROWS[1], endTime: "15:00" }] }))).toContain("schedule[1]: the end cannot be before the start");
    expect((await reload(event.id)).scheduleItems).toBeNull();
  });

  it("stores no rows on a group run, whatever the hidden boxes posted (§111)", async () => {
    const event = await createDraft("GROUP_RUN");
    await save(event.id, event.version, { ...FIELDS, type: "GROUP_RUN", scheduleRows: ROWS });
    expect((await reload(event.id)).scheduleItems).toBeNull();
  });

  it("clears the rows when every line is removed", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, scheduleRows: ROWS });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS, scheduleRows: [] });
    expect((await reload(event.id)).scheduleItems).toBeNull();
  });

  it("carries the rows onto each repeated occurrence at the same wall time, across the clock change", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, scheduleRows: ROWS });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-10", publish: false }, now: NOW });
    const copies = (await db.select().from(events).orderBy(events.startsAt)).filter((row) => row.id !== event.id);
    expect(copies).toHaveLength(4);
    // Four weeks on is 8 November, after the clocks went back: 10:00 EET is 08:00Z, not 07:00Z.
    const fourth = readScheduleItems(copies[3].scheduleItems);
    expect(fourth.map((row) => row.startsAt)).toEqual(["2026-11-07T14:00:00.000Z", "2026-11-08T08:00:00.000Z"]);
    expect(fourth[0].label).toEqual({ ro: "Ridicarea kiturilor", en: "Kit pickup" });
  });
});
