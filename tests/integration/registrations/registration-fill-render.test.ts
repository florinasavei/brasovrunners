import { createFormatter, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
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

async function confirm(eventId: string, n: number, status: "CONFIRMED" | "WAITLISTED" = "CONFIRMED", from = 0) {
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
    expect(html).toContain("Locurile și lista de așteptare sunt pline.");
    expect(html).toContain("2 înscriși din 2 locuri");
    expect(html).not.toContain("Înscrie-te");
  });

  it("is null for an uncapped event, and the line's limit means nothing there", async () => {
    const event = await openRace(null, 5);
    expect(await cachedPublicAvailability(event.id, NOW)).toBeNull();
  });

  it("says how full it is in Romanian, and the free places beside it add up to the size", async () => {
    const event = await openRace(50);
    await confirm(event.id, 12);
    const html = await render("cros-plin");
    expect(html).toContain("12 înscriși din 50 de locuri");
    expect(html).toContain("38 de locuri libere");
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
