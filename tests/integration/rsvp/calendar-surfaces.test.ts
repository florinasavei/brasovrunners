import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { eventTranslations, events } from "@/db/schema/events";
import { env } from "@/shared/config/env";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { answerRsvp, withdrawRsvp } from "@/modules/rsvp/rsvp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §812, «Vin!» part 2 (BR-REQ-020-01 criterion 7; amends §107, §159) — the calendar carries the answer's door: the feed, the event's
 * `.ics` and the emails' attachment say «Vin! → <page>#vin» and how many come, for an event the page offers «Vii?» to and for no
 * other; the count is one cached read filed under "places", so a confirmation or a withdrawal makes the feed say the new number
 * and a poll does not read the database. Real database (PGlite), the real routes called directly, the real catalogue.
 */
const messages = { ro, en };
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
/** The page's hold, passed through but recorded: the listing and the feed are kept until the first offered event starts. */
const holds = vi.hoisted(() => [] as Array<Array<Date | null | undefined>>);
vi.mock("@/modules/public-cache/page-lifetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/public-cache/page-lifetime")>();
  return {
    ...actual,
    holdPageUntil: (instants: Array<Date | null | undefined>, now: Date) => {
      holds.push([...instants]);
      return actual.holdPageUntil(instants, now);
    },
  };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void afterTasks.push(task),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "string" ? "ro" : arg.locale;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: (typeof arg === "string" ? arg : arg.namespace) as never });
  },
  getLocale: async () => "ro",
  setRequestLocale: () => {},
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { GET: feed } = await import("@/app/[locale]/events/calendar.ics/route");
const { GET: eventFile } = await import("@/app/[locale]/events/[slug]/calendar.ics/route");
const { renderCalendarPart } = await import("@/modules/notifications/calendar-part");
const { cachedRsvpCounts } = await import("@/modules/public-cache/reads");
const { readPublicComing } = await import("@/modules/rsvp/public-page");

