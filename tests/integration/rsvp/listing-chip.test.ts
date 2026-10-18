import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §812, «Vin!» part 2 (BR-REQ-041-01 criterion 6) — the listing card's «N vin» chip: drawn by the event card for an event it is told
 * has confirmed answers, a link to the page's `#vin`, 44 pixels tall around the small chip, in the house's plural; not drawn for none,
 * and never by a series card. The conditions that give a card its number are `readComing`'s (tested beside it); this file holds the markup.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
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
/** The locale-aware link, as a plain anchor: the event's page is `/<locale>/evenimente/<slug>`. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: { pathname?: string; params?: { slug?: string } }) => `/${language}/evenimente/${href.params?.slug ?? ""}`;
  return {
    getPathname: ({ href }: { href: { pathname?: string; params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, className }: { href: { pathname?: string; params?: { slug?: string } }; children: ReactNode; className?: string }) =>
      createElement("a", { href: path(href), className }, children),
  };
});

const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: ListingCard } = await import("@/modules/events/ui/ListingCard");

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
  language = "ro";
});

async function seed(slug: string, startsAt = new Date(NOW.getTime() + 2 * DAY)) {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt, registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug, title: "Alergarea de joi" },
    { eventId: event.id, locale: "en", slug: `${slug}-en`, title: "Thursday run" },
  ]);
  const found = await findPublishedEventBySlug(db, language, language === "ro" ? slug : `${slug}-en`);
  if (!found) throw new Error("the event did not publish");
  return found;
}

/** A card suspends on its client islands; the stream is read to its end. Emotion's rules are kept: the 44 pixels are one of them. */
async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

describe("§812 the listing card's «N vin» chip", () => {
  it("is a link to the page's #vin that says how many come, in the house's plural", async () => {
    const event = await seed("alergarea-de-joi");
    const five = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, comingCount: 5 })));
    expect(five).toMatch(/<a[^>]*href="\/ro\/evenimente\/alergarea-de-joi#vin"[^>]*data-testid="coming-chip"|<a[^>]*data-testid="coming-chip"[^>]*href="\/ro\/evenimente\/alergarea-de-joi#vin"/);
    expect(five).toMatch(/data-testid="coming-chip"[\s\S]*?5 vin</);
    const one = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, comingCount: 1 })));
    expect(one).toMatch(/data-testid="coming-chip"[\s\S]*?1 vine</);
    const twentyOne = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, comingCount: 21 })));
    expect(twentyOne).toMatch(/data-testid="coming-chip"[\s\S]*?21 vin</);
  });

  it("is 44 pixels tall around the small chip: the link is the box, the chip its content", async () => {
    const event = await seed("alergarea-de-joi");
    const html = await markup(createElement(EventCard, { event, index: 0, now: NOW, comingCount: 3 }));
    const anchor = /<a[^>]*data-testid="coming-chip"[^>]*class="([^"]*)"/.exec(html) ?? /<a[^>]*class="([^"]*)"[^>]*data-testid="coming-chip"/.exec(html);
    expect(anchor).not.toBeNull();
    const rule = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
    const className = anchor![1].split(" ").find((name) => name.startsWith("css-"))!;
    expect(rule).toMatch(new RegExp(`\\.${className}\\{[^}]*min-height:44px`));
    expect(rule).toMatch(new RegExp(`\\.${className}\\{[^}]*min-width:44px`));
  });

  it("says it in English", async () => {
    language = "en";
    const event = await seed("alergarea-de-joi");
    const html = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, comingCount: 4 })));
    expect(html).toMatch(/href="\/en\/evenimente\/alergarea-de-joi-en#vin"/);
    expect(html).toMatch(/data-testid="coming-chip"[\s\S]*?4 coming</);
  });

  it("is not drawn for none, or without a number: a card of an event nobody answered says nothing", async () => {
    const event = await seed("alergarea-de-joi");
    for (const props of [{}, { comingCount: 0 }]) {
      const html = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, ...props })));
      expect(html).not.toContain("coming-chip");
      expect(html).not.toContain("#vin");
    }
  });

  it("is worn by the lead event too: it is this card", async () => {
    const event = await seed("alergarea-de-joi");
    const html = withoutStyles(await markup(createElement(EventCard, { event, index: 0, now: NOW, featured: { raceWeekDays: 7 }, comingCount: 2 })));
    expect(html).toContain('data-testid="coming-chip"');
  });

  it("is worn by a single date's listing card and never by a series card, whatever number it is handed", async () => {
    const first = await seed("alergarea-de-joi");
    const second = await seed("alergarea-de-joi-2", new Date(NOW.getTime() + 9 * DAY));
    const single = withoutStyles(await markup(createElement(ListingCard, { members: [first], index: 0, now: NOW, comingCount: 3 })));
    expect(single).toContain('data-testid="coming-chip"');
    const series = withoutStyles(await markup(createElement(ListingCard, { members: [first, second], index: 0, now: NOW, comingCount: 3 })));
    expect(series).not.toContain("coming-chip");
    expect(series).not.toContain("#vin");
  });
});
