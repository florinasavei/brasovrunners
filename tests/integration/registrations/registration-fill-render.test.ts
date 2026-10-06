import { eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { platformSettings } from "@/db/schema/platform-settings";
import { DEADLINES_SETTING_KEY } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { cachedPublicAvailability } from "@/modules/public-cache/reads";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §346 public fill count, integrated onto the public cache (§333) — "12 înscriși din 50 de
 * locuri" beside the register button, rendered from a real database.
 *
 * The branch that built the line read the internal row and the allocator's formula straight
 * from the pool in `RegistrationCta`; on the integrated tree the component asks the cache
 * (`cachedPublicAvailability`) for both numbers at once — the free places the formula gives and
 * the size of the very row it counted — so the fill line and the free-place line are one cache
 * entry read twice, never a second count. Outside a Next server the cache reads straight
 * through (`public-cache/cache.ts`), so this is the formula on PGlite, end to end.
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
// The button is a client island over next-intl's navigation, which needs a request; its label
// is all this test could read of it, so its bare label stands in for it.
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ children }: { children: unknown }) => children,
}));

const { default: RegistrationCta } = await import("@/modules/events/ui/RegistrationCta");

const NOW = new Date("2026-09-24T10:00:00.000Z");

async function openRace(capacity: number | null, waitlistCapacity: number | null = null) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      waitlistCapacity,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Parcul Tractorul",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-plin", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "full-cross", title: "Cross" },
  ]);
  return event;
}

async function confirm(eventId: string, n: number, status: "CONFIRMED" | "WAITLISTED" | "WAITLIST_OFFERED" | "PENDING_DECLARATION" = "CONFIRMED", from = 0) {
  for (let i = from; i < from + n; i += 1) {
    const email = `runner${i}@example.org`;
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
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date("2026-10-02T10:00:00.000Z") : null,
    });
  }
}

