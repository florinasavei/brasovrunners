import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §92, §349, §369 — the queue panel on `/admin/events/[id]` writes its times in the event's own
 * zone, as every other time of an event is written: the offer's deadline is the one the runner's
 * email names (`notifications/render.ts`, the event's zone), and the club's clock beside it would
 * put two hours on one deadline.
 *
 * The event here is held in New York, so the event's zone and the club's (`Europe/Bucharest`) are
 * seven hours apart and a wrong zone cannot print the right text by accident. `next-intl/server`
 * is mocked to the real translator over the real catalogues, in whichever language the case asks.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never, namespace: undefined });
  },
  getLocale: async () => locale,
}));

// The panel's help sentences name the club's hold and offer (§377), read per request from the
// deployment's database; here, the platform's defaults — the times under test do not depend on them.
vi.mock("@/modules/deadlines/request", async () => {
  const { DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");
  return { deadlinesForThisRequest: async () => ({ ...DEFAULT_DEADLINES }) };
});

const { default: QueuePanel } = await import("@/modules/registrations/ui/QueuePanel");
const { readPublicPlaces } = await import("@/modules/registrations/service");

const NEW_YORK = "America/New_York";
const NOW = new Date("2026-10-01T16:00:00.000Z");
/** Joined the line at 10:05 in New York — 17:05 in Brașov. */
const WAITLISTED_AT = new Date("2026-10-01T14:05:00.000Z");
/** An offer open until 11:30 the next day in New York — 18:30 in Brașov. */
const OFFER_UNTIL = new Date("2026-10-02T15:30:00.000Z");

async function createEvent() {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T14:00:00.000Z"),
      timezone: NEW_YORK,
      capacity: 1,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  return event;
}

async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert>) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email,
      normalizedEmail: email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      defaultName: name,
      preferredLocale: "ro",
    })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    ...row,
  });
}

async function renderPanel(event: Awaited<ReturnType<typeof createEvent>>) {
  const element = await QueuePanel({
    db,
    event: { id: event.id, capacity: event.capacity, waitlistCapacity: event.waitlistCapacity, timezone: event.timezone, waitlistAutoOffer: event.waitlistAutoOffer },
    waiting: 1,
    now: NOW,
  });
  return renderToStaticMarkup(element);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  locale = "ro";
});

