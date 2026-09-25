import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the race's listing card carries the event page's registration door: the state as a bold
 * line with the free places ("Înscrieri deschise până pe … · 7 locuri libere din 10"), and the
 * page's own button under it. The owner, 2026-09-25: "trebuie să văd butonul de înscrieri pe card
 * pentru evenimentele de tip concurs; să fac bold pe asta cu înscrierile și să văd câte locuri sunt
 * disponibile".
 *
 * Rendered from a real database (PGlite), through the public cache's read-through outside a Next
 * server, so the count is the allocator's formula end to end — and the page's `RegistrationCta` is
 * rendered beside the card for the same row, to prove the card offers the page's door, not a second one.
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
/** The locale-aware link, as a plain anchor: `/events/[slug]` and `/events/[slug]/register`. */
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
const { default: SeriesCard } = await import("@/modules/events/ui/SeriesCard");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const HOUR = 3_600_000;

type Row = Partial<typeof events.$inferInsert>;

async function publish(values: Row, slug = "cros") {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      registrationClosesAt: new Date("2026-09-26T07:00:00.000Z"),
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Parcul Tractorul",
      ...values,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug, title: "Crosul Tractorul" },
    { eventId: event.id, locale: "en", slug: `${slug}-en`, title: "Tractorul Cross" },
  ]);
  return event;
}