async function render(slug: string) {
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) throw new Error("the event did not publish");
  return renderToStaticMarkup(await RegistrationCta({ event, now: NOW }));
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("§346 the fill line beside the register button, from the cached count", () => {
  it("answers both numbers from one cached read: the free places and the row's own size", async () => {
    const event = await openRace(50);
    await confirm(event.id, 12);
    expect(await cachedPublicAvailability(event.id, NOW)).toEqual({
      available: 38,
      capacity: 50,
      waitlistRoom: null,
      waitlistCapacity: null,
      waiting: 0,
      // The line's two halves, from the same read (§612).
      offered: 0,
      waitlisted: 0,
      confirmed: 12,
      occupied: 12,
      // «Arată public câți așteaptă» (§634), off the same row: on by default.
      waitlistCountPublic: true,
      // «Arată public numărătoarea» (§668), off the same row: on by default.
      participantCountPublic: true,
    });
  });

  it("carries the waiting list's room and limit in the same entry (§350 waiting-list length)", async () => {
    const event = await openRace(2, 3);
    await confirm(event.id, 2);
    await confirm(event.id, 1, "WAITLISTED", 2);
    expect(await cachedPublicAvailability(event.id, NOW)).toEqual({
      available: 0,
      capacity: 2,
      waitlistRoom: 2,
      waitlistCapacity: 3,
      waiting: 1,
      // One waiting with no offer yet (§612).
      offered: 0,
      waitlisted: 1,
      confirmed: 2,
      occupied: 2,
      // «Arată public câți așteaptă» (§634), off the same row: on by default.
      waitlistCountPublic: true,
      // «Arată public numărătoarea» (§668), off the same row: on by default.
      participantCountPublic: true,
    });
  });

  it("renders the fill line and the waiting list's room from that one read", async () => {
    const event = await openRace(2, 3);
    await confirm(event.id, 2);
    await confirm(event.id, 1, "WAITLISTED", 2);
    const html = await render("cros-plin");
    expect(html).toContain("2 înscriși din 2 locuri");
    expect(html).toContain("Mai sunt 2 locuri pe lista de așteptare");
  });

  it("says the places and the line are full, with the fill line and no button, at the limit", async () => {
    const event = await openRace(2, 1);
    await confirm(event.id, 2);
    await confirm(event.id, 1, "WAITLISTED", 2);
    const html = await render("cros-plin");
    expect(html).toContain("Locurile s-au ocupat și lista de așteptare e plină — ne pare rău.");
    expect(html).toContain("2 înscriși din 2 locuri");
    expect(html).not.toContain("Înscrie-te");
  });

  it("§587 says kindly that the places are taken, the room left, and the club's own offer hours (§377)", async () => {
    const event = await openRace(2, 3);
    await confirm(event.id, 2);
    await db.insert(platformSettings).values({ key: DEADLINES_SETTING_KEY, value: { ...DEFAULT_DEADLINES, offerHours: 12 }, updatedAt: NOW });
    const html = await render("cros-plin");
    expect(html).toContain('data-testid="registration-waitlist-message"');
    expect(html).toContain("Mulțumim! Toate cele 2 locuri s-au ocupat. Fii primul pe lista de așteptare.");
    expect(html).toContain("Intră pe lista de așteptare — te anunțăm pe email când se eliberează un loc.");
    expect(html).toContain("Mai sunt 3 locuri pe lista de așteptare");
    expect(html).toContain("Când se eliberează un loc, primești un email și ai 12 ore să confirmi — altfel locul trece mai departe.");
    // The two sentences come before the button, the offer after the room.
    expect(html.indexOf("Mulțumim!")).toBeLessThan(html.indexOf(">Intră pe lista de așteptare<"));
    expect(html.indexOf("Mai sunt 3 locuri")).toBeLessThan(html.indexOf("ai 12 ore"));
    locale = "en";
    const en = await render("full-cross");
    expect(en).toContain("Thank you! All 2 places are taken. Be the first on the waiting list.");
    expect(en).toContain("When a place frees up, you get an email and 12 hours to confirm — then it passes on.");
  });

  it("is null for an uncapped event, and the line's limit means nothing there", async () => {
    const event = await openRace(null, 5);
    expect(await cachedPublicAvailability(event.id, NOW)).toBeNull();
  });

  it("says how full it is in Romanian, and the free places beside it add up to the size", async () => {
    const event = await openRace(50);
    await confirm(event.id, 12);
    const html = await render("cros-plin");
    expect(html).toContain("12 înscriși din 50 de locuri</p>");
    expect(html).toContain("38 de locuri libere");
  });

  it("§615 says how many are confirmed and how many in progress, from the cache through the door", async () => {
    const event = await openRace(50);
    await confirm(event.id, 12);
    await confirm(event.id, 3, "PENDING_DECLARATION", 12);
    const html = await render("cros-plin");
    expect(html).toContain("15 înscriși din 50 de locuri — 12 confirmați, 3 în curs de confirmare");
  });

  it("§615 keeps the clause on a full race with somebody in the line", async () => {
    const event = await openRace(5, 3);
    await confirm(event.id, 3);
    await confirm(event.id, 2, "PENDING_DECLARATION", 3);
    await confirm(event.id, 1, "WAITLISTED", 5);
    const html = await render("cros-plin");
    expect(html).toContain("5 înscriși din 5 locuri — 3 confirmați, 2 în curs de confirmare");
  });

  it("§615 adds up while people wait beside free places, automatic offers off", async () => {
    const event = await openRace(10);
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
    await confirm(event.id, 4);
    await confirm(event.id, 2, "PENDING_DECLARATION", 4);
    await confirm(event.id, 4, "WAITLISTED", 6);
    const html = await render("cros-plin");
    expect(html).toContain("6 înscriși din 10 locuri — 4 confirmați, 2 în curs de confirmare, 4 locuri păstrate pentru lista de așteptare");
    expect(html).toContain("Mulțumim! Toate cele 10 locuri s-au ocupat — 4 așteaptă deja un loc.");
    locale = "en";
    const en = await render("full-cross");
    expect(en).toContain("6 registered of 10 places — 4 confirmed, 2 completing their registration, 4 places kept for the waiting list");
  });

  it("§615 keeps the first number at 6 with nothing pending, and names the claim", async () => {
    const event = await openRace(10);
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
    await confirm(event.id, 6);
    await confirm(event.id, 4, "WAITLISTED", 6);
    const html = await render("cros-plin");
    expect(html).toContain("6 înscriși din 10 locuri — 4 locuri păstrate pentru lista de așteptare");
    expect(html).toContain("Mulțumim! Toate cele 10 locuri s-au ocupat — 4 așteaptă deja un loc.");
    locale = "en";
    const en = await render("full-cross");
    expect(en).toContain("6 registered of 10 places — 4 places kept for the waiting list");
  });

  it("§615 counts a lapsed declaration hold as free when the line has no room: places plus free add up", async () => {
    const event = await openRace(10, 0);
    await confirm(event.id, 6);
    await confirm(event.id, 2, "PENDING_DECLARATION", 6);
    await db.update(registrations).set({ holdExpiresAt: new Date("2026-09-20T10:00:00.000Z") }).where(eq(registrations.status, "PENDING_DECLARATION"));
    const html = await render("cros-plin");
    expect(html).toContain("6 înscriși din 10 locuri</p>");
    expect(html).toContain("4 locuri libere");
    expect(html).not.toContain("în curs de confirmare");
  });

  it("§629 says how many wait on the places line, once, while places are free beside the line (automatic offers off)", async () => {
    const event = await openRace(10);
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
    await confirm(event.id, 4);
    await confirm(event.id, 2, "WAITLISTED", 4);
    const html = await render("cros-plin");
    expect(html).toContain("4 înscriși din 10 locuri — 2 locuri păstrate pentru lista de așteptare, 2 pe lista de așteptare</p>");
    // The number is in the card once: the separate line of its own is gone where the places line carries it.
    expect(html).not.toContain('data-testid="waitlist-waiting"');
    expect(html.match(/2 pe lista de așteptare/g)).toHaveLength(1);
    locale = "en";
    const en = await render("full-cross");
    expect(en).toContain("4 registered of 10 places — 2 places kept for the waiting list, 2 on the waiting list</p>");
  });

  it("§629 reads waiting before offered on the page: the places line carries the waiting, the offer's own line follows it", async () => {
    const event = await openRace(10);
    await confirm(event.id, 4);
    await confirm(event.id, 1, "WAITLIST_OFFERED", 4);
    await confirm(event.id, 3, "WAITLISTED", 5);
    const html = await render("cros-plin");
    const waiting = html.indexOf("3 pe lista de așteptare");
    const offered = html.indexOf('data-testid="waitlist-offered"');
    expect(waiting).toBeGreaterThan(-1);
    expect(offered).toBeGreaterThan(-1);
    expect(waiting).toBeLessThan(offered);
    expect(html).toContain("1 loc oferit din lista de așteptare");
    expect(html.match(/3 pe lista de așteptare/g)).toHaveLength(1);
  });

  it("§629 leaves the places line as it was when nobody waits", async () => {
    const event = await openRace(10);
    await confirm(event.id, 4);
    const html = await render("cros-plin");
    expect(html).toContain("4 înscriși din 10 locuri</p>");
    expect(html).not.toContain("pe lista de așteptare");
  });

  it("§629 counts a waiting TEST row like a real one: the page reads the same count the allocator does", async () => {
    const event = await openRace(10);
    await confirm(event.id, 4);
    await confirm(event.id, 1, "WAITLISTED", 4);
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.status, "WAITLISTED"));
    const html = await render("cros-plin");
    expect(html).toContain("1 pe lista de așteptare</p>");
  });

  it("§629 keeps the full state's lead as the one place the number is said: the places line leaves it out", async () => {
    const event = await openRace(2, 5);
    await confirm(event.id, 2);
    await confirm(event.id, 3, "WAITLISTED", 2);
    const html = await render("cros-plin");
    expect(html).toContain("Mulțumim! Toate cele 2 locuri s-au ocupat — 3 așteaptă deja un loc.");
    expect(html).toContain('data-testid="registration-fill">2 înscriși din 2 locuri</p>');
    expect(html).not.toContain("3 pe lista de așteptare");
  });

  it("§629 says how many wait when the line is full too, where no lead says it", async () => {
    const event = await openRace(2, 1);
    await confirm(event.id, 2);
    await confirm(event.id, 1, "WAITLISTED", 2);
    const html = await render("cros-plin");
    expect(html).toContain("2 înscriși din 2 locuri — 1 pe lista de așteptare</p>");
  });

  it("says it in natural English from the same numbers", async () => {
    const event = await openRace(50);
    await confirm(event.id, 12);
    locale = "en";
    const html = await render("full-cross");
    expect(html).toContain("12 of 50 places taken");
  });

  it("shows no fill line and no number for an uncapped event (BR-REQ-034-01 criterion 4)", async () => {
    await openRace(null);
    const html = await render("cros-plin");
    expect(html).not.toContain('data-testid="registration-fill"');
    expect(html).not.toMatch(/\d+ (de )?înscri/);
  });
});

