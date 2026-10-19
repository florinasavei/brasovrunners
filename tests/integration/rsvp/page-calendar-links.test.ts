import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp } from "@/modules/rsvp/rsvp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

/**
 * §NNN (BR-REQ-020-01 criterion 7, amending §815) — the event page's own «Adaugă în calendar» links carry the answer's door as the `.ics`
 * and the feed do: «Vin! → <page>#vin» and «N vin până acum» in the description of the Google and the two Outlook links, for an event
 * the page offers «Vii?» to and for no other, from the one read of the answers the page's box is handed (no second read). Real database
 * (PGlite), the real `EventPageView` drawn the way the page draws it, the real catalogue.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
const reads = vi.hoisted(() => ({ counts: [] as string[] }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getFormatter: async () => createFormatter({ locale: language, timeZone: "Europe/Bucharest" }),
  getTranslations: async (arg?: string | { locale?: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "object" && arg.locale ? arg.locale : language;
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: namespace as never });
  },
}));
vi.mock("@/i18n/navigation", () => {
  const path = (href: string | { pathname?: string; params?: Record<string, string> }) =>
    typeof href === "string" ? `/${language}${href}` : `/${language}${(href.pathname ?? "").replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`;
  return {
    getPathname: ({ href }: { href: string | { pathname?: string; params?: Record<string, string> } }) => path(href),
    Link: ({ href, children, style }: { href: string | { pathname?: string; params?: Record<string, string> }; children: ReactNode; style?: object }) =>
      createElement("a", { href: path(href), style }, children),
  };
});
// The page's one read of the answers is the cache's: spied, so "no second read" is a count.
vi.mock("@/modules/public-cache/reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/public-cache/reads")>();
  return {
    ...actual,
    cachedPublicRsvps: (eventId: string, version: number | null) => {
      reads.counts.push(eventId);
      return actual.cachedPublicRsvps(eventId, version);
    },
  };
});

const { default: EventPageView } = await import("@/modules/events/ui/EventPageView");
const { datedOrNull } = await import("@/modules/events/domain/dated");

const NOW = new Date("2026-10-20T10:00:00.000Z");
const DAY = 86_400_000;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  language = "ro";
  reads.counts.length = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await approveNotice(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function approveNotice(describes: boolean) {
  const translations: LegalDocumentTranslationInput[] = describes
    ? [
        { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
        { locale: "en", title: "Privacy", body: privacyNoticeEn },
      ]
    : [
        { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic."] }] } },
        { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing."] }] } },
      ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

async function seed(over: Partial<typeof events.$inferInsert> = {}, slug = "alergarea-de-joi") {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date(NOW.getTime() + 2 * DAY),
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
  return { id: event.id, slug };
}

/** The page the way `events/[slug]/page.tsx` draws it for a visitor: `visit.rsvpBox` is the page's own decision (`rsvpOffered`). */
async function draw(slug: string, visit: { rsvpBox?: boolean } = { rsvpBox: true }, membersOnly = false) {
  const found = await findPublishedEventBySlug(db, language, language === "ro" ? slug : `${slug}-en`);
  if (!found || !datedOrNull(found)) throw new Error("the event did not publish");
  const stream = await renderToReadableStream(
    createElement(EventPageView, {
      event: found,
      locale: language,
      slug: language === "ro" ? slug : `${slug}-en`,
      now: NOW,
      weather: null,
      membersOnly,
      visit: { interestBox: false, interestOutcome: null, interestRenderedAt: NOW, rsvpOutcome: null, rsvpRenderedAt: NOW, ...visit },
    }),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const decode = (html: string) => html.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/");

/** The three add links' addresses, decoded, and the text each one carries for a description. */
function addLinks(html: string) {
  const hrefs = [...decode(html).matchAll(/href="(https:\/\/(?:calendar\.google\.com|outlook\.live\.com|outlook\.office\.com)[^"]*)"/g)].map((match) => match[1]);
  const text = (url: string) => new URL(url).searchParams.get(url.includes("google") ? "details" : "body") ?? "";
  return {
    google: hrefs.find((href) => href.includes("calendar.google.com")),
    outlook: hrefs.find((href) => href.includes("outlook.live.com")),
    outlookWork: hrefs.find((href) => href.includes("outlook.office.com")),
    text,
  };
}

/**
 * The line «Vin! → <page>#vin» as each link carries it: Google's and Outlook's descriptions are HTML, so the words are the anchor's text
 * and the address its `href`; the page's own address with the anchor of its «Vii?» card, never a hostname written in the code.
 */
function expectDoor(description: string, words: string, pagePath: string) {
  const anchor = /<a href="([^"]*)">([^<]*)<\/a>/.exec(description);
  expect(anchor, description).not.toBeNull();
  expect(anchor![2]).toBe(words);
  expect(new URL(anchor![1]).pathname + new URL(anchor![1]).hash).toBe(`${pagePath}#vin`);
}

