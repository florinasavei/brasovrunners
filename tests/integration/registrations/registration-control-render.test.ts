import { eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { datedOrNull } from "@/modules/events/domain/dated";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §906 — the organizers' door on the event page and the listing card (the owner, 2026-11-03: «cumva trebuie să pot
 * controla mai bine»), rendered from a real database (PGlite) through the public cache's read-through:
 *
 * - «Înscrieri publice deschise» unticked: «Înscrierile pe site sunt oprite de organizatori.», bold on the card, and
 *   no button on either — in both languages;
 * - «Locurile libere le dau doar eu» with places free and a waiting list that takes nobody: its own words, never
 *   «s-au ocupat», no button;
 * - the same tick with room in the line: the waiting list's door and «Locurile se dau din lista de așteptare», never
 *   «Înscrie-te»; on an event with no capacity the tick changes nothing.
 *
 * `registration-control.test.ts` holds the server's half (the refusal, the allocator); the pure door is
 * `tests/unit/registrations/registration-control.test.ts`.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Event" }),
  getFormatter: async () => createFormatter({ locale, timeZone: "Europe/Bucharest" }),
  getLocale: async () => locale,
}));
/** The locale-aware link, as a plain anchor. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: { pathname?: string; params?: { slug?: string } }) =>
    `/${locale}/evenimente/${href.params?.slug ?? ""}${href.pathname?.endsWith("/register") ? "/inscriere" : ""}`;
  return {
    getPathname: ({ href }: { href: { pathname?: string; params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, className }: { href: { pathname?: string; params?: { slug?: string } }; children: ReactNode; className?: string }) =>
      createElement("a", { href: path(href), className }, children),
  };
});

const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: RegistrationCta } = await import("@/modules/events/ui/RegistrationCta");

const NOW = new Date("2026-09-24T10:00:00.000Z");
type Row = Partial<typeof events.$inferInsert>;

async function publish(values: Row) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      registrationClosesAt: new Date("2026-11-19T07:00:00.000Z"),
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Parcul Tractorul",
      capacity: 20,
      ...values,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros", title: "Crosul Tractorul" },
    { eventId: event.id, locale: "en", slug: "cros-en", title: "Tractorul Cross" },
  ]);
  return event;
}

let counter = 0;
/** `n` confirmed runners: places taken, nobody waiting. */
async function take(eventId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    counter += 1;
    const email = `door${counter}@example.org`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${counter}`, preferredLocale: "ro" })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status: "CONFIRMED",
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${counter}`,
      displayName: `Runner ${counter}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      confirmedAt: NOW,
    });
  }
}

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function row() {
  const event = await findPublishedEventBySlug(db, locale, locale === "ro" ? "cros" : "cros-en");
  if (!event) throw new Error("the event did not publish");
  return datedOrNull(event)!;
}
/** The event page's door. */
const page = async () => markup(await RegistrationCta({ event: await row(), now: NOW }));
/** The card's registration line and its door, in words. */
async function cardLine(): Promise<string> {
  const html = await markup(createElement(EventCard, { event: await row(), index: 0, now: NOW }));
  const open = /<[^<>]*\bdata-fact="registration"[^>]*>/.exec(html);
  if (!open) throw new Error("no registration line");
  return text(html.slice(open.index)).trim();
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("§906 «Înscrieri publice deschise» unticked", () => {
  it("the event page and the card say the organizers stopped it, with no button, in both languages", async () => {
    const event = await publish({ publicRegistrationOpen: false });
    await take(event.id, 5);
    const html = await page();
    expect(html).toContain('data-testid="registration-paused"');
    expect(text(html)).toContain(ro.Event.cta.paused);
    expect(text(html)).not.toContain(ro.Event.cta.register);
    expect(text(html)).not.toContain(ro.Event.cta.joinWaitingList);
    const card = await cardLine();
    expect(card).toContain(ro.Event.cta.paused);
    expect(card).not.toContain(ro.Event.cta.register);

    locale = "en";
    const enHtml = await page();
    expect(text(enHtml)).toContain(en.Event.cta.paused);
    expect(text(enHtml)).not.toContain(en.Event.cta.register);
    expect(await cardLine()).toContain(en.Event.cta.paused);
  });

  it("ticked again, the button is back", async () => {
    const event = await publish({ publicRegistrationOpen: false });
    await db.update(events).set({ publicRegistrationOpen: true }).where(eq(events.id, event.id));
    const html = await page();
    expect(html).not.toContain('data-testid="registration-paused"');
    expect(text(html)).toContain(ro.Event.cta.register);
  });
});

describe("§906 «Locurile libere le dau doar eu»", () => {
  it("places free and a waiting list that takes nobody: its own words, never «s-au ocupat», no button", async () => {
    const event = await publish({ freePlacesByOfferOnly: true, waitlistCapacity: 0 });
    await take(event.id, 5);
    const html = await page();
    expect(html).toContain('data-testid="registration-paused"');
    expect(text(html)).toContain(ro.Event.cta.pausedOffersOnly);
    expect(text(html)).not.toContain("s-au ocupat");
    expect(text(html)).not.toContain(ro.Event.cta.register);
    const card = await cardLine();
    expect(card).toContain(ro.Event.cta.pausedOffersOnly);
    expect(card).not.toContain("s-au ocupat");

    locale = "en";
    expect(text(await page())).toContain(en.Event.cta.pausedOffersOnly);
    expect(await cardLine()).toContain(en.Event.cta.pausedOffersOnly);
  });

  it("with room in the line: the waiting list's door beside the free places, never «Înscrie-te»", async () => {
    const event = await publish({ freePlacesByOfferOnly: true, waitlistCapacity: 10 });
    await take(event.id, 5);
    const html = await page();
    expect(html).toContain('data-testid="registration-from-waitlist"');
    expect(text(html)).toContain(ro.Event.cta.fromWaitlist);
    expect(text(html)).toContain(ro.Event.cta.joinWaitingList);
    expect(text(html)).not.toContain(ro.Event.cta.register);
    expect(html).not.toContain('data-testid="registration-paused"');
    const card = await cardLine();
    expect(card).toContain(ro.Event.cta.fromWaitlist);
    expect(card).not.toContain(ro.Event.cta.register);
  });

  it("on an event with no capacity the tick changes nothing: the button is «Înscrie-te»", async () => {
    await publish({ freePlacesByOfferOnly: true, capacity: null });
    const html = await page();
    expect(text(html)).toContain(ro.Event.cta.register);
    expect(html).not.toContain('data-testid="registration-from-waitlist"');
    expect(html).not.toContain('data-testid="registration-paused"');
    expect(await cardLine()).toContain(ro.Event.cta.register);
  });
});

describe("BR-REQ-034-01 «Locuri păstrate pentru club» on the event page and the card (§NNN)", () => {
  it("announces the capacity less the kept places, names no reserve, and reads full once only the kept places are left", async () => {
    const event = await publish({ capacity: 20, placesKeptForClub: 5, waitlistAutoOffer: true });
    await take(event.id, 10);
    // The places the site announces: 15, never the 20 of the capacity.
    const open = text(await page());
    expect(open).toContain(ro.Event.cta.register);
    expect(open).toMatch(/din 15 locuri/);
    expect(open).not.toMatch(/din 20/);
    expect(open).not.toContain("păstrate pentru club");
    const card = await cardLine();
    expect(card).toMatch(/din 15\b/);
    expect(card).not.toMatch(/din 20/);

    // The site's 15 taken, 5 kept places nobody holds: the page and the card read full and open the waiting list.
    await take(event.id, 5);
    const full = text(await page());
    expect(full).toContain(ro.Event.cta.joinWaitingList);
    expect(full).not.toContain(ro.Event.cta.register);
    expect(full).toContain("Toate cele 15 locuri s-au ocupat");
    expect(full).not.toMatch(/\b20\b/);
    expect(full).not.toContain("păstrate pentru club");
    // With places kept, a freed place may stay the club's: the organizers' words, never «te anunțăm», even on «Da».
    expect(full).toContain(ro.Event.cta.fullJoinByHand);
    expect(full).not.toContain(ro.Event.cta.fullJoin);
    expect(await cardLine()).toContain(ro.Event.cta.fullJoinByHand);

    locale = "en";
    const enFull = text(await page());
    expect(enFull).toContain(en.Event.cta.fullJoinByHand);
    expect(enFull).not.toContain(en.Event.cta.fullJoin);
    expect(enFull).not.toMatch(/\b20\b/);
  });
});

describe("§906 how an offer works, on the full event's door", () => {
  /** The door's «how an offer works» line, in words. */
  async function offerLine(): Promise<string> {
    const html = await page();
    const open = /<[^<>]*\bdata-testid="waitlist-offer"[^>]*>/.exec(html);
    if (!open) throw new Error("no offer line");
    return text(html.slice(open.index, html.indexOf("</p>", open.index))).trim();
  }
  const auto = { ro: "Când se eliberează un loc", en: "When a place frees up" };
  const byHand = { ro: "Locurile le dau organizatorii, pe rând", en: "The organizers give out the places one at a time" };

  it("while no place reaches the line by itself — the tick, whatever «Da» says, or «Nu» — says the organizers give them, in both languages", async () => {
    for (const settings of [{ freePlacesByOfferOnly: true, waitlistAutoOffer: true }, { waitlistAutoOffer: false }]) {
      await resetTables(db);
      locale = "ro";
      const event = await publish(settings);
      await take(event.id, 20);
      const line = await offerLine();
      expect(line).toContain(byHand.ro);
      expect(line).not.toContain(auto.ro);
      locale = "en";
      const enLine = await offerLine();
      expect(enLine).toContain(byHand.en);
      expect(enLine).not.toContain(auto.en);
    }
  });

  it("with «Da» and the tick off, a freed place reaches the line by itself: the sentence that says so", async () => {
    const event = await publish({ waitlistAutoOffer: true });
    await take(event.id, 20);
    const line = await offerLine();
    expect(line).toContain(auto.ro);
    expect(line).not.toContain(byHand.ro);
    locale = "en";
    expect(await offerLine()).toContain(auto.en);
  });

  it("the join sentence keeps the same rule, on the page and the card: «te anunțăm…» only while a freed place reaches the line by itself", async () => {
    const cases = [
      { settings: { freePlacesByOfferOnly: true, waitlistAutoOffer: true }, byItself: false },
      { settings: { waitlistAutoOffer: false }, byItself: false },
      { settings: { waitlistAutoOffer: true }, byItself: true },
    ];
    for (const { settings, byItself } of cases) {
      await resetTables(db);
      for (const [lang, words] of [["ro", ro], ["en", en]] as const) {
        locale = lang;
        if (lang === "ro") await take((await publish(settings)).id, 20);
        const said = byItself ? words.Event.cta.fullJoin : words.Event.cta.fullJoinByHand;
        const unsaid = byItself ? words.Event.cta.fullJoinByHand : words.Event.cta.fullJoin;
        const html = await page();
        expect(html, `${lang} ${JSON.stringify(settings)}`).toContain('data-testid="registration-waitlist-message"');
        expect(text(html)).toContain(said);
        expect(text(html)).not.toContain(unsaid);
        const card = await cardLine();
        expect(card).toContain(said);
        expect(card).not.toContain(unsaid);
      }
    }
  });
});
