import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { atClubTime } from "@/db/seeds/sample-dates";
import { formatSenderIdentity } from "@/infrastructure/email/sender";
import { draftEvent } from "@/modules/content/events/service";
import { EVENT_FILE_FORMAT } from "@/modules/content/events/transfer/file-format";
import { placeKey, samePlace } from "@/modules/events/domain/same-place";
import { buildCalendar, type CalendarLabels, calendarFeedFileName } from "@/modules/events/ical";
import type { PublicEvent } from "@/modules/events/repository";
import { sportsEventJsonLd, sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { namesTheClub } from "@/modules/registrations/domain/public-list-club";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { glossaryContext } from "@/modules/translate/domain/glossary";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { envSchema } from "@/shared/config/env";
import { CLUB_NAME, SITE_TITLE } from "@/theme/brand";
import fork from "../fixtures/fork-club/club.json";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { UPSTREAM_IDENTITY } from "./upstream-identity";

/**
 * BR-REQ-101-01 (§882): another club runs the platform by replacing `club/`, and nothing of Brașov Runners' comes
 * with it.
 *
 * Under `yarn test:fork` (`vitest.fork.config.mts`) `@club` is `tests/fixtures/fork-club/` — a made-up club in
 * Cluj-Napoca on the Azores' clock. Each surface that carries the club's identity is rendered here; the made-up
 * club's words must appear and none of `UPSTREAM_IDENTITY`'s may.
 */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The upstream words a text says, each as a whole word (folded): «BV» in «BV 123456», never in «obvious». */
function upstreamWordsIn(text: string): string[] {
  const folded = fold(text);
  return UPSTREAM_IDENTITY.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(word))}(?![\\p{L}\\p{N}])`, "u").test(folded));
}

const NOW = new Date("2026-11-01T10:00:00.000Z");

/** A published event whose place is still to be announced: the JSON-LD names the club's city. */
const TBA_EVENT = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "GROUP_RUN",
  surface: "ASPHALT",
  eventStatus: "SCHEDULED",
  startsAt: new Date("2026-11-08T09:00:00Z"),
  endsAt: null,
  raceStartsAt: null,
  timezone: fork.place.timeZone,
  mapUrl: null,
  registrationMode: "NONE",
  slug: "alergare",
  title: "Alergare",
  excerpt: null,
  locationName: null,
  locationAddress: null,
  locationToBeAnnounced: true,
  costType: "FREE",
  publishedAt: NOW,
} as unknown as PublicEvent;

describe("BR-REQ-101-01: a fork's identity comes from its own club folder (§882)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  /** Everything rendered, by surface, for the closing assertion. */
  const rendered: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    const body = { sections: [{ paragraphs: ["p"] }] };
    const pair: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Document", body },
      { locale: "en", title: "Document", body },
    ];
    for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
      await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
    }
    [admin] = await db.insert(staffUsers).values({ email: "admin@fork.test", displayName: "Admin", role: "ADMIN" }).returning();
  });
  afterAll(async () => close());

  it("reads the made-up club, not this one", () => {
    expect(CLUB_NAME).toBe(fork.name);
    expect(CLUB_TIME_ZONE).toBe("Atlantic/Azores");
  });

  it("titles every page with the fork's name", () => {
    expect(SITE_TITLE).toEqual({ default: fork.name, template: `%s · ${fork.name}` });
    rendered.title = JSON.stringify(SITE_TITLE);
  });

  it("names the calendar's product and its feed after the fork", () => {
    const calendar = buildCalendar({ events: [], baseUrl: "https://fork.example.test", name: fork.name, labels: {} as CalendarLabels });
    const prodid = calendar.split("\r\n").find((line) => line.startsWith("PRODID:")) ?? "";
    expect(prodid).toBe("PRODID:-//Somes Striders//events//RO");
    expect(calendarFeedFileName("ro")).toBe("somes-striders-ro.ics");
    rendered.calendar = `${calendar}\n${calendarFeedFileName("ro")}\n${calendarFeedFileName("en")}`;
  });

  it("writes the fork's name and city into the structured data", () => {
    const organization = sportsOrganizationJsonLd(CLUB_NAME, "https://fork.example.test/ro/evenimente");
    const event = JSON.parse(JSON.stringify(sportsEventJsonLd(TBA_EVENT, "https://fork.example.test/ro/evenimente/alergare", CLUB_NAME)));
    expect(organization.name).toBe(fork.name);
    expect(event.location).toMatchObject({ name: "Cluj-Napoca", address: { addressLocality: "Cluj-Napoca", addressCountry: "RO" } });
    rendered.jsonLd = JSON.stringify([organization, event]);
  });

  it("sends from the fork's name by default", () => {
    const defaults = envSchema.parse({});
    expect(defaults.EMAIL_FROM_NAME).toBe(fork.name);
    expect(defaults.CLUB_COORDINATES).toEqual(fork.place.coordinates);
    const from = formatSenderIdentity({ EMAIL_FROM_NAME: defaults.EMAIL_FROM_NAME, MAILGUN_DOMAIN: "mail.fork.example.test" });
    expect(from).toContain(fork.name);
    rendered.from = `${from} ${JSON.stringify(defaults.CLUB_COORDINATES)}`;
  });

  it("tells the translator where the fork runs", () => {
    const context = glossaryContext();
    expect(context).toContain("in Cluj-Napoca, Romania,");
    rendered.glossary = context;
  });

  it("folds the fork's city, county and plate code off a place's name, and not this club's", () => {
    expect(placeKey("Parcul Central, Cluj-Napoca")).toBe("parcul central");
    expect(placeKey("Parcul Central, jud. CJ, România")).toBe("parcul central");
    expect(placeKey("Parcul Central, județul Cluj")).toBe("parcul central");
    expect(placeKey("Parcul Central, Brașov")).toBe("parcul central brasov");
    expect(samePlace({ locationName: "Parcul Central, Cluj-Napoca" }, { locationName: "Parcul Central" })).toBe(true);
  });

  it("matches the fork's name, short mark and plate code on the public list, and not this club's", () => {
    for (const typed of [fork.name, "somes striders", "SST", "CJ Striders", "Clubul Someș Striders România"]) expect(namesTheClub(typed), typed).toBe(true);
    for (const typed of ["Brașov Runners", "BVR", "BV Runners"]) expect(namesTheClub(typed), typed).toBe(false);
  });

  it("gives a test registration the fork's city and country", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: null })
      .returning();
    expect(await addTestRegistrations(db, admin, { eventId: event.id, count: 1, now: NOW })).toEqual({ created: 1 });
    const [row] = await db
      .select({ city: registrations.city, country: registrations.country, nationality: registrations.nationality })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(row).toEqual({ city: "Cluj-Napoca", country: "RO", nationality: "RO" });
    rendered.registration = JSON.stringify(row);
  });

  it("stamps the export file with the fork's slug", () => {
    expect(EVENT_FILE_FORMAT).toBe("somesstriders-event");
    rendered.file = EVENT_FILE_FORMAT;
  });

  it("starts a blank draft on the fork's clock", async () => {
    const draft = await draftEvent(null as never, { current: null, storedTranslations: [], translations: {}, now: NOW });
    expect(draft.event.timezone).toBe("Atlantic/Azores");
    rendered.draft = draft.event.timezone;
  });

  it("seeds a date at the fork's wall-clock hour, west of Greenwich", () => {
    const hourIn = (date: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Atlantic/Azores", hour: "2-digit", hourCycle: "h23" }).format(date));
    for (const days of [3, 100, 200, -200]) {
      const at = atClubTime(days, 9, 30);
      expect(hourIn(at), String(days)).toBe(9);
      // UTC−1 in winter, UTC+0 in summer: the instant is 09:30 or 10:30 UTC, never the 08:30 or 07:30 a positive offset makes.
      expect([10, 9], String(days)).toContain(at.getUTCHours());
      expect(at.getUTCMinutes()).toBe(30);
    }
    rendered.seed = atClubTime(3, 9).toISOString();
  });

  it("says none of this club's words anywhere it rendered", () => {
    expect(Object.keys(rendered).sort()).toEqual(["calendar", "draft", "file", "from", "glossary", "jsonLd", "registration", "seed", "title"]);
    const said = Object.entries(rendered).flatMap(([surface, text]) => upstreamWordsIn(text).map((word) => `${surface}: ${word}`));
    expect(said).toEqual([]);
  });
});