async function take(eventId: string, n: number, status: "CONFIRMED" | "WAITLISTED" = "CONFIRMED", from = 0) {
  for (let i = from; i < from + n; i += 1) {
    const email = `card${i}@example.org`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${i}`, preferredLocale: "ro" })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${i}`,
      displayName: `Runner ${i}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
    });
  }
}

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");

async function row(slug = "cros") {
  const event = await findPublishedEventBySlug(db, locale, locale === "ro" ? slug : `${slug}-en`);
  if (!event) throw new Error("the event did not publish");
  return event;
}
const card = async (slug = "cros") => markup(createElement(EventCard, { event: await row(slug), index: 0, now: NOW }));
const page = async (slug = "cros") => markup(await RegistrationCta({ event: await row(slug), now: NOW }));

/** The card's registration line: its opening tag (for the weight) and its words. */
function line(html: string): { tag: string; words: string } {
  const open = /<[^<>]*\bdata-fact="registration"[^>]*>/.exec(html);
  if (!open) throw new Error("no registration line");
  const rest = html.slice(open.index + open[0].length);
  const end = rest.search(/<[^<>]*\bdata-fact="|<a\b[^>]*>(?:<svg\b[\s\S]*?<\/svg>)?(?:Descrierea completă|Full event description)/);
  return { tag: open[0], words: text(end < 0 ? rest : rest.slice(0, end)).trim() };
}
/** The card's button: the anchor inside the door row, or null. */
function door(html: string): { href: string; words: string; attributes: string } | null {
  const at = html.indexOf('data-fact="door"');
  if (at < 0) return null;
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(html.slice(at));
  if (!anchor) throw new Error("a door row with no link");
  return { href: /href="([^"]*)"/.exec(anchor[1])?.[1] ?? "", words: text(anchor[2]).trim(), attributes: anchor[1] };
}
/** A bold line is set in weight 700 through its Emotion class, whose rule is in the stream's styles. */
async function isBold(html: string, raw: () => Promise<string>): Promise<boolean> {
  const cls = /class="[^"]*\b(css-[\w-]+)"/.exec(line(html).tag)?.[1];
  const styles = await raw();
  return !!cls && new RegExp(`\\.${cls}\\{[^}]*font-weight:\\s*700`).test(styles);
}
const rawCard = async (slug = "cros") => {
  const stream = await renderToReadableStream(createElement(EventCard, { event: await row(slug), index: 0, now: NOW }));
  await stream.allReady;
  return new Response(stream).text();
};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("BR-REQ-041-01 the race's card carries the page's registration door, the places in bold (§NNN)", () => {
  it("says until when and how many places are free, in bold, with the page's register button to the form", async () => {
    const event = await publish({ capacity: 10 });
    await take(event.id, 3);
    const html = await card();
    expect(line(html).words).toBe("Înscrieri deschise până pe sâm., 26 sept. 2026, 10:00 · 7 locuri libere din 10");
    expect(await isBold(html, rawCard)).toBe(true);
    expect(html).toContain('data-testid="card-places"');
    expect(door(html)).toMatchObject({ href: "/ro/evenimente/cros/inscriere", words: "Înscrie-te la eveniment" });
    // The page's own button, in the same words, to the same form.
    expect(await page()).toContain("Înscrie-te la eveniment");
  });

  it("reads the page's own count: the card's free places are the number beside the page's button (BR-REQ-034-01)", async () => {
    const event = await publish({ capacity: 10 });
    await take(event.id, 9);
    expect(line(await card()).words).toMatch(/· 1 loc liber din 10$/);
    const onPage = await page();
    expect(onPage).toContain("1 loc liber");
    expect(onPage).toContain("9 înscriși din 10 locuri");
  });

  it("uses Romanian's «de» from twenty on, and English's own order", async () => {
    await publish({ capacity: 50 });
    expect(line(await card()).words).toMatch(/· 50 de locuri libere din 50$/);
    locale = "en";
    const html = await card();
    expect(line(html).words).toMatch(/^Registration open until Sat, 26 Sept? 2026, 10:00 · 50 places left out of 50$/);
    expect(door(html)?.words).toBe("Register for this event");
  });

  it("shows no number for an uncapped race, and still the button (BR-REQ-034-01 criterion 4)", async () => {
    await publish({ capacity: null });
    const html = await card();
    expect(line(html).words).toBe("Înscrieri deschise până pe sâm., 26 sept. 2026, 10:00");
    expect(html).not.toContain('data-testid="card-places"');
    expect(door(html)?.words).toBe("Înscrie-te la eveniment");
  });

  it("says «Lista de așteptare» once the places are gone, and offers the waiting list's button", async () => {
    const event = await publish({ capacity: 2 });
    await take(event.id, 2);
    const html = await card();
    expect(line(html).words).toBe("Înscrieri deschise până pe sâm., 26 sept. 2026, 10:00 · Lista de așteptare");
    expect(door(html)).toMatchObject({ href: "/ro/evenimente/cros/inscriere", words: "Intră pe lista de așteptare" });
    expect(await page()).toContain("Intră pe lista de așteptare");
  });

  it("offers no button when the waiting list is full or the race keeps none — as the page (§348)", async () => {
    const event = await publish({ capacity: 2, waitlistCapacity: 1 });
    await take(event.id, 2);
    await take(event.id, 1, "WAITLISTED", 2);
    let html = await card();
    expect(line(html).words).toBe("Locurile și lista de așteptare sunt pline.");
    expect(door(html)).toBeNull();
    expect(await page()).not.toContain("Înscrie-te");

    await resetTables(db);
    const none = await publish({ capacity: 1, waitlistCapacity: 0 });
    await take(none.id, 1);
    html = await card();
    expect(line(html).words).toBe("Toate locurile au fost ocupate, așa că înscrierile s-au închis.");
    expect(door(html)).toBeNull();
  });

  it("names the opening day in bold before the window, with no button and no read of the count", async () => {
    await publish({ capacity: 10, registrationOpensAt: new Date("2026-10-01T15:00:00Z"), registrationClosesAt: null });
    const html = await card();
    expect(line(html).words).toBe("Înscrierile se deschid pe joi, 1 oct. 2026, 18:00");
    expect(await isBold(html, rawCard)).toBe(true);
    expect(door(html)).toBeNull();
  });

  it("keeps a closed window, a cancelled and a held race quiet, as before, with no button", async () => {
    await publish({ capacity: 10, registrationClosesAt: new Date(NOW.getTime() - HOUR) });
    let html = await card();
    expect(line(html).words).toBe("Înscrierile s-au închis");
    expect(await isBold(html, rawCard)).toBe(false);
    expect(door(html)).toBeNull();

    await resetTables(db);
    await publish({ capacity: 10, eventStatus: "CANCELLED" });
    html = await card();
    expect(line(html).words).toBe("Evenimentul a fost anulat");
    expect(door(html)).toBeNull();
  });

  it("sends an event registered elsewhere to the organizer's own page, as the page does", async () => {
    await publish({ registrationMode: "EXTERNAL", registrationClosesAt: null, externalRegistrationUrl: "https://entries.example.test/cros", externalProvider: "Entries" });
    const html = await card();
    expect(line(html).words).toBe("Înscriere pe site-ul organizatorului");
    const button = door(html);
    expect(button).toMatchObject({ href: "https://entries.example.test/cros", words: "Înscrie-te pe Entries" });
    expect(button?.attributes).toContain('target="_blank"');
    expect(button?.attributes).toContain('rel="noopener noreferrer nofollow"');
  });

  it("leaves an event that takes no registration as it was: the quiet sentence, no button (NONE unchanged)", async () => {
    await publish({ type: "HIKE", registrationMode: "NONE", registrationClosesAt: null });
    const html = await card();
    expect(line(html).words).toBe("Nu este necesară înscrierea");
    expect(await isBold(html, rawCard)).toBe(false);
    expect(door(html)).toBeNull();
  });

  it("gives a series of races one door, the next date's, on its one card (§113)", async () => {
    const first = await publish({ capacity: 10 }, "cros-1");
    await publish({ capacity: 10, startsAt: new Date("2026-11-28T07:00:00.000Z"), registrationClosesAt: new Date("2026-11-27T07:00:00.000Z") }, "cros-2");
    await take(first.id, 4);
    const members = [await row("cros-1"), await row("cros-2")];
    const html = await markup(createElement(SeriesCard, { members, index: 0, now: NOW }));
    expect(line(html).words).toMatch(/· 6 locuri libere din 10$/);
    expect(door(html)).toMatchObject({ href: "/ro/evenimente/cros-1/inscriere", words: "Înscrie-te la eveniment" });
    expect(html.match(/data-fact="door"/g)).toHaveLength(1);
  });

  it("says nothing about registration on a group run (§111)", async () => {
    await publish({ type: "GROUP_RUN", registrationMode: "NONE", registrationClosesAt: null });
    const html = await card();
    expect(html).not.toContain('data-fact="registration"');
    expect(door(html)).toBeNull();
  });
});
