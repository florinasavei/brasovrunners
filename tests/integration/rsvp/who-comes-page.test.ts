import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { draftRegistrationDoor } from "@/modules/events/ui/registration-door";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp } from "@/modules/rsvp/rsvp";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

/**
 * §NNN (BR-REQ-039-01, amending §812 and §819) — «Cine vine» is seen at a glance (the owner, 2026-10-19: «„Cine vine" trebuie să fie mai vizibil.
 * Că inițial am citit în „zig-zag" și am sărit peste secțiune. Și pune „Confirmă prezența (opțional)"»). The real `EventPageView`, drawn the way
 * the page draws it, over a real database (PGlite) and the real catalogue, proves four things the pieces cannot prove alone:
 *
 * - on a turn-up event the page's top reads facts → «Confirmă prezența (opțional)» → «Cine vine (N)» → the rest, two closed folds together;
 * - on a race the public list is right under the registration card, no longer under «Condiții de participare»;
 * - the facts carry «N vin · vezi cine», a link to the fold that holds the names, with the very number the fold's bar says — on a race from the
 *   list's own headline, with no count query of its own — and nothing when no count is public;
 * - nothing of it where the page offers no answer: no fold, no line, no anchor.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
const reads = vi.hoisted(() => ({ rsvps: [] as string[], startListCounts: 0 }));

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
    typeof href === "string" ? (href.startsWith("#") ? href : `/${language}${href}`) : `/${language}${(href.pathname ?? "").replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`;
  return {
    getPathname: ({ href }: { href: string | { pathname?: string; params?: Record<string, string> } }) => path(href),
    Link: ({ href, children, style }: { href: string | { pathname?: string; params?: Record<string, string> }; children: ReactNode; style?: object }) =>
      createElement("a", { href: path(href), style }, children),
  };
});
// The reads the page's pieces share are counted: «never a second query» is a number, not a hope.
vi.mock("@/modules/public-cache/reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/public-cache/reads")>();
  return {
    ...actual,
    cachedPublicRsvps: (eventId: string, version: number | null) => {
      reads.rsvps.push(eventId);
      return actual.cachedPublicRsvps(eventId, version);
    },
  };
});
vi.mock("@/modules/registrations/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/repository")>();
  return {
    ...actual,
    countPublicStartList: (...args: Parameters<typeof actual.countPublicStartList>) => {
      reads.startListCounts += 1;
      return actual.countPublicStartList(...args);
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
  reads.rsvps.length = 0;
  reads.startListCounts = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await approveNotice();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function approveNotice() {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
    { locale: "en", title: "Privacy", body: privacyNoticeEn },
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

/** A race with a public list: `NAMES`, registration open, fifty places. */
const seedRace = (over: Partial<typeof events.$inferInsert> = {}) =>
  seed(
    {
      type: "RACE",
      registrationMode: "INTERNAL",
      rsvpEnabled: false,
      capacity: 50,
      participantListVisibility: "NAMES",
      startsAt: new Date(NOW.getTime() + 30 * DAY),
      ...over,
    },
    "cros-de-toamna",
  );

async function confirmedRunner(eventId: string, name: string, listOptOut = false) {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: "CONFIRMED",
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut,
    confirmedAt: NOW,
  });
}

/** The page the way `events/[slug]/page.tsx` draws it for a visitor: `visit.rsvpBox` is the page's own decision (`rsvpOffered`). */
async function draw(slug: string, visit: { rsvpBox?: boolean } | null = { rsvpBox: true }, membersOnly = false, asPreview = false) {
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
      // `visit: null` is the editor's preview before saving (§579): no `visit`, the draft's own door and steps.
      visit: visit ? { interestBox: false, interestOutcome: null, interestRenderedAt: NOW, rsvpOutcome: null, rsvpRenderedAt: NOW, ...visit } : undefined,
      preview: asPreview
        ? {
            door: { door: await draftRegistrationDoor(db, found, { capacity: found.capacity, waitlistCapacity: null }, NOW), word: "Înscrie-te" },
            steps: { deadlines: DEFAULT_DEADLINES, familyOpen: false, refusalOn: false },
          }
        : undefined,
    }),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const confirm = (email: string) => identityOf("remembered", { email, displayName: null, showName: false, locale: "ro" });
