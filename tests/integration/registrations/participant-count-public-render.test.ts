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
import { cachedPublicAvailability } from "@/modules/public-cache/reads";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-034-01, BR-REQ-039-01 (§668, amending §648 point 8) — «Arată public numărătoarea» unticked: the
 * event page's door and the listing card, rendered from a real database (PGlite) through the public
 * cache's read-through, say no number derived from the event's capacity or its registrations — no places
 * line, no free places, no capacity in the full lead, no room, no offered or waiting count — and keep the
 * state words. Ticked again, every byte is today's. `participant-count-public.test.ts` is the pure half.
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
const { draftRegistrationDoor, readRegistrationDoor } = await import("@/modules/events/ui/registration-door");

const NOW = new Date("2026-09-24T10:00:00.000Z");
type Row = Partial<typeof events.$inferInsert>;

/**
 * The numbers this file seeds, each distinct from every digit group of the closing date (19 Nov 2026,
 * 09:00) and of the club's offer hours (24): if any appears as a whole number, a count has leaked.
 */
const CAPACITY = 37;

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
      capacity: CAPACITY,
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
async function take(eventId: string, n: number, status: "CONFIRMED" | "WAITLISTED" | "WAITLIST_OFFERED" | "PENDING_DECLARATION" = "CONFIRMED") {
  for (let i = 0; i < n; i += 1) {
    counter += 1;
    const email = `quiet${counter}@example.org`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${counter}`, preferredLocale: "ro" })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${counter}`,
      displayName: `Runner ${counter}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date("2026-10-02T10:00:00.000Z") : null,
      waitlistedAt: status === "WAITLISTED" ? new Date(NOW.getTime() - counter * 1000) : null,
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
const page = async () => markup(await RegistrationCta({ event: await row(), now: NOW }));
/** The card's registration line and its door, in words. */
async function cardLine(): Promise<string> {
  const html = await markup(createElement(EventCard, { event: await row(), index: 0, now: NOW }));
  const open = /<[^<>]*\bdata-fact="registration"[^>]*>/.exec(html);
  if (!open) throw new Error("no registration line");
  return text(html.slice(open.index)).trim();
}
const untick = (id: string) => db.update(events).set({ participantCountPublic: false }).where(eq(events.id, id));
const tick = (id: string) => db.update(events).set({ participantCountPublic: true }).where(eq(events.id, id));

/** None of these appears as a whole number in what the public reads. */
function expectNoneOf(words: string, numbers: number[], label: string) {
  for (const n of numbers) expect(words, `${label}: ${n}`).not.toMatch(new RegExp(`(^|[^\\d])${n}([^\\d]|$)`));
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("§668 «Arată public numărătoarea» unticked: the event page and the card say no number", () => {
  it("the column is on by default, and the availability entry carries it off the same row", async () => {
    const event = await publish({});
    expect(event.participantCountPublic).toBe(true);
    expect((await cachedPublicAvailability(event.id, NOW))?.participantCountPublic).toBe(true);
    await untick(event.id);
    expect((await cachedPublicAvailability(event.id, NOW))?.participantCountPublic).toBe(false);
  });

  it("open with free places: the register button, no places line and no free places — as an uncapped event", async () => {
    const event = await publish({});
    await take(event.id, 31);
    await take(event.id, 3, "PENDING_DECLARATION");
    const on = await page();
    expect(on).toContain('data-testid="registration-fill"');
    await untick(event.id);
    const html = await page();
    expect(html).not.toContain('data-testid="registration-fill"');
    expect(html).not.toContain("locuri libere");
    expect(html).not.toContain("loc liber");
    expect(text(html)).toContain("Înscrie-te la eveniment");
    expectNoneOf(text(html), [CAPACITY, 31, 3, 34], "page");
    const card = await cardLine();
    expect(card).toContain("Înscrie-te la eveniment");
    expect(card).not.toContain("locuri libere");
    expectNoneOf(card, [CAPACITY, 31, 3, 34], "card");
  });

  it("full, the list taking people: the thank-you with no capacity, no room, no line's length, in both languages", async () => {
    const event = await publish({ waitlistCapacity: 40 });
    await take(event.id, 31);
    await take(event.id, 6, "PENDING_DECLARATION");
    await take(event.id, 13, "WAITLISTED");
    await untick(event.id);
    const html = await page();
    expect(text(html)).toContain("Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.");
    expect(text(html)).toContain(ro.Event.cta.fullJoin);
    expect(html).not.toContain('data-testid="registration-fill"');
    expect(html).not.toContain('data-testid="waitlist-room"');
    expect(html).not.toContain("așteaptă deja");
    expect(text(html)).toContain("Intră pe lista de așteptare");
    expectNoneOf(text(html), [CAPACITY, 31, 6, 13, 27], "page");
    const card = await cardLine();
    expect(card).toContain("Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.");
    expect(card).not.toContain("Mai sunt");
    expectNoneOf(card, [CAPACITY, 31, 6, 13, 27], "card");
    locale = "en";
    const enHtml = await page();
    expect(text(enHtml)).toContain("Thank you! All places are taken. Join the waiting list.");
    expect(enHtml).not.toContain("places left on the waiting list");
    expectNoneOf(text(enHtml), [CAPACITY, 31, 6, 13, 27], "page en");
  });

  it("full, the list full, or no list: the refusal's words, no places line", async () => {
    const full = await publish({ waitlistCapacity: 13 });
    await take(full.id, CAPACITY);
    await take(full.id, 13, "WAITLISTED");
    await untick(full.id);
    const html = await page();
    expect(text(html)).toContain(ro.Event.cta.waitlistFull);
    expect(html).not.toContain('data-testid="registration-fill"');
    expectNoneOf(text(html), [CAPACITY, 13], "list full");
    expect(await cardLine()).toContain(ro.Event.cta.waitlistFull);

    await resetTables(db);
    const none = await publish({ waitlistCapacity: 0 });
    await take(none.id, CAPACITY);
    await untick(none.id);
    const closed = await page();
    expect(text(closed)).toContain(ro.Event.cta.fullNoWaitlist);
    expect(closed).not.toContain('data-testid="registration-fill"');
    expectNoneOf(text(closed), [CAPACITY], "no list");
  });

  it("places given from the waiting list, offers out: the line's door and its words, no offered or waiting count", async () => {
    const event = await publish({ waitlistAutoOffer: false });
    await take(event.id, 29);
    await take(event.id, 3, "WAITLIST_OFFERED");
    await take(event.id, 4, "WAITLISTED");
    const on = await page();
    expect(on).toContain('data-testid="waitlist-offered"');
    await untick(event.id);
    const html = await page();
    expect(html).toContain('data-testid="registration-from-waitlist"');
    expect(text(html)).toContain("Locurile se dau din lista de așteptare");
    expect(html).not.toContain('data-testid="waitlist-offered"');
    expect(html).not.toContain('data-testid="waitlist-waiting"');
    expect(html).not.toContain('data-testid="registration-fill"');
    expect(html).not.toContain("păstrate");
    expectNoneOf(text(html), [CAPACITY, 29, 3, 4, 32, 5], "page");
    const card = await cardLine();
    expect(card).toContain("Locurile se dau din lista de așteptare");
    expect(card).not.toContain("oferit");
    expectNoneOf(card, [CAPACITY, 29, 3, 4, 32, 5], "card");
  });

  it("the special guests' sentence goes with the places line it stands beside, as on an uncapped event", async () => {
    const event = await publish({ hiddenListEnabled: true });
    await take(event.id, 31);
    expect(await page()).toContain('data-testid="registration-outside-places"');
    await untick(event.id);
    expect(await page()).not.toContain('data-testid="registration-outside-places"');
  });

  it("either the row or the cached entry unticked is enough: a number is never said from a stale copy", async () => {
    const event = await publish({});
    await take(event.id, 31);
    // The row read says off while the entry says on…
    const rowOff = { ...(await row()), participantCountPublic: false };
    const door = await readRegistrationDoor(rowOff, NOW);
    expect(door).toMatchObject({ kind: "KNOWN", fill: null, cta: { kind: "OPEN", availablePlaces: null } });
    // …and the entry says off while the row read says on.
    const rowOn = await row();
    await untick(event.id);
    const stale = { ...rowOn, participantCountPublic: true };
    expect(await readRegistrationDoor(stale, NOW)).toMatchObject({ kind: "KNOWN", fill: null, cta: { kind: "OPEN", availablePlaces: null } });
  });

  it("the editor's preview draws the draft's switch: no number while it is unticked", async () => {
    const event = await publish({ waitlistCapacity: 40 });
    await take(event.id, CAPACITY);
    await take(event.id, 13, "WAITLISTED");
    const view = { ...(await row()), participantCountPublic: false };
    const door = await draftRegistrationDoor(db, view, { capacity: CAPACITY, waitlistCapacity: 40 }, NOW);
    expect(door).toEqual({ kind: "KNOWN", fill: null, cta: { kind: "FULL", waitlistRoom: null, waiting: null } });
    const ticked = await draftRegistrationDoor(db, { ...view, participantCountPublic: true }, { capacity: CAPACITY, waitlistCapacity: 40 }, NOW);
    expect(ticked).toMatchObject({ kind: "KNOWN", fill: { capacity: CAPACITY }, cta: { kind: "FULL", waitlistRoom: 27, waiting: 13 } });
  });

  it("ticked again, the page and the card are today's, byte for byte", async () => {
    const event = await publish({ waitlistCapacity: 40 });
    await take(event.id, 31);
    await take(event.id, 6, "PENDING_DECLARATION");
    await take(event.id, 13, "WAITLISTED");
    const before = await page();
    const cardBefore = await cardLine();
    expect(text(before)).toContain("Toate cele 37 de locuri s-au ocupat — 13 așteaptă deja un loc.");
    await untick(event.id);
    expect(await page()).not.toBe(before);
    await tick(event.id);
    expect(await page()).toBe(before);
    expect(await cardLine()).toBe(cardBefore);
  });
});