/**
 * §634 — «Arată public câți așteaptă» (the owner, 2026-10-02: «O să avem o bifă și dacă să afișăm sau
 * nu câți sunt pe lista de așteptare»). Off, the card and the page say that a waiting list exists and how
 * to join it, never how many are on it — in every state that showed the number; the room left in a
 * capped list stays (a fact about the list's size, like the capacity). On, every sentence is today's.
 * From a real database through the cached read and the door, as the page and the listing card read it.
 */
const { readRegistrationDoor } = await import("@/modules/events/ui/registration-door");
const { cardRegistrationLine } = await import("@/modules/events/ui/CardRegistration");
const { datedOrNull } = await import("@/modules/events/domain/dated");

describe("§634 the waiting list's count kept private, on the event page and the listing card", () => {
  const say = (l: "ro" | "en") =>
    createTranslator({ locale: l, messages: l === "ro" ? ro.Event : en.Event, namespace: undefined }) as unknown as (
      key: string,
      values?: Record<string, string | number>,
    ) => string;
  const hide = (id: string) => db.update(events).set({ waitlistCountPublic: false }).where(eq(events.id, id));
  async function card(slug: string) {
    const event = await findPublishedEventBySlug(db, locale, slug);
    const dated = event && datedOrNull(event);
    if (!event || !dated) throw new Error("the event did not publish");
    return cardRegistrationLine(say(locale), locale, dated, NOW, await readRegistrationDoor(event, NOW));
  }

  it("the column is on by default: an event saved without it says the count as before", async () => {
    const event = await openRace(2, 5);
    expect(event.waitlistCountPublic).toBe(true);
    expect((await findPublishedEventBySlug(db, "ro", "cros-plin"))?.waitlistCountPublic).toBe(true);
    expect((await cachedPublicAvailability(event.id, NOW))?.waitlistCountPublic).toBe(true);
  });

  it("full, the list taking people: the thank-you lead without the number, the room line kept, in both languages", async () => {
    const event = await openRace(2, 5);
    await confirm(event.id, 2);
    await confirm(event.id, 3, "WAITLISTED", 2);
    const on = await render("cros-plin");
    const cardOn = await card("cros-plin");
    await hide(event.id);
    const html = await render("cros-plin");
    expect(html).toContain("Mulțumim! Toate cele 2 locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(html).not.toContain("așteaptă deja");
    expect(html).not.toContain("3 pe lista de așteptare");
    expect(html).not.toContain("Fii primul");
    expect(html).toContain('data-testid="registration-fill">2 înscriși din 2 locuri</p>');
    // The room a capped list has left stays: a fact about the event's size (§348), not a count of people.
    expect(html).toContain("Mai sunt 2 locuri pe lista de așteptare");
    expect(html).toContain(">Intră pe lista de așteptare<");
    const cardOff = await card("cros-plin");
    expect(cardOff.lead).toBe("Mulțumim! Toate cele 2 locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(cardOff.roomLine).toBe("Mai sunt 2 locuri pe lista de așteptare");
    expect(cardOff.button?.label).toBe("Intră pe lista de așteptare");
    // Only the number went: the same page with the switch on said today's lead.
    expect(on).toContain("Mulțumim! Toate cele 2 locuri s-au ocupat — 3 așteaptă deja un loc.");
    expect(cardOn.lead).toBe("Mulțumim! Toate cele 2 locuri s-au ocupat — 3 așteaptă deja un loc.");
    locale = "en";
    const enHtml = await render("full-cross");
    expect(enHtml).toContain("Thank you! All 2 places are taken. Join the waiting list.");
    expect(enHtml).not.toContain("already waiting");
    expect(enHtml).toContain("2 places left on the waiting list");
    expect((await card("full-cross")).lead).toBe("Thank you! All 2 places are taken. Join the waiting list.");
  });

  it("full with nobody waiting yet: never «Fii primul», which would say nought", async () => {
    const event = await openRace(2, 5);
    await confirm(event.id, 2);
    await hide(event.id);
    const html = await render("cros-plin");
    expect(html).toContain("Mulțumim! Toate cele 2 locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(html).not.toContain("Fii primul");
    locale = "en";
    expect(await render("full-cross")).not.toContain("Be the first");
  });

  it("places given from the waiting list: the line and the door stay, the people waiting and the places kept for them go", async () => {
    const event = await openRace(10);
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
    await confirm(event.id, 4);
    await confirm(event.id, 1, "WAITLIST_OFFERED", 4);
    await confirm(event.id, 2, "WAITLISTED", 5);
    await hide(event.id);
    const html = await render("cros-plin");
    expect(html).toContain('data-testid="registration-from-waitlist"');
    expect(html).toContain("Locurile se dau din lista de așteptare");
    // The offered place stays: it is a place, not a person waiting.
    expect(html).toContain("1 loc oferit din lista de așteptare");
    expect(html).not.toContain("2 pe lista de așteptare");
    expect(html).not.toContain('data-testid="waitlist-waiting"');
    // «2 locuri păstrate pentru lista de așteptare» would be exactly the people waiting while places are free.
    expect(html).not.toContain("păstrate");
    expect(html).toContain("5 înscriși din 10 locuri — 4 confirmați, 1 în curs de confirmare</p>");
    const cardOff = await card("cros-plin");
    expect(cardOff.detail).toBe("Locurile se dau din lista de așteptare · 1 loc oferit din lista de așteptare");
    expect(cardOff.button?.label).toBe("Intră pe lista de așteptare");
    locale = "en";
    const enHtml = await render("full-cross");
    expect(enHtml).toContain("Places are given from the waiting list");
    expect(enHtml).not.toContain("2 on the waiting list");
    expect(enHtml).not.toContain("kept for the waiting list");
    expect((await card("full-cross")).detail).toBe("Places are given from the waiting list · 1 place offered from the waiting list");
  });

  it("the line full: the refusal and the places line without the people waiting", async () => {
    const event = await openRace(2, 1);
    await confirm(event.id, 2);
    await confirm(event.id, 1, "WAITLISTED", 2);
    await hide(event.id);
    const html = await render("cros-plin");
    expect(html).toContain("Locurile s-au ocupat și lista de așteptare e plină — ne pare rău.");
    expect(html).toContain("2 înscriși din 2 locuri</p>");
    expect(html).not.toContain("1 pe lista de așteptare");
    expect((await card("cros-plin")).lead).toBe(ro.Event.cta.waitlistFull);
    locale = "en";
    expect(await render("full-cross")).not.toContain("1 on the waiting list");
  });

  it("full with places the line claims: those places stay on the line, a fact about places once none is free", async () => {
    const event = await openRace(10);
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, event.id));
    await confirm(event.id, 6);
    await confirm(event.id, 5, "WAITLISTED", 6);
    await hide(event.id);
    const html = await render("cros-plin");
    expect(html).toContain("Mulțumim! Toate cele 10 locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(html).toContain("6 înscriși din 10 locuri — 4 locuri păstrate pentru lista de așteptare</p>");
    expect(html).not.toContain("5 pe lista");
    expect(html).not.toContain("5 așteaptă");
  });

  it("counts a waiting TEST row like a real one: the door still sends a newcomer to the line (§12.6)", async () => {
    const event = await openRace(10);
    await confirm(event.id, 4);
    await confirm(event.id, 1, "WAITLISTED", 4);
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.status, "WAITLISTED"));
    await hide(event.id);
    expect(await cachedPublicAvailability(event.id, NOW)).toMatchObject({ waitlisted: 1, waiting: 1, waitlistCountPublic: false });
    const html = await render("cros-plin");
    expect(html).toContain("Locurile se dau din lista de așteptare");
    expect(html).not.toContain("1 pe lista de așteptare");
  });

  it("switched on again, every sentence is today's, byte for byte", async () => {
    const event = await openRace(2, 5);
    await confirm(event.id, 2);
    await confirm(event.id, 3, "WAITLISTED", 2);
    const before = await render("cros-plin");
    const cardBefore = await card("cros-plin");
    await hide(event.id);
    expect(await render("cros-plin")).not.toBe(before);
    await db.update(events).set({ waitlistCountPublic: true }).where(eq(events.id, event.id));
    expect(await render("cros-plin")).toBe(before);
    expect(await card("cros-plin")).toEqual(cardBefore);
  });
});