const at = (html: string, needle: string) => {
  const index = html.indexOf(needle);
  expect(index, needle).toBeGreaterThan(-1);
  return index;
};
const link = (html: string) => /<a[^>]*data-testid="who-comes-link"[^>]*>([^<]*)<\/a>/.exec(html);
const hrefOf = (anchor: string) => /href="([^"]*)"/.exec(anchor)?.[1];
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("§NNN a turn-up event: «Confirmă prezența (opțional)» and «Cine vine (N)» stand together near the top", () => {
  it("draws facts → the card → the fold of who comes → the rest, the fold its own closed <details> at #cine-vine", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    await answerRsvp(db, id, confirm("dan@example.test"), NOW);
    const html = await draw(slug);

    const facts = at(html, 'data-testid="event-facts"');
    const card = at(html, 'data-testid="rsvp-box"');
    const who = at(html, 'data-testid="rsvp-who"');
    const conditions = at(html, 'data-testid="conditions-fold"');
    expect(facts).toBeLessThan(card);
    expect(card).toBeLessThan(who);
    expect(who).toBeLessThan(conditions);
    // Right under the card: nothing but the card's own closing parts between its bar and the fold's — no other section of the page.
    const between = html.slice(card, who);
    expect(between).not.toContain('id="route"');
    expect(between).not.toContain('data-testid="conditions-fold"');

    expect(/<details\b[^>]*id="cine-vine"[^>]*>/.exec(html)?.[0]).toBeDefined();
    expect(/<details\b[^>]*id="cine-vine"[^>]*>/.exec(html)![0]).not.toMatch(/\sopen[\s=>]/);
    // Both bars read as words: the card's «… · 2 vin» and the fold's «Cine vine (2)».
    expect(text(html)).toContain("Confirmă prezența (opțional) · 2 vin");
    expect(text(html)).toContain("Cine vine (2)");
    // The card no longer holds the list: the fold is not inside the card's <details>.
    const cardEnd = html.indexOf('data-testid="rsvp-who"');
    expect(html.slice(card, cardEnd)).toMatch(/<\/details>\s*<\/section>\s*<section/);
  });

  it("says «N vin · vezi cine» in the facts, linking #cine-vine, with the number the bars say — from the one read of the answers", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    await answerRsvp(db, id, confirm("dan@example.test"), NOW);
    reads.rsvps.length = 0;
    const html = await draw(slug);

    const anchor = link(html);
    expect(anchor).not.toBeNull();
    expect(hrefOf(anchor![0])).toBe("#cine-vine");
    expect(anchor![1]).toBe("2 vin · vezi cine");
    // Inside the facts block, with the people glyph and its question.
    const facts = /<dl\b[^>]*data-testid="event-facts"[\s\S]*?<\/dl>/.exec(html)![0];
    expect(facts).toContain('data-testid="who-comes-link"');
    expect(facts).toContain("Cine vine");
    expect(facts).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Cine vine<\/dt>/);
    // One read for the line, the card and the fold, and the calendar's links besides.
    expect(reads.rsvps).toEqual([id]);
  });

  it("says «1 vine · vezi cine» for one, and reads in English", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    expect(link(await draw(slug))![1]).toBe("1 vine · vezi cine");
    language = "en";
    const html = await draw(slug);
    expect(link(html)![1]).toBe("1 coming · see who");
    expect(text(html)).toContain("Who's coming (1)");
    expect(text(html)).toContain("Confirm you're coming (optional)");
    expect(text(html)).toContain("This is not a registration");
  });

  it("with nobody yet: the card asks to be first, the fold says «Cine vine» and «Încă nu a confirmat nimeni.», the facts say nothing", async () => {
    const { slug } = await seed();
    const html = await draw(slug);
    expect(link(html)).toBeNull();
    expect(text(html)).toContain("Confirmă prezența (opțional) · Fii primul care confirmă");
    const fold = /<details\b[^>]*id="cine-vine"[\s\S]*?<\/details>/.exec(html)![0];
    expect(/<summary[\s\S]*?<\/summary>/.exec(fold)![0].replace(/<[^>]+>/g, "")).toBe("Cine vine");
    expect(fold).toContain("Încă nu a confirmat nimeni.");
  });

  it("draws neither the fold nor the line nor the anchor where the page offers no answer, on a members' event, or while no answer is offered", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, confirm("ana@example.test"), NOW);
    for (const html of [await draw(slug, { rsvpBox: false }), await draw(slug, { rsvpBox: true }, true)]) {
      expect(html).not.toContain('data-testid="rsvp-who"');
      expect(html).not.toContain('id="cine-vine"');
      expect(html).not.toContain('data-testid="who-comes-link"');
      expect(html).not.toContain("vezi cine");
    }
  });
});

