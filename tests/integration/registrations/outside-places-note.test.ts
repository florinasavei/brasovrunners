import { readFileSync } from "node:fs";
import path from "node:path";
import { createFormatter, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN «Lista ascunsă», the public side: while an event's «Folosește lista ascunsă» is on, the places
 * line beside the register button carries one sentence — organisers, volunteers and invited runners may
 * be at the start outside the advertised places, taking none of them — in the visitor's words, never
 * the backoffice's «Lista ascunsă». Off, nothing — unless somebody already on the list still holds a
 * place, who still starts outside the advertised places; an uncapped event, which advertises no places, nothing.
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
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ children }: { children: unknown }) => children,
}));

const { default: RegistrationCta } = await import("@/modules/events/ui/RegistrationCta");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const ROOT = path.resolve(__dirname, "../../..");

async function openRace(capacity: number | null, hiddenListEnabled: boolean) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      hiddenListEnabled,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      locationName: "Parcul Tractorul",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross", title: "Cross" },
  ]);
  return event;
}

async function confirmed(eventId: string, n: number, outsideCapacity = false, from = 0) {
  for (let i = from; i < from + n; i += 1) {
    const email = `runner${i}@example.org`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${i}`, preferredLocale: "ro" })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status: "CONFIRMED",
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${i}`,
      displayName: `Runner ${i}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      confirmedAt: NOW,
      outsideCapacity,
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

describe("§NNN the places line's sentence while the event uses the hidden list", () => {
  it("is said beside the places line with the switch on, in both languages, in the visitor's words", async () => {
    const event = await openRace(10, true);
    await confirmed(event.id, 3);
    await confirmed(event.id, 2, true, 3);
    const html = await render("cros");
    expect(html).toContain('data-testid="registration-outside-places"');
    expect(html).toContain(ro.Event.cta.outsidePlacesNote);
    // The places line never counts the hidden list: 3 of 10, not 5.
    expect(html).toContain("3 înscriși din 10 locuri");
    expect(html.indexOf("3 înscriși din 10 locuri")).toBeLessThan(html.indexOf(ro.Event.cta.outsidePlacesNote));
    // The backoffice's name is never on a public page.
    expect(html).not.toMatch(/lista ascunsă/i);
    locale = "en";
    const english = await render("cross");
    expect(english).toContain(en.Event.cta.outsidePlacesNote);
    expect(english).not.toMatch(/hidden list/i);
  });

  it("is not said with the switch off while nobody on the list holds a place", async () => {
    const event = await openRace(10, false);
    await confirmed(event.id, 3);
    // On the list once, cancelled since: they start nowhere.
    await confirmed(event.id, 1, true, 3);
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN" }).where(eq(registrations.outsideCapacity, true));
    const html = await render("cros");
    expect(html).toContain("3 înscriși din 10 locuri");
    expect(html).not.toContain('data-testid="registration-outside-places"');
    expect(html).not.toContain(ro.Event.cta.outsidePlacesNote);
  });

  it("is still said with the switch off while somebody already on the list holds a place — confirmed or a hold", async () => {
    // Unticking the switch changes nothing for those already on the list: they still start outside the
    // advertised places, so the page that reads «10 din 10» must still say so.
    const event = await openRace(10, false);
    await confirmed(event.id, 10);
    await confirmed(event.id, 1, true, 10);
    const html = await render("cros");
    expect(html).toContain("10 înscriși din 10 locuri");
    expect(html).toContain('data-testid="registration-outside-places"');
    expect(html).toContain(ro.Event.cta.outsidePlacesNote);
    expect(html).not.toMatch(/lista ascunsă/i);

    // A hold on the list counts the same.
    await db.update(registrations).set({ status: "PENDING_DECLARATION", confirmedAt: null, holdExpiresAt: new Date("2026-11-19T07:00:00.000Z") }).where(eq(registrations.outsideCapacity, true));
    expect(await render("cros")).toContain(ro.Event.cta.outsidePlacesNote);
  });

  it("is not said on an uncapped event, which advertises no places", async () => {
    await openRace(null, true);
    const html = await render("cros");
    expect(html).not.toContain(ro.Event.cta.outsidePlacesNote);
  });

  it("is one short sentence in both catalogues, and the event page's cached row is keyed for the switch", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.cta.outsidePlacesNote.length).toBeLessThan(200);
      expect(catalogue.Event.cta.outsidePlacesNote).not.toMatch(/ascuns|hidden/i);
    }
    expect(ro.Event.cta.outsidePlacesNote).toContain("în afara locurilor anunțate");
    expect(en.Event.cta.outsidePlacesNote).toContain("outside the advertised places");
    const reads = readFileSync(path.join(ROOT, "src/modules/public-cache/reads.ts"), "utf8");
    expect(reads).toContain('["events.by-slug", locale, slug, "hidden-list"]');
  });
});