const confirm = (email: string) => identityOf("remembered", { email, displayName: null, showName: false, locale: "ro" });

describe("§NNN the event page's add-to-calendar links say «Vin!»", () => {
  it("carry «Vin! → <page>#vin» and «N vin până acum» in Google's and both Outlooks' description, from the one read the box shares", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    await answerRsvp(db, id, confirm("dan@example.test"), NOW);
    reads.counts.length = 0;
    const html = await draw(slug);
    const links = addLinks(html);

    for (const url of [links.google, links.outlook, links.outlookWork]) {
      expect(url).toBeDefined();
      const description = links.text(url!);
      expectDoor(description, "Vin!", "/ro/events/alergarea-de-joi");
      expect(description).toContain("2 vin până acum");
    }
    // The box says the same number, and the answers were read once for the whole page — the links' count and the card's share it.
    expect(html).toContain('data-testid="rsvp-box"');
    expect(reads.counts).toEqual([id]);
  });

  it("asks the first to come when nobody has, and says it in English", async () => {
    language = "en";
    const { slug } = await seed();
    const links = addLinks(await draw(slug));
    for (const url of [links.google, links.outlook, links.outlookWork]) {
      const description = links.text(url!);
      expectDoor(description, "I'm coming!", "/en/events/alergarea-de-joi-en");
      expect(description).toContain("Be the first to say you're coming.");
    }
  });

  it("changes nothing when the page does not offer «Vii?»: no line, no read of the answers", async () => {
    const { slug } = await seed();
    const html = await draw(slug, { rsvpBox: false });
    const links = addLinks(html);
    for (const url of [links.google, links.outlook, links.outlookWork]) {
      expect(url).toBeDefined();
      const description = links.text(url!);
      expect(description).not.toContain("Vin!");
      expect(description).not.toContain("#vin");
      expect(description).not.toContain("vin până acum");
    }
    expect(html).not.toContain('data-testid="rsvp-box"');
    expect(reads.counts).toEqual([]);
  });

  it("changes nothing on a members' event, whatever the visit says: its page draws no «Vii?»", async () => {
    const { slug } = await seed();
    const html = await draw(slug, { rsvpBox: true }, true);
    const links = addLinks(html);
    for (const url of [links.google, links.outlook, links.outlookWork]) expect(links.text(url!)).not.toContain("#vin");
    expect(html).not.toContain('data-testid="rsvp-box"');
    expect(reads.counts).toEqual([]);
  });

  it("counts only confirmed answers: one waiting for its emailed link is not coming yet", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    await answerRsvp(db, id, identityOf("page", { email: "waiting@example.test", displayName: null, showName: false, locale: "ro" }), NOW);
    expect(await db.select().from(eventRsvps)).toHaveLength(2);
    const links = addLinks(await draw(slug));
    expect(links.text(links.google!)).toContain("1 vine până acum");
  });
});