describe("§NNN a race: the public list moves up under the registration card, and the facts say how many", () => {
  it("draws facts → the registration card → «Cine vine (N)» → «Condiții de participare», no longer the list last", async () => {
    const { slug, id } = await seedRace();
    await confirmedRunner(id, "Ana Popescu");
    await confirmedRunner(id, "Ion Vasile");
    const html = await draw(slug, { rsvpBox: false });

    const facts = at(html, 'data-testid="event-facts"');
    const card = at(html, 'data-testid="registration-fill"');
    const list = at(html, 'data-testid="start-list"');
    const conditions = at(html, 'data-testid="conditions-fold"');
    expect(facts).toBeLessThan(card);
    expect(card).toBeLessThan(list);
    expect(list).toBeLessThan(conditions);
    // The list itself is as it was: the bar's count and the names inside.
    expect(text(html)).toContain("Cine vine (2)");
    expect(html).toContain("Ana Popescu");
    // …and there is no turn-up fold on a race.
    expect(html).not.toContain('id="cine-vine"');
    expect(html).not.toContain('data-testid="rsvp-box"');
  });

  it("says the list's own number in the facts, linking the title's anchor, and asks the list's count once", async () => {
    const { slug, id } = await seedRace();
    await confirmedRunner(id, "Ana Popescu");
    await confirmedRunner(id, "Ion Vasile");
    await confirmedRunner(id, "Hidden Person", true);
    reads.startListCounts = 0;
    const html = await draw(slug, { rsvpBox: false });

    const anchor = link(html);
    expect(anchor).not.toBeNull();
    expect(hrefOf(anchor![0])).toBe("#start-list-title");
    // Three confirmed, one of them off the names: the title counts everybody, and so does the line — one number, one computation.
    expect(anchor![1]).toBe("3 vin · vezi cine");
    expect(text(html)).toContain("Cine vine (3)");
    expect(html).toContain('id="start-list-title"');
    expect(reads.startListCounts).toBe(1);
  });

  it("says nothing while the list keeps its numbers private, and nothing for a list nobody is on or the club keeps hidden", async () => {
    const hiddenNumbers = await seedRace({ participantCountPublic: false });
    await confirmedRunner(hiddenNumbers.id, "Ana Popescu");
    const withoutNumbers = await draw(hiddenNumbers.slug, { rsvpBox: false });
    expect(link(withoutNumbers)).toBeNull();
    // The names stay; only the number is private.
    expect(withoutNumbers).toContain("Ana Popescu");
    expect(text(withoutNumbers)).not.toMatch(/Cine vine \(\d+\)/);

    await resetTables(db);
    await approveNotice();
    const empty = await seedRace();
    expect(link(await draw(empty.slug, { rsvpBox: false }))).toBeNull();

    await resetTables(db);
    await approveNotice();
    const hidden = await seedRace({ participantListVisibility: "HIDDEN" });
    await confirmedRunner(hidden.id, "Ana Popescu");
    reads.startListCounts = 0;
    const html = await draw(hidden.slug, { rsvpBox: false });
    expect(link(html)).toBeNull();
    expect(html).not.toContain('data-testid="start-list"');
    // Only the registration card's own read of the hidden list's count (`RegistrationCta`); the facts' line and the list ask nothing more.
    expect(reads.startListCounts).toBeLessThanOrEqual(1);
  });

  it("draws no list and no line on a members' event, whatever the visit says", async () => {
    const { slug, id } = await seedRace();
    await confirmedRunner(id, "Ana Popescu");
    const html = await draw(slug, { rsvpBox: false }, true);
    expect(html).not.toContain('data-testid="start-list"');
    expect(link(html)).toBeNull();
  });

  it("says nothing on a cancelled race or a finished one, though the list and its names stay", async () => {
    const cancelled = await seedRace({ eventStatus: "CANCELLED" });
    await confirmedRunner(cancelled.id, "Ana Popescu");
    await confirmedRunner(cancelled.id, "Ion Vasile");
    const cancelledHtml = await draw(cancelled.slug, { rsvpBox: false });
    // The list is drawn as it was; only the facts' «N vin · vezi cine» is not: nobody is coming to an event that will not happen.
    expect(cancelledHtml).toContain('data-testid="start-list"');
    expect(cancelledHtml).toContain("Ana Popescu");
    expect(link(cancelledHtml)).toBeNull();
    expect(cancelledHtml).not.toContain("vezi cine");

    await resetTables(db);
    await approveNotice();
    const completed = await seedRace({ eventStatus: "COMPLETED" });
    await confirmedRunner(completed.id, "Ana Popescu");
    expect(link(await draw(completed.slug, { rsvpBox: false }))).toBeNull();

    // A scheduled race whose start has passed (the list stays open for its days): the same.
    await resetTables(db);
    await approveNotice();
    const past = await seedRace({ startsAt: new Date(NOW.getTime() - DAY) });
    await confirmedRunner(past.id, "Ana Popescu");
    const pastHtml = await draw(past.slug, { rsvpBox: false });
    expect(pastHtml).toContain('data-testid="start-list"');
    expect(link(pastHtml)).toBeNull();
  });
});

describe("§NNN the preview before saving carries nothing of it", () => {
  it("draws no line, no fold of who comes and no list on a race or a turn-up event, whatever is in the database", async () => {
    const race = await seedRace();
    await confirmedRunner(race.id, "Ana Popescu");
    const turnUp = await seed({}, "alergarea-de-vineri");
    await answerRsvp(db, turnUp.id, confirm("ana@example.test"), NOW);
    for (const slug of [race.slug, turnUp.slug]) {
      const html = await draw(slug, null, false, true);
      expect(html).not.toContain('data-testid="who-comes-link"');
      expect(html).not.toContain('data-testid="rsvp-who"');
      expect(html).not.toContain('data-testid="start-list"');
      expect(html).not.toContain('id="cine-vine"');
    }
  });
});