describe("§369 the queue panel's times are the event's own", () => {
  for (const language of ["ro", "en"] as const) {
    it(`writes the offer's deadline and the time a runner joined the line in the event's zone (${language})`, async () => {
      locale = language;
      const event = await createEvent();
      await register(event.id, "Ana Popescu", { status: "CONFIRMED", confirmedAt: NOW });
      await register(event.id, "Ion Oferta", {
        status: "WAITLIST_OFFERED",
        waitlistedAt: new Date("2026-10-01T13:00:00.000Z"),
        holdExpiresAt: OFFER_UNTIL,
      });
      await register(event.id, "Maria Asteapta", { status: "WAITLISTED", waitlistedAt: WAITLISTED_AT });

      const html = await renderPanel(event);
      const inZone = (at: Date, timeZone: string) =>
        formatDay(at, { locale: language, timeZone, style: "short", withTime: true, position: "inline" });

      // The words around the times, from the real catalogue, so a wrong key fails here too.
      const words = (language === "ro" ? ro : en).Admin.queue;
      expect(html).toContain(words.offered.replace("{until}", inZone(OFFER_UNTIL, NEW_YORK)));
      expect(html).toContain(words.joined.replace("{when}", inZone(WAITLISTED_AT, NEW_YORK)));
      // 11:30 and 10:05 in New York; never the club's 18:30 and 17:05.
      expect(html).toContain("11:30");
      expect(html).toContain("10:05");
      expect(html).not.toContain(inZone(OFFER_UNTIL, CLUB_TIME_ZONE));
      expect(html).not.toContain(inZone(WAITLISTED_AT, CLUB_TIME_ZONE));
      expect(html).not.toContain("18:30");
      expect(html).not.toContain("17:05");
    });
  }

  for (const language of ["ro", "en"] as const) {
    it(`lists an offer whose email is still queued past its stored deadline, as the count holds it, with no deadline yet (§520, ${language})`, async () => {
      locale = language;
      const event = await createEvent();
      await register(event.id, "Ana Popescu", { status: "CONFIRMED", confirmedAt: NOW });
      // Past its stored deadline an hour ago; its email has not left, so its clock has not started.
      const stale = new Date(NOW.getTime() - 60 * 60 * 1000);
      await register(event.id, "Ion Oferta", { status: "WAITLIST_OFFERED", waitlistedAt: WAITLISTED_AT, holdExpiresAt: stale });
      const [offer] = await db.select().from(registrations).where(eq(registrations.registeredName, "Ion Oferta"));
      await db.insert(emailOutbox).values({
        messageType: "WAITLIST_SPOT_OFFER",
        locale: "ro",
        registrationId: offer.id,
        participantId: offer.participantId,
        recipientEmail: "ion.oferta@example.org",
        payloadJson: { [STARTS_DEADLINE]: true },
        idempotencyKey: `offer-${offer.id}`,
        status: "PENDING",
      });

      const words = (language === "ro" ? ro : en).Admin.queue;
      const queued = await renderPanel(event);
      // Held, listed, and no «until» a time already gone.
      expect(queued).toContain(words.offeredQueued);
      expect(queued).toContain("Ion Oferta");
      expect(queued).not.toContain(words.offered.split("{")[0].trim() + " ");
      expect(queued).toContain(words.lineTitle.replace("{count}", "1"));

      // Once the email has left, the lapsed offer holds nothing and leaves the line.
      await db.update(emailOutbox).set({ status: "SENT", sentAt: NOW }).where(eq(emailOutbox.registrationId, offer.id));
      const sent = await renderPanel(event);
      expect(sent).not.toContain("Ion Oferta");
      expect(sent).not.toContain(words.offeredQueued);
    });
  }

  it("reads the club's zone only where the event itself is in it", async () => {
    const event = await createEvent();
    await register(event.id, "Ana Popescu", { status: "CONFIRMED", confirmedAt: NOW });
    // The form's own time pinned too: left to the clock, a run at 10:05 in Brașov printed the very time this test refuses.
    await register(event.id, "Maria Asteapta", { status: "WAITLISTED", waitlistedAt: WAITLISTED_AT, createdAt: WAITLISTED_AT });

    const html = await renderPanel({ ...event, timezone: CLUB_TIME_ZONE });
    expect(html).toContain("17:05");
    expect(html).not.toContain("10:05");
  });
});

/**
 * §612 — the panel's «Oferite» beside «Libere» and «În așteptare»: the open offers, the very count the
 * public card reads «1 loc oferit din lista de așteptare» from (`readPublicPlaces`'s `offered`), so the
 * panel and the card say the same number.
 */
describe("§612 the queue panel's «Oferite» is the card's offered count", () => {
  const figureOf = (html: string, label: string) => new RegExp(`${label}</span><span[^>]*>([^<]*)</span>`).exec(html)?.[1];

  for (const language of ["ro", "en"] as const) {
    it(`shows the open offers beside the free places and the people waiting (${language})`, async () => {
      locale = language;
      const event = await createEvent();
      await register(event.id, "Ion Oferta", { status: "WAITLIST_OFFERED", waitlistedAt: WAITLISTED_AT, holdExpiresAt: OFFER_UNTIL });
      await register(event.id, "Maria Asteapta", { status: "WAITLISTED", waitlistedAt: WAITLISTED_AT });

      const html = await renderPanel(event);
      const words = (language === "ro" ? ro : en).Admin.queue;
      const places = await readPublicPlaces(db, { id: event.id, capacity: event.capacity, waitlistCapacity: event.waitlistCapacity }, NOW);
      expect(places).toMatchObject({ offered: 1, waitlisted: 1 });
      expect(figureOf(html, words.offeredFigure)).toBe(String(places.offered));
      expect(figureOf(html, words.waiting)).toBe(String(places.waitlisted));
      // In the order the card says them: the free places, the offers, then the people waiting.
      expect(html.indexOf(words.free)).toBeLessThan(html.indexOf(words.offeredFigure));
      expect(html.indexOf(words.offeredFigure)).toBeLessThan(html.indexOf(`${words.waiting}</span>`));
    });
  }

  it("says nought with no offer open", async () => {
    const event = await createEvent();
    await register(event.id, "Maria Asteapta", { status: "WAITLISTED", waitlistedAt: WAITLISTED_AT });
    expect(figureOf(await renderPanel(event), ro.Admin.queue.offeredFigure)).toBe("0");
  });
});
