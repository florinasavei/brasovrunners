import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { CLUB_NAME } from "@/theme/brand";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { accountIdentity } from "@/modules/rsvp/domain/account-identity";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp } from "@/modules/rsvp/rsvp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
const reads = vi.hoisted(() => ({ rsvps: [] as string[] }));

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
    cachedPublicRsvps: (eventId: string, version: number | null, memberVersion: number | null = null) => {
      reads.rsvps.push(eventId);
      return actual.cachedPublicRsvps(eventId, version, memberVersion);
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

/** The page the way `events/[slug]/page.tsx` draws it for a visitor: `visit.rsvpBox` is the page's own decision (`rsvpOffered`). */
async function draw(slug: string, visit: { rsvpBox?: boolean } | null = { rsvpBox: true }, membersOnly = false) {
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
    }),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

/**
 * §831 (BR-REQ-039-01, BR-REQ-060-01; amends §812 and §825) — «Cine vine» says who is a member: the real `EventPageView`, drawn the way the page draws it, over a
 * real database (PGlite) and the real catalogue and template. A small «BVR» chip stands beside a name its owner chose to show — never beside «și încă N» — the
 * fold says «Dintre ei: M membri», and the closed fold's line and the facts say «N vin · M membri». Nothing of it while no notice describes the mark. The
 * rules are `member-domain.test.ts`, the service `member-mark.test.ts`, the journey `tests/e2e/rsvp.spec.ts`.
 */
const remembered = (email: string, extra: Partial<Parameters<typeof identityOf>[1]> = {}) => identityOf("remembered", { email, displayName: null, showName: false, locale: "ro", ...extra });
const at = (n: number) => new Date(NOW.getTime() + n);
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const marks = (html: string) => html.match(/data-testid="rsvp-member-mark"/g)?.length ?? 0;
const factsLink = (html: string) => /<a[^>]*data-testid="who-comes-link"[^>]*>([^<]*)<\/a>/.exec(html)?.[1];
/** The rows of the fold «Cine vine»: each name's own <li>, so a mark is read beside the name it stands by. */
const rowsOf = (html: string) => [...html.matchAll(/<li[^>]*data-testid="(rsvp-name|rsvp-others)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => ({ kind: match[1], html: match[2] }));

/** Ana (a member who shows her name), Bia (shows hers, not a member), Dan (a member who shows nothing) and a colleague's account named by its own tick. */
async function answers(eventId: string) {
  await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana Popescu", showName: true, clubMember: true }), at(1));
  await answerRsvp(db, eventId, remembered("bia@example.test", { displayName: "Bia Ionescu", showName: true }), at(2));
  await answerRsvp(db, eventId, remembered("dan@example.test", { displayName: "Dan Secret", showName: false, clubMember: true }), at(3));
  await answerRsvp(db, eventId, accountIdentity({ email: "cont@example.test", displayName: "Cont Admin", role: "ADMIN" }, "ro", true), at(4));
}

describe("§831 «Cine vine» marks the members who show their name", () => {
  it("puts «BVR» beside a shown member's name, and nowhere else — the unnamed member is only counted", async () => {
    const { id, slug } = await seed();
    await answers(id);
    const html = await draw(slug);
    const rows = rowsOf(html);
    expect(rows.map((row) => text(row.html).replace(/BVR|Membru.*$/g, "").trim())).toEqual(["Ana Popescu", "Bia Ionescu", "Cont Admin", "și încă 1"]);
    // The mark is in the first and the third row, in none of the others — least of all «și încă 1», which holds Dan.
    expect(rows.map((row) => row.html.includes('data-testid="rsvp-member-mark"'))).toEqual([true, false, true, false]);
    expect(marks(html)).toBe(2);
    expect(html).not.toContain("Dan Secret");
    expect(html).not.toContain("example.test");
  });

  it("says the mark's accessible name with the club's name from the constant, and «BVR» as its word", async () => {
    const { id, slug } = await seed();
    await answers(id);
    const html = await draw(slug);
    const chip = /<div[^>]*data-testid="rsvp-member-mark"[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(chip).toContain("BVR");
    expect(chip).toContain(`Membru ${CLUB_NAME}`);
    expect(chip).toContain("<svg");
  });

  it("says «Dintre ei: M membri.» in the fold — the named and the unnamed members both", async () => {
    const { id, slug } = await seed();
    await answers(id);
    expect(text(await draw(slug))).toContain("Dintre ei: 3 membri.");
  });

  it("says «N vin · M membri» on the closed fold's line and in the facts, with the number the fold's bar says", async () => {
    const { id, slug } = await seed();
    await answers(id);
    reads.rsvps.length = 0;
    const html = await draw(slug);
    expect(text(html)).toContain("Confirmă prezența (opțional) · 4 vin · 3 membri");
    expect(factsLink(html)).toBe("4 vin · 3 membri · vezi cine");
    expect(text(html)).toContain("Cine vine (4)");
    // From the page's one read of the answers, as before: the members came with it.
    expect(reads.rsvps).toEqual([id]);
  });

  it("uses the Romanian forms of «membru»: one, a few, twenty", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, remembered("ana@example.test", { displayName: "Ana", showName: true, clubMember: true }), at(1));
    const one = await draw(slug);
    expect(factsLink(one)).toBe("1 vine · 1 membru · vezi cine");
    expect(text(one)).toContain("Confirmă prezența (opțional) · 1 vine · 1 membru");
    for (let n = 2; n <= 20; n += 1) await answerRsvp(db, id, remembered(`m${n}@example.test`, { clubMember: true }), at(n));
    fakeNextCache.reset();
    expect(factsLink(await draw(slug))).toBe("20 vin · 20 de membri · vezi cine");
  });

  it("says nothing of members when none is: the lines and the rows are what they were", async () => {
    const { id, slug } = await seed();
    await answerRsvp(db, id, remembered("bia@example.test", { displayName: "Bia Ionescu", showName: true }), at(1));
    const html = await draw(slug);
    expect(marks(html)).toBe(0);
    // (The tick's help says «membri» in words; what is absent is a count of them.)
    expect(text(html)).not.toMatch(/\d+ (de )?membr(i|u)/);
    expect(text(html)).not.toContain("Dintre ei");
    expect(factsLink(html)).toBe("1 vine · vezi cine");
  });

  it("says it in English too: the mark's name, the two lines, the sentence", async () => {
    const { id, slug } = await seed();
    await answers(id);
    language = "en";
    const html = await draw(slug);
    expect(text(html)).toContain("Confirm you're coming (optional) · 4 coming · 3 members");
    expect(factsLink(html)).toBe("4 coming · 3 members · see who");
    expect(text(html)).toContain("Members among them: 3 members.");
    expect(marks(html)).toBe(2);
    expect(html).toContain(`${CLUB_NAME} member`);
  });

  it("shows no mark and no member count while the notice in force does not describe the mark — whatever the rows say", async () => {
    const { id, slug } = await seed();
    await answers(id);
    // The same notice without the member marker, taking over from now on: the rows above still hold their kinds.
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpMember}}", ""));
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: strip(privacyNoticeRo) },
      { locale: "en", title: "Privacy", body: strip(privacyNoticeEn) },
    ];
    await db.delete(legalDocuments);
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    fakeNextCache.reset();
    const html = await draw(slug);
    expect(marks(html)).toBe(0);
    expect(text(html)).not.toMatch(/\d+ (de )?membr(i|u)/);
    expect(factsLink(html)).toBe("4 vin · vezi cine");
    // The names themselves are shown as ever: the name rule is untouched.
    expect(text(html)).toContain("Ana Popescu");
  });
});

