import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesListSocials } from "@/modules/legal-documents/repository";
import { clearOptionalData } from "@/modules/registrations/consent-withdrawal";
import { setListConsent } from "@/modules/registrations/list-consent";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §500 (widening §106) — Strava and Instagram beside a name on the public list: what the service
 * keeps, and what takes it away again.
 *
 * The tick «Arată și Strava și Instagram lângă numele meu pe listă» is kept only when every
 * condition holds — ticked, on the list, an adult with a social typed, and the privacy notice the
 * registration records names `{{participantListSocials}}` — so a `true` in the column is always
 * consent to a text that described it. Leaving the list, or deleting the socials, sets it back.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

const plain = { sections: [{ paragraphs: ["Lista publică arată numele celor care au bifat."] }] };
const withMarker = { sections: [{ paragraphs: ["Lângă nume: Strava și Instagram, dacă ai bifat {{participantListSocials}}."] }] };

async function approve(key: "TERMS" | "PRIVACY_NOTICE", version: number, body: object = plain, effectiveAt = new Date("2026-01-01T00:00:00.000Z")) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: body as LegalDocumentTranslationInput["body"] },
    { locale: "en", title: "Text", body: body as LegalDocumentTranslationInput["body"] },
  ];
  await insertLegalDocumentVersion(db, { key, version, effectiveAt, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

async function createEvent(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", participantListVisibility: "NAMES" })
    .returning();
  return { id: event.id, eventStatus: event.eventStatus, registrationMode: "INTERNAL", startsAt: event.startsAt, registrationOpensAt: null, registrationClosesAt: null, capacity: null, raceId: null, publishedAt: NOW };
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Ana",
  lastName: "Pop",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  nationality: "RO",
  city: "Brașov",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  termsAccepted: true,
  resultsNameConsent: false,
  listOptOut: false,
  listSocials: true,
  stravaUrl: "https://www.strava.com/athletes/12345",
  instagramHandle: "@ana.pop",
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
  ...overrides,
});

async function onlyRow(eventId: string) {
  const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function keptAfter(overrides: Record<string, unknown>) {
  const event = await createEvent();
  await submitRegistration(db, event, submission(overrides), NOW);
  return onlyRow(event.id);
}

describe("§500 what the service keeps of the socials tick", () => {
  it("keeps it for an adult on the list with a social typed, under a notice naming the marker", async () => {
    await approve("TERMS", 1);
    await approve("PRIVACY_NOTICE", 1, withMarker);
    const row = await keptAfter({});
    expect(row.listSocials).toBe(true);
    expect(row.stravaUrl).toBe("https://www.strava.com/athletes/12345");
    expect(row.instagramHandle).toBe("ana.pop");
    // Only one of the two is enough.
    await resetTables(db);
    await approve("TERMS", 1);
    await approve("PRIVACY_NOTICE", 1, withMarker);
    expect((await keptAfter({ stravaUrl: "" })).listSocials).toBe(true);
  });

  it("drops it under a notice that does not name the marker — the tick was never described", async () => {
    await approve("TERMS", 1);
    await approve("PRIVACY_NOTICE", 1, plain);
    const row = await keptAfter({});
    expect(row.listSocials).toBe(false);
    // The socials themselves are kept, for the club, as §106 always did.
    expect(row.stravaUrl).toBe("https://www.strava.com/athletes/12345");
    expect(await noticeDescribesListSocials(db, NOW)).toBe(false);
  });

  it.each([
    ["not ticked", { listSocials: false }],
    ["ticked but off the list", { listOptOut: true }],
    ["ticked with nothing to print", { stravaUrl: "", instagramHandle: "" }],
    ["ticked for a minor, whose socials are never kept (§323)", { birthDate: "2011-01-10", guardianName: "Maria Pop" }],
  ])("drops it when %s", async (_case, overrides) => {
    await approve("TERMS", 1);
    await approve("PRIVACY_NOTICE", 1, withMarker);
    expect(await noticeDescribesListSocials(db, NOW)).toBe(true);
    expect((await keptAfter(overrides)).listSocials).toBe(false);
  });
});

describe("§500 what takes it away", () => {
  async function shown() {
    await approve("TERMS", 1);
    await approve("PRIVACY_NOTICE", 1, withMarker);
    const row = await keptAfter({});
    expect(row.listSocials).toBe(true);
    return row;
  }

  it("leaving the list clears it for good; coming back puts the name back without the socials", async () => {
    const row = await shown();
    await setListConsent(db, row.id, false, "MY_REGISTRATIONS", NOW);
    expect((await onlyRow(row.eventId)).listSocials).toBe(false);
    await setListConsent(db, row.id, true, "MY_REGISTRATIONS", NOW);
    const back = await onlyRow(row.eventId);
    expect(back.listOptOut).toBe(false);
    expect(back.listSocials).toBe(false);
  });

  it("deleting the socials clears it with them", async () => {
    const row = await shown();
    await clearOptionalData(db, { registrationId: row.id, fields: ["socials"], via: "MY_REGISTRATIONS", actorStaffUserId: null, now: NOW });
    const after = await onlyRow(row.eventId);
    expect(after).toMatchObject({ stravaUrl: null, instagramHandle: null, listSocials: false });
  });
});
