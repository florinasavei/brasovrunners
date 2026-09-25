import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-01 (§402) — the reminder carries the forecast for the start as a «Vremea» row of its
 * facts block (§392), right under «Când», each half of the bilingual message in its own words, read
 * at send time through the same request the event page makes; no row when Open-Meteo fails, and
 * none on any other message.
 *
 * The tests run with `WEATHER_SOURCE=off`, so `weatherForEvent` is stood in for by the real one
 * reading through a stub `fetch` — the code path is the server's, the answer is the test's.
 */
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T09:00:00.000Z");
const answer = { mode: "ok" as "ok" | "fail" };

vi.mock("@/modules/weather/source", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/weather/source")>();
  const openMeteo = (async () => {
    if (answer.mode === "fail") return new Response("Bad Gateway", { status: 502 });
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
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return {
    ...real,
    weatherForEvent: (event: Parameters<typeof real.weatherForEvent>[0], now: Date) =>
      real.weatherForEvent(event, now, { fetch: openMeteo, source: "open-meteo", timeoutMs: 50 }),
  };
});

const { renderOutboxMessage } = await import("@/modules/notifications/render");

describe("BR-REQ-080-01 the reminder's forecast line (§402)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    answer.mode = "ok";
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
    // Saturday 26 September 2026 at 08:00 in Brașov: two days after NOW, where the reminder goes out.
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-09-26T05:00:00.000Z"), registrationMode: "INTERNAL", locationName: "Parcul Tractorul" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare", title: "Alergare", excerpt: "x" },
      { eventId: event.id, locale: "en", slug: "run", title: "Run", excerpt: "x" },
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

  const row = (messageType: OutboxRow["messageType"], id: string): OutboxRow => ({
    id,
    participantId,
    registrationId,
    messageType,
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
    lastError: null,
    createdAt: NOW,
    sentAt: null,
  });

  it("says the forecast for the start as a row of the facts block, in each half's own language", async () => {
    const message = await renderOutboxMessage(row("EVENT_REMINDER", "r1"), db, NOW);
    const lines = message.text.split("\n");
    // Romanian half: right under «Când», the credit the licence asks for under it, then «Unde».
    const ro = lines.indexOf("Vremea: Ploaie, 6 °C, 80% șanse de ploaie, vânt 17 km/h");
    expect(ro).toBeGreaterThan(0);
    expect(lines[ro - 1]).toMatch(/^Când: /);
    expect(lines[ro + 1]).toBe("  Prognoză: Open-Meteo");
    expect(lines[ro + 2]).toMatch(/^Unde: /);
    // English half, in its own words.
    const en = lines.indexOf("Weather: Rain, 6 °C, 80% chance of rain, wind 17 km/h");
    expect(en).toBeGreaterThan(ro);
    expect(lines[en - 1]).toMatch(/^When: /);
    expect(lines[en + 1]).toBe("  Forecast: Open-Meteo");
    // In the HTML, inside the facts block, the label bold as every row's.
    const block = message.html.match(/<div data-email-part="event-facts"[^]*?<\/div>/)?.[0] ?? "";
    expect(block).toContain("<strong>Vremea</strong><br>Ploaie, 6 °C, 80% șanse de ploaie, vânt 17 km/h<br>Prognoză: Open-Meteo");
  });

  it("goes out without the row when Open-Meteo fails", async () => {
    answer.mode = "fail";
    const message = await renderOutboxMessage(row("EVENT_REMINDER", "r2"), db, NOW);
    expect(message.text).not.toContain("Vremea");
    expect(message.text).not.toMatch(/^Weather: /m);
    expect(message.text).not.toContain("Open-Meteo");
    // The rest of the reminder is untouched.
    expect(message.text).toContain("Alergare se apropie");
  });

  it("is on the reminder only — never the confirmation, sent weeks before a forecast means anything", async () => {
    const message = await renderOutboxMessage(row("REGISTRATION_CONFIRMED", "c1"), db, NOW);
    expect(message.text).not.toContain("Vremea");
    expect(message.text).not.toMatch(/^Weather: /m);
    expect(message.text).not.toContain("Open-Meteo");
  });
});