describe("§831 the form's tick «Sunt membru al grupului …» is offered only while the notice describes the mark", () => {
  it("draws the declared tick, off by default, with the club's words behind its «?», in both languages", async () => {
    const { slug } = await seed();
    const html = await draw(slug);
    expect(html).toMatch(/<input[^>]*name="clubMember"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*name="clubMember"/);
    expect(html).not.toMatch(/<input[^>]*name="clubMember"[^>]*checked|<input[^>]*checked[^>]*name="clubMember"/);
    expect(html).toContain(`Sunt membru al grupului ${CLUB_NAME}`);
    expect(html).toContain("Am fost la cel puțin 3 alergări de grup în ultimele 6 luni.");
    language = "en";
    const english = await draw(slug);
    expect(english).toContain(`I am a member of the ${CLUB_NAME} group`);
    expect(english).toContain("I have taken part in at least 3 group runs in the last 6 months.");
  });

  it("draws no tick when the notice in force says nothing of the mark", async () => {
    const { slug } = await seed();
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpMember}}", ""));
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: strip(privacyNoticeRo) },
      { locale: "en", title: "Privacy", body: strip(privacyNoticeEn) },
    ];
    await db.delete(legalDocuments);
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    fakeNextCache.reset();
    const html = await draw(slug);
    expect(html).not.toContain('name="clubMember"');
    expect(html).not.toContain("Sunt membru al grupului");
    // «Vin!» itself is untouched: the box and its name tick stand.
    expect(html).toContain('name="showName"');
  });
});
