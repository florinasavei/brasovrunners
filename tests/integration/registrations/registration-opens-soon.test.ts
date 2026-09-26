import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { registrationState } from "@/modules/events/domain/registration-window";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { queueRegistrationOpenedMessages, registerInterest } from "@/modules/registrations/interest";
import { publicFormEvent } from "@/modules/registrations/public-form-event";
import { submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-011-01 (§451) — «Înscrierile se deschid în curând», an opening announced with no date.
 *
 * The owner, 2026-09-26: "vreau să scriu și că «înscrierile se deschid în curând» fără să pun o
 * dată anume". What is protected: the switch is saved from the editor and refused beside a date;
 * while it is on nobody registers, whatever the clock says, and the public row carries it so every
 * surface says "soon"; the "Anunță-mă" box keeps taking addresses; switching it off opens the
 * window at once and the next run announces it to those addresses; a caller that did not post it
 * changes nothing; an event that takes no registration here stores it off; a series carries it.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const LATER = new Date("2026-10-20T09:00:00.000Z");
const ZONE = "Europe/Bucharest";

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;
let declarationId: string;

const FIELDS = () => ({
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-11-21T09:00",
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
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "ADMIN" }).returning();
  const approve = async (key: "EVENT_DECLARATION" | "PRIVACY_NOTICE") => {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    return insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  };
  declarationId = await approve("EVENT_DECLARATION");
  await approve("PRIVACY_NOTICE");
});

async function createPublished(slug = "crosul") {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      timezone: ZONE,
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity: 50,
      declarationDocumentId: declarationId,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values(
    (["ro", "en"] as const).map((locale) => ({
      eventId: event.id,
      locale,
      slug: `${slug}-${locale}`,
      title: `Crosul ${locale}`,
      excerpt: "x",
      editorialStatus: "PUBLISHED" as const,
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    })),
  );
  return event;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function save(eventId: string, version: number, fields: Record<string, unknown>) {
  return saveEventAndTranslations(db, { actor: organizer, eventId, expectedVersion: version, fields, translations: [], now: NOW });
}

async function refusalOf(operation: Promise<unknown>): Promise<{ code: string; fields: readonly string[]; message: string } | null> {
  try {
    await operation;
    return null;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: error.fields, message: error.message };
    throw error;
  }
}

describe("BR-REQ-011-01 «Înscrierile se deschid în curând» (§451)", () => {
  it("saves the switch from the editor and refuses it beside an opening date, naming the date's box", async () => {
    const event = await createPublished();
    await save(event.id, event.version, { ...FIELDS(), registrationOpensSoon: true });
    expect((await reload(event.id)).registrationOpensSoon).toBe(true);

    const refusal = await refusalOf(
      save(event.id, (await reload(event.id)).version, { ...FIELDS(), registrationOpensSoon: true, registrationOpensAtWallTime: "2026-10-10T10:00" }),
    );
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.fields).toContain("registrationOpensAt");
    expect((await reload(event.id)).registrationOpensAt).toBeNull();
  });

  it("leaves the switch alone for a caller that did not post it, and stores it off where the site takes no registration", async () => {
    const event = await createPublished();
    await save(event.id, event.version, { ...FIELDS(), registrationOpensSoon: true });
    // A script or an older form that never mentions it does not open the door.
    await save(event.id, (await reload(event.id)).version, FIELDS());
    expect((await reload(event.id)).registrationOpensSoon).toBe(true);

    // Registration elsewhere: there is no door of ours to hold shut.
    await save(event.id, (await reload(event.id)).version, {
      ...FIELDS(),
      registrationMode: "EXTERNAL",
      externalRegistrationUrl: "https://forms.example/x",
      registrationOpensSoon: true,
    });
    expect((await reload(event.id)).registrationOpensSoon).toBe(false);
  });

  it("keeps the door shut whatever the clock says, on the public row and at the allocator", async () => {
    const event = await createPublished();
    await save(event.id, event.version, { ...FIELDS(), registrationOpensSoon: true });

    const row = await findPublishedEventBySlug(db, "ro", "crosul-ro");
    expect(row?.registrationOpensSoon).toBe(true);
    expect(registrationState(row!, NOW)).toBe("NOT_YET_OPEN");
    expect(registrationState(row!, LATER)).toBe("NOT_YET_OPEN");

    const stored = await reload(event.id);
    const refused = await refusalOf(submitRegistration(db, publicFormEvent(stored, stored.publishedAt), {}, LATER));
    expect(refused?.code).toBe("VALIDATION_ERROR");
    expect(refused?.message).toMatch(/NOT_YET_OPEN/);
  });

  it("takes «Anunță-mă» addresses while it is on, and announces them the run after the switch goes off", async () => {
    const event = await createPublished();
    await save(event.id, event.version, { ...FIELDS(), registrationOpensSoon: true });
    const rendered = new Date(NOW.getTime() - 60_000).toISOString();
    await registerInterest(db, (await findPublishedEventBySlug(db, "ro", "crosul-ro"))!, { email: "ana@example.ro", locale: "ro", renderedAt: rendered }, NOW);
    expect(await db.select().from(registrationInterests)).toHaveLength(1);

    // No date to reach: a run weeks later still waits.
    expect(await queueRegistrationOpenedMessages(db, LATER)).toEqual({ queued: 0, dropped: 0 });

    // The organizer opens it: no date typed, so it is open from the save.
    await save(event.id, (await reload(event.id)).version, { ...FIELDS(), registrationOpensSoon: false });
    const opened = await findPublishedEventBySlug(db, "ro", "crosul-ro");
    expect(registrationState(opened!, NOW)).toBe("OPEN");
    expect(await queueRegistrationOpenedMessages(db, NOW)).toEqual({ queued: 1, dropped: 0 });
    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "REGISTRATION_OPENED"));
    expect(queued.map((message) => message.recipientEmail)).toEqual(["ana@example.ro"]);
    expect(await db.select().from(registrationInterests)).toHaveLength(0);
  });

  it("travels to a copy and to every date a series makes, like the opening date it stands in for", async () => {
    const event = await createPublished("alergarea");
    await save(event.id, event.version, { ...FIELDS(), registrationOpensSoon: true });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-15", publish: false }, now: new Date("2026-11-15T09:00:00.000Z") });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.registrationOpensSoon).toBe(true);

    const copy = await duplicateEvent(db, { actor: organizer, eventId: event.id });
    expect((await reload(copy.id)).registrationOpensSoon).toBe(true);
  });
});
