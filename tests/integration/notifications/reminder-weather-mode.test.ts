import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-01 (§666) — the reminder's «Vremea» row follows the event's choice: the forecast as
 * before (`reminder-weather.test.ts`), the club's own text in each half's language with no credit,
 * or nothing. Neither of the last two asks Open-Meteo; a half whose language has no text has no row,
 * never the other half's words (§28).
 */
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T09:00:00.000Z");
const answer = { asked: [] as string[] };

vi.mock("@/modules/weather/source", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/weather/source")>();
  const openMeteo = (async (url: string) => {
    answer.asked.push(String(url));
    const first = Math.floor(NOW.getTime() / HOUR) * HOUR;
    const time = Array.from({ length: 8 * 24 }, (_, index) => (first + index * HOUR) / 1000);
    return new Response(
      JSON.stringify({
        hourly: {
          time,
          temperature_2m: time.map(() => 6.4),
          precipitation_probability: time.map(() => 80),
          weather_code: time.map(() => 63),
          wind_speed_10m: time.map(() => 17),
          apparent_temperature: time.map(() => 2.1),
          precipitation: time.map(() => 1.2),
          wind_gusts_10m: time.map(() => 38),
          relative_humidity_2m: time.map(() => 91),
          uv_index: time.map(() => 0),
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return {
    ...real,
    forecastForEvent: (event: Parameters<typeof real.forecastForEvent>[0], now: Date) =>
      real.forecastForEvent(event, now, { fetch: openMeteo, source: "open-meteo", timeoutMs: 50 }),
  };
});

const { renderOutboxMessage } = await import("@/modules/notifications/render");

const ICY_RO = "Pe creastă e polei, veniți cu colțari.";
const ICY_EN = "The ridge is icy, bring microspikes.";

describe("BR-REQ-080-01 the reminder's weather follows «Vremea» (§666)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let registrationId: string;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    answer.asked = [];
    await resetTables(db);
    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-09-26T05:00:00.000Z"), registrationMode: "INTERNAL", locationName: "Parcul Tractorul" })
      .returning();
    eventId = event.id;
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare", title: "Alergare", excerpt: "x", weatherNote: ICY_RO },
      { eventId: event.id, locale: "en", slug: "run", title: "Run", excerpt: "x", weatherNote: ICY_EN },
    ]);
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    registrationId = registration.id;
  });

  const row = (id: string): OutboxRow => ({
    id,
    participantId,
    registrationId,
    messageType: "EVENT_REMINDER",
    locale: "ro",
    recipientEmail: "ana@example.ro",
    payloadJson: {},
    idempotencyKey: `test:${id}`,
    requestedByStaffUserId: null,
    isManualResend: false,
    status: "PROCESSING",
    attemptCount: 1,
    nextAttemptAt: null,
    lockedAt: NOW,
    providerMessageId: null,
    transport: null,
    recipientCount: null,
    lastError: null,
    createdAt: NOW,
    sentAt: null,
  });

  it("forecast (the default): the forecast's row as before, never the club's text beside it", async () => {
    const message = await renderOutboxMessage(row("f1"), db, NOW);
    expect(answer.asked).toHaveLength(1);
    expect(message.text).toContain("Vremea la Brașov, sâmbătă, 26 sept. 08:00: Ploaie, 6 °C, ploaie probabilă 80 %");
    expect(message.text).toContain("Prognoză: Open-Meteo");
    expect(message.text).not.toContain(ICY_RO);
    expect(message.text).not.toContain(ICY_EN);
  });

  it("custom: the club's text under «Vremea» in each half's own language, no credit, no request", async () => {
    await db.update(events).set({ weatherMode: "custom" }).where(eq(events.id, eventId));
    const message = await renderOutboxMessage(row("c1"), db, NOW);
    expect(answer.asked).toHaveLength(0);
    const lines = message.text.split("\n");
    const ro = lines.indexOf(`Vremea: ${ICY_RO}`);
    expect(ro).toBeGreaterThan(0);
    expect(lines[ro - 1]).toMatch(/^Când: /);
    expect(lines[ro + 1]).toMatch(/^Unde: /);
    const en = lines.indexOf(`Weather: ${ICY_EN}`);
    expect(en).toBeGreaterThan(ro);
    expect(message.text).not.toContain("Open-Meteo");
    expect(message.text).not.toContain("Ploaie");
    const block = message.html.match(/<div data-email-part="event-facts"[^]*?<\/div>/)?.[0] ?? "";
    expect(block).toContain(`<strong>Vremea</strong><br>${ICY_RO}`);
  });

  it("custom: a half whose language has no text has no row — never the other half's words (§28)", async () => {
    await db.update(events).set({ weatherMode: "custom" }).where(eq(events.id, eventId));
    await db.update(eventTranslations).set({ weatherNote: null }).where(eq(eventTranslations.locale, "en"));
    const message = await renderOutboxMessage(row("c2"), db, NOW);
    expect(message.text).toContain(`Vremea: ${ICY_RO}`);
    expect(message.text).not.toMatch(/^Weather: /m);
    expect(message.text.split(ICY_RO)).toHaveLength(2);
  });

  it("off: no weather row and no request, whatever text is kept", async () => {
    await db.update(events).set({ weatherMode: "off" }).where(eq(events.id, eventId));
    const message = await renderOutboxMessage(row("o1"), db, NOW);
    expect(answer.asked).toHaveLength(0);
    expect(message.text).not.toContain("Vremea");
    expect(message.text).not.toMatch(/^Weather: /m);
    expect(message.text).not.toContain(ICY_RO);
    expect(message.text).toContain("Alergare se apropie");
  });
});