const NOW = new Date("2026-10-20T10:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const STARTS_AT = new Date(NOW.getTime() + 2 * DAY + 6 * HOUR);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "log").mockImplementation(() => {});
  forgetLastGood();
  fakeNextCache.reset();
  request.reads.clear();
  afterTasks.length = 0;
  holds.length = 0;
  await approveNotice(1, true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function approveNotice(version: number, describes: boolean) {
  const translations: LegalDocumentTranslationInput[] = describes
    ? [
        { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
        { locale: "en", title: "Privacy", body: privacyNoticeEn },
      ]
    : [
        { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic despre răspunsuri."] }] } },
        { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing about answers."] }] } },
      ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

async function seedEvent(over: Partial<typeof events.$inferInsert> = {}, slug = "alergarea-de-joi") {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: STARTS_AT,
      registrationMode: "NONE",
      rsvpEnabled: true,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(NOW.getTime() - DAY),
      locationName: "Parcul Tractorul",
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug, title: "Alergarea de joi" },
    { eventId: event.id, locale: "en", slug: `${slug}-en`, title: "Thursday run" },
  ]);
  return { ...event, slug };
}

const answered = (email: string) => identityOf("remembered", { email, displayName: null, showName: false, locale: "ro" });
const unverified = (email: string) => identityOf("page", { email, displayName: null, showName: false, locale: "ro" });

/** The text a calendar app reads: lines unfolded, escapes undone enough to match the words. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").replace(/\\n/g, "\n").replace(/\\,/g, ",");

async function feedText(locale: "ro" | "en" = "ro"): Promise<string> {
  request.reads.clear();
  const response = await atTheClock(NOW, () => feed(new Request("https://example.test/feed"), { params: Promise.resolve({ locale }) }));
  expect(response.status).toBe(200);
  return unfold(await response.text());
}

async function fileText(slug: string, locale: "ro" | "en" = "ro"): Promise<string | null> {
  request.reads.clear();
  const response = await atTheClock(NOW, () => eventFile(new Request("https://example.test/file"), { params: Promise.resolve({ locale, slug }) }));
  return response.status === 200 ? unfold(await response.text()) : null;
}

describe("§812 the feed and the event's file say «Vin!»", () => {
  it("carries «Vin! → <page>#vin» and the count in the feed and in the event's own file, in Romanian", async () => {
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW);
    const url = `${env.APP_BASE_URL}/ro/evenimente/${event.slug}`;

    const inFeed = await feedText();
    expect(inFeed).toContain(`Vin! → ${url}#vin\n1 vine până acum`);
    expect(await fileText(event.slug)).toContain(`Vin! → ${url}#vin\n1 vine până acum`);
  });

  it("says it in English, with the English page and the English words", async () => {
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW);
    await answerRsvp(db, event.id, answered("bia@example.test"), NOW);
    const inFeed = await feedText("en");
    expect(inFeed).toContain(`I'm coming! → ${env.APP_BASE_URL}/en/events/${event.slug}-en#vin\n2 people coming so far`);
    expect(inFeed).not.toContain("vin până acum");
  });

  it("says «Fii primul care spune că vine.» when nobody has answered, and counts only a confirmed answer", async () => {
    const event = await seedEvent();
    expect(await feedText()).toContain("Fii primul care spune că vine.");
    // A typed address waits for its emailed link: it is not a person coming yet.
    await answerRsvp(db, event.id, unverified("ana@example.test"), NOW);
    fakeNextCache.reset();
    const waiting = await feedText();
    expect(waiting).toContain("Fii primul care spune că vine.");
    expect(waiting).not.toContain("vin până acum");
  });

  it.each([
    ["the club did not tick it", { rsvpEnabled: false }],
    ["it takes registrations on the site", { registrationMode: "INTERNAL" as const }],
    ["it is cancelled", { eventStatus: "CANCELLED" as const }],
    ["it is for the members alone", { membersOnly: true }],
  ])("has no «Vin!» line when %s", async (_why, over) => {
    const event = await seedEvent(over);
    const inFeed = await feedText();
    expect(inFeed).not.toContain("Vin! →");
    expect(inFeed).not.toContain("#vin");
    const inFile = await fileText(event.slug);
    expect(inFile ?? "").not.toContain("#vin");
  });

  it("has no «Vin!» line while the privacy notice in force does not describe it — the feed is otherwise what it was", async () => {
    await resetTables(db);
    await approveNotice(1, false);
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW).catch(() => undefined);
    const inFeed = await feedText();
    expect(inFeed).toContain("SUMMARY:Alergarea de joi");
    expect(inFeed).not.toContain("Vin!");
    expect(inFeed).not.toContain("#vin");
    expect(await fileText(event.slug)).not.toContain("#vin");
  });

  it("has no line once the event has started: the page draws no card any more", async () => {
    const event = await seedEvent();
    request.reads.clear();
    const response = await atTheClock(new Date(STARTS_AT.getTime() + HOUR), () => eventFile(new Request("https://example.test/file"), { params: Promise.resolve({ locale: "ro", slug: event.slug }) }));
    expect(unfold(await response.text())).not.toContain("#vin");
  });

  it("moves the entry's LAST-MODIFIED to the moment the number was made, so a subscribed app that reads the stamp sees the new count", async () => {
    await seedEvent();
    const inFeed = await feedText();
    expect(inFeed).toContain("LAST-MODIFIED:20261020T100000Z");
  });

  it("leaves the stamp alone for an event that says nothing of «Vin!»", async () => {
    await seedEvent({ rsvpEnabled: false });
    expect(await feedText()).not.toContain("LAST-MODIFIED:20261020T100000Z");
  });
});

describe("§812 the count is one cached read, expired by the answer that changes it", () => {
  it("is filed under the tag a confirmation and a withdrawal expire, and read once for the whole feed", async () => {
    const [a, b, c] = [await seedEvent({}, "a"), await seedEvent({}, "b"), await seedEvent({}, "c")];
    await answerRsvp(db, a.id, answered("ana@example.test"), NOW);
    await feedText();
    const filed = [...fakeNextCache.entries.entries()].filter(([key]) => key.includes("places.rsvp-counts"));
    // One entry for the three events, filed under "places" alone — the tag lane 56's write expires.
    expect(filed).toHaveLength(1);
    expect(filed[0][1].tags).toEqual(["public:places"]);
    expect(filed[0][0]).toContain(a.id);
    expect(filed[0][0]).toContain(b.id);
    expect(filed[0][0]).toContain(c.id);
  });

  it("is served from the cache to a second poll — no new query — and made again after a confirmation", async () => {
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW);
    expect(await feedText()).toContain("1 vine până acum");

    // A second poll is answered by the cache: nothing is stored, so nothing was read from the database.
    const writesBefore = fakeNextCache.counts.writes;
    expect(await feedText()).toContain("1 vine până acum");
    expect(fakeNextCache.counts.writes).toBe(writesBefore);

    // A confirmation says what it changed: the counts expire, and the next feed says the new number.
    await answerRsvp(db, event.id, answered("bia@example.test"), NOW);
    expect(fakeNextCache.invalidated).toContain("public:places");
    expect(await feedText()).toContain("2 vin până acum");
  });

  it("is made again after a withdrawal too", async () => {
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW);
    await answerRsvp(db, event.id, answered("bia@example.test"), NOW);
    expect(await feedText()).toContain("2 vin până acum");
    await withdrawRsvp(db, { eventId: event.id, identity: answered("bia@example.test") }, NOW);
    expect(await feedText()).toContain("1 vine până acum");
  });

  it("reads nothing about «Vin!» for a feed with no ticked event: neither the notice nor the counts", async () => {
    await seedEvent({ rsvpEnabled: false });
    fakeNextCache.reset();
    await feedText();
    const keys = [...fakeNextCache.entries.keys()];
    expect(keys.some((key) => key.includes("places.rsvp-counts"))).toBe(false);
    expect(keys.some((key) => key.includes("PRIVACY_NOTICE"))).toBe(false);
  });

  it("counts through `cachedRsvpCounts` as 0 for an event nobody answered, and the ids in any order are one entry", async () => {
    const a = await seedEvent({}, "a");
    const b = await seedEvent({}, "b");
    await answerRsvp(db, a.id, answered("ana@example.test"), NOW);
    expect(await cachedRsvpCounts([a.id, b.id])).toEqual({ [a.id]: 1, [b.id]: 0 });
    request.reads.clear();
    const before = fakeNextCache.counts.writes;
    await cachedRsvpCounts([b.id, a.id]);
    expect(fakeNextCache.counts.writes).toBe(before);
  });

  it("holds the page until the first offered event starts, and not for an event that could not be offered", async () => {
    const offered = await seedEvent({}, "a");
    const earlier = new Date(STARTS_AT.getTime() - DAY);
    const unticked = await seedEvent({ rsvpEnabled: false, startsAt: earlier }, "b");
    const rows = [await findPublishedEventBySlug(db, "ro", "a"), await findPublishedEventBySlug(db, "ro", "b")].filter((row) => row !== undefined);
    holds.length = 0;
    const coming = await readPublicComing(rows, NOW);
    expect([...coming.keys()]).toEqual([offered.id]);
    expect(coming.has(unticked.id)).toBe(false);
    expect(holds.at(-1)).toEqual([STARTS_AT]);
  });
});

describe("§812 the emails' calendar attachment says «Vin!» too", () => {
  const attendee = { email: "runner@example.test" };

  it("carries the two lines in the `.ics` attached to a message, read from the database itself", async () => {
    const event = await seedEvent();
    await answerRsvp(db, event.id, answered("ana@example.test"), NOW);
    const part = await renderCalendarPart(db, { part: "file", locale: "ro", slug: event.slug, now: NOW, rsvpTo: null, sequence: 0, attendee });
    const attachment = part.attachments?.[0];
    expect(attachment?.filename).toBe(`${event.slug}.ics`);
    const text = unfold(attachment!.data.toString("utf8"));
    expect(text).toContain(`Vin! → ${env.APP_BASE_URL}/ro/evenimente/${event.slug}#vin\n1 vine până acum`);
  });

  it("carries them in an invitation too, and none for an event the page does not offer", async () => {
    const offered = await seedEvent({}, "a");
    const plain = await seedEvent({ rsvpEnabled: false }, "b");
    const invite = await renderCalendarPart(db, { part: "REQUEST", locale: "ro", slug: offered.slug, now: NOW, rsvpTo: "club@example.test", sequence: 1, attendee });
    expect(unfold(invite.calendar!.ics)).toContain("#vin");
    const without = await renderCalendarPart(db, { part: "file", locale: "ro", slug: plain.slug, now: NOW, rsvpTo: null, sequence: 0, attendee });
    expect(unfold(without.attachments![0].data.toString("utf8"))).not.toContain("#vin");
  });

  it("says nothing for a members' event: the page draws no «Vii?» there", async () => {
    const members = await seedEvent({ membersOnly: true });
    const part = await renderCalendarPart(db, { part: "file", locale: "ro", slug: members.slug, now: NOW, rsvpTo: null, sequence: 0, attendee });
    expect(unfold(part.attachments![0].data.toString("utf8"))).not.toContain("#vin");
  });

  it("answers in English with the English words", async () => {
    const event = await seedEvent();
    const part = await renderCalendarPart(db, { part: "file", locale: "en", slug: `${event.slug}-en`, now: NOW, rsvpTo: null, sequence: 0, attendee });
    const text = unfold(part.attachments![0].data.toString("utf8"));
    expect(text).toContain(`I'm coming! → ${env.APP_BASE_URL}/en/events/${event.slug}-en#vin`);
    expect(text).toContain("Be the first to say you're coming.");
  });
});
