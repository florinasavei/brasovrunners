import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { forgetCachedEmailCopy, updateEmailCopy } from "@/modules/notifications/email-copy";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the confirmed email tells the runner everything about the event (the owner, 2026-09-25:
 * "la mailul de «Înscrierea este confirmată» am nevoie de mai multe detalii, gen locație, program,
 * etc."). One facts block — Când · Unde · Program · Traseu · Cost · Linkuri — drawn by the
 * confirmation, the reminder and the declaration request, each half of the bilingual message in its
 * own language, from the page's own facts and by the page's own rules.
 */
const NOW = new Date("2026-11-01T09:00:00.000Z");

/** Saturday 21 November 2026, 09:00 in Brașov (EET), the gun half an hour later. */
const STARTS_AT = new Date("2026-11-21T07:00:00.000Z");
const RACE_AT = new Date("2026-11-21T07:30:00.000Z");
const MAP = "https://maps.example/tractorul";
const PAY = "https://pay.example/cros";
const STRAVA = "https://www.strava.com/clubs/1/group_events/2";
const ROUTE = "https://www.strava.com/routes/3";
const GPX = ["https:/", "drive.example.test", "file", "d", "gpx", "view"].join("/");
const DOC = ["https:/", "drive.example.test", "file", "d", "doc", "view"].join("/");
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** The plain-text body's two halves, the registrant's language first (§96). */
function halves(message: OutgoingEmail): [string, string] {
  const [first, second] = message.text.split("\n— — —\n");
  return [first, second];
}

describe("§NNN the event's facts in the confirmed email, the reminder and the declaration request", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let sequence = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    forgetCachedEmailCopy();
  });

  type EventOverrides = Partial<typeof events.$inferInsert>;
  type TranslationOverrides = Partial<typeof eventTranslations.$inferInsert>;

  /** A race with every fact the block has a row for, in both languages; each test takes some away. */
  async function seedEvent(overrides: EventOverrides = {}, translation: TranslationOverrides = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: STARTS_AT,
        raceStartsAt: RACE_AT,
        timezone: "Europe/Bucharest",
        registrationMode: "INTERNAL",
        locationName: "Parcul Tractorul",
        locationAddress: "Strada Carpaților 60",
        mapUrl: MAP,
        scheduleItems: [{ startsAt: "2026-11-21T06:00:00.000Z", endsAt: null, label: { ro: "Ridicarea numerelor", en: "Number pickup" }, place: "Cort" }],
        surface: "TRAIL",
        difficulty: "HARD",
        distanceMeters: 21_100,
        elevationGainMeters: 900,
        headlampRequired: true,
        costType: "PAID",
        costAmount: "50 lei",
        costUrl: PAY,
        stravaEventUrl: STRAVA,
        links: [
          { kind: "GPX", url: GPX, labelRo: null, labelEn: null },
          { kind: "DOCUMENT", url: DOC, labelRo: null, labelEn: null },
        ],
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      {
        eventId: event.id,
        locale: "ro",
        slug: `crosul-${event.id.slice(0, 8)}`,
        title: "Crosul",
        locationName: "Parcul Tractorul",
        rulesJson: doc("Regulamentul."),
        routeDescriptionJson: doc("Apă la km 10."),
        ...translation,
      },
      {
        eventId: event.id,
        locale: "en",
        slug: `the-cross-${event.id.slice(0, 8)}`,
        title: "The cross",
        locationName: "Tractorul Park",
        rulesJson: doc("The rules."),
        routeDescriptionJson: doc("Water at km 10."),
        ...translation,
      },
    ]);
    return event;
  }

  async function render(eventId: string, locale: "ro" | "en", messageType: EmailMessageType, options: { clubCopy?: boolean; status?: "CONFIRMED" | "PENDING_DECLARATION" } = {}) {
    sequence += 1;
    const identity = canonicalizeEmail(`runner${sequence}@example.ro`);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: `Runner ${sequence}`,
      })
      .returning();
    const status = options.status ?? "CONFIRMED";
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        locale,
        registeredName: `Runner ${sequence}`,
        displayName: `Runner ${sequence}`,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        ...(status === "CONFIRMED" ? { confirmedAt: NOW, bibNumber: 100 + sequence, checkinCode: `CODE${String(sequence).padStart(6, "0")}` } : { holdExpiresAt: new Date(STARTS_AT.getTime() - 2 * 24 * 60 * 60_000) }),
      })
      .returning();
    const [row] = await db
      .insert(emailOutbox)
      .values({
        participantId: options.clubCopy ? null : participant.id,
        registrationId: registration.id,
        messageType,
        locale,
        recipientEmail: options.clubCopy ? "club@example.ro" : identity.deliveryEmail,
        payloadJson: options.clubCopy ? { clubCopy: true } : {},
        idempotencyKey: `facts:${sequence}`,
      })
      .returning();
    return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
  }

  it("carries the six rows in Romanian, the facts above the QR and below the club's text, each anchor once", async () => {
    const event = await seedEvent();
    const message = await render(event.id, "ro", "REGISTRATION_CONFIRMED");
    const [ro, en] = halves(message);
    const page = `/ro/evenimente/crosul-${event.id.slice(0, 8)}`;

    expect(ro).toContain("Când: Sâmbătă, 21 nov. 2026 · întâlnire la 09:00 · start la 09:30");
    expect(ro).toContain(`Unde: Parcul Tractorul\n  Strada Carpaților 60\n  Vezi pe hartă: ${MAP}`);
    expect(ro).toContain("Program: 08:00 — Ridicarea numerelor (Cort)");
    // The page's pills, in the page's order, the page's words; the route link lives under #route with a description.
    expect(ro).toContain(`Traseu: Trail · Avansat · 21,1 km · 900 m D+ · Frontală\n  Evenimentul pe Strava: ${STRAVA}`);
    expect(ro).toContain(`Cost: 50 lei\n  plata pe pay.example: ${PAY}`);
    expect(ro).toMatch(
      new RegExp(`Linkuri:\\n  Pagina evenimentului: \\S+${page}\\n  Program: \\S+${page}#schedule\\n  Regulament: \\S+${page}#rules\\n  Traseul: \\S+${page}#route\\n  Linkuri și fișiere: \\S+${page}#links`),
    );

    // The confirmation first, then the facts, then the QR, then the button (the brief's order:
    // the block above the QR and below the club's text — §81's bold date/place line gave way to it).
    const [when, qr, button] = ["Când:", "Codul tău:", "Vezi înscrierea:"].map((marker) => ro.indexOf(marker));
    expect(when).toBeGreaterThan(ro.indexOf("este confirmată"));
    expect(qr).toBeGreaterThan(when);
    expect(button).toBeGreaterThan(qr);
    // The one bold line of §81 gave way to the block: the date and the place are said once.
    expect(ro).not.toContain("Sâmbătă, 21 nov. 2026, 09:00 · Parcul Tractorul");
    // Each of the page's sections — and the page itself — is linked once, in the block, not
    // again in the list under the button.
    for (const anchor of ["#schedule", "#rules", "#links"]) expect(ro.split(anchor).length - 1).toBe(1);
    expect(ro.split("Pagina evenimentului").length - 1).toBe(1);
    // The addresses the page keeps behind its sections never reach a message.
    expect(message.text).not.toContain(GPX);
    expect(message.text).not.toContain(DOC);
    expect(message.html).toContain('data-email-part="event-facts"');
    expect(message.html.split('data-email-part="event-facts"').length - 1).toBe(2);

    // The English half in its own words, its own place, and its own page.
    const enPage = `/en/events/the-cross-${event.id.slice(0, 8)}`;
    expect(en).toContain("When: Saturday, 21 Nov 2026 · gather at 09:00 · start at 09:30");
    expect(en).toContain(`Where: Tractorul Park\n  Strada Carpaților 60\n  Open the map: ${MAP}`);
    expect(en).toContain("Programme: 08:00 — Number pickup (Cort)");
    expect(en).toContain("Route: Trail · Hard · 21.1 km · 900 m climb · Headlamp");
    expect(en).toContain(`Cost: 50 lei\n  payment on pay.example: ${PAY}`);
    expect(en).toMatch(
      new RegExp(`Links:\\n  The event's page: \\S+${enPage}\\n  Programme: \\S+${enPage}#schedule\\n  Rules: \\S+${enPage}#rules\\n  The route: \\S+${enPage}#route\\n  Links and files: \\S+${enPage}#links`),
    );
    expect(en.split("The event's page").length - 1).toBe(1);
  });

  it("carries the six rows in English first for an English registrant", async () => {
    const event = await seedEvent();
    const [en, ro] = halves(await render(event.id, "en", "REGISTRATION_CONFIRMED"));
    expect(en).toContain("When: Saturday, 21 Nov 2026 · gather at 09:00 · start at 09:30");
    expect(en).toContain("Where: Tractorul Park");
    expect(en).toContain("Programme: 08:00 — Number pickup (Cort)");
    expect(en).toContain("Route: Trail · Hard · 21.1 km · 900 m climb · Headlamp");
    expect(en).toContain("Cost: 50 lei");
    expect(en).toMatch(/Links:\n {2}The event's page: \S+\/en\/events\/the-cross-\S+\n {2}Programme: \S+\/en\/events\/the-cross-\S+#schedule/);
    expect(ro).toContain("Când: Sâmbătă, 21 nov. 2026 · întâlnire la 09:00 · start la 09:30");
    expect(ro).toContain("Unde: Parcul Tractorul");
    expect(ro).toMatch(/Linkuri:\n {2}Pagina evenimentului: \S+\/ro\/evenimente\/crosul-\S+\n {2}Program: \S+\/ro\/evenimente\/crosul-\S+#schedule/);
  });

  it("says the page's sentence where the place would be while it is to be announced (§328)", async () => {
    const event = await seedEvent({ locationToBeAnnounced: true });
    const message = await render(event.id, "ro", "REGISTRATION_CONFIRMED");
    const [ro, en] = halves(message);
    expect(ro).toContain("Unde: Locația se anunță în curând\n");
    expect(en).toContain("Where: Location to be announced soon\n");
    for (const body of [message.text, message.html]) {
      for (const hidden of ["Parcul Tractorul", "Tractorul Park", "Strada Carpaților", "maps.example", "(Cort)"]) expect(body).not.toContain(hidden);
    }
    // The programme's row stays, time and label; only its place is gone.
    expect(ro).toContain("Program: 08:00 — Ridicarea numerelor\n");
  });

  it("draws no Program row without the programme's rows, and no Cost row for a free event", async () => {
    const event = await seedEvent({ scheduleItems: null, costType: "FREE", costAmount: null, costUrl: null });
    const message = await render(event.id, "ro", "REGISTRATION_CONFIRMED");
    expect(message.text).not.toMatch(/^Program(me)?:/m);
    expect(message.text).not.toMatch(/^Cost:/m);
    // Nor a `#schedule` to point at: the page has no programme.
    expect(message.text).not.toContain("#schedule");
    expect(message.text).toMatch(/^Când: /m);
    expect(message.text).toMatch(/^Traseu: /m);
  });

  it("links #route only with a route description, and #links only when the page's own split leaves it something (§387)", async () => {
    // No route description: the GPX stays in "Linkuri și fișiere", the route link in the route row.
    const plain = await seedEvent({ routeUrl: ROUTE, links: [{ kind: "GPX", url: GPX, labelRo: null, labelEn: null }] }, { routeDescriptionJson: null });
    const [withoutSection] = halves(await render(plain.id, "ro", "REGISTRATION_CONFIRMED"));
    expect(withoutSection).not.toContain("#route");
    expect(withoutSection).toContain(`  Vezi traseul: ${ROUTE}`);
    expect(withoutSection).toMatch(/Linkuri și fișiere: \S+#links/);

    // A route description: the GPX and the route link move under #route, and "Linkuri și fișiere" has nothing left.
    const described = await seedEvent({ routeUrl: ROUTE, links: [{ kind: "GPX", url: GPX, labelRo: null, labelEn: null }] });
    const [withSection] = halves(await render(described.id, "ro", "REGISTRATION_CONFIRMED"));
    expect(withSection).toMatch(/Traseul: \S+#route/);
    expect(withSection).not.toContain("#links");
    expect(withSection).not.toContain("Vezi traseul");
  });

  it("keeps the block in the club's copy, without the QR, the code or a personal link (§320)", async () => {
    const event = await seedEvent();
    const message = await render(event.id, "ro", "REGISTRATION_CONFIRMED", { clubCopy: true });
    expect(message.text).toContain("Când: Sâmbătă, 21 nov. 2026");
    expect(message.text).toContain("Cost: 50 lei");
    expect(message.html).not.toContain("/api/registrations/qr/");
    expect(message.text).not.toContain("Codul tău");
    expect(message.text).not.toMatch(/gestionare\//);
    expect(message.attachments).toBeUndefined();
  });

  it("gives the reminder the same block in place of its own programme sentence and section links", async () => {
    const event = await seedEvent();
    const [ro, en] = halves(await render(event.id, "ro", "EVENT_REMINDER"));
    expect(ro).toContain("Program: 08:00 — Ridicarea numerelor (Cort)");
    expect(ro).not.toContain("Programul:");
    expect(ro).toContain("Unde: Parcul Tractorul");
    expect(en).toContain("Route: Trail · Hard · 21.1 km · 900 m climb · Headlamp");
    // The reminder's own lines stay: the number, the code and "can't come".
    expect(ro).toMatch(/Numărul tău de concurs: \d+\./);
    expect(ro).toContain("Nu poți veni?");
    for (const anchor of ["#schedule", "#rules", "#links"]) expect(ro.split(anchor).length - 1).toBe(1);
    expect(ro.split("Pagina evenimentului").length - 1).toBe(1);
  });

  it("gives the declaration request — the participation confirmation (§104) — the block under its words", async () => {
    const event = await seedEvent();
    const [ro] = halves(await render(event.id, "ro", "COMPLETE_DECLARATION", { status: "PENDING_DECLARATION" }));
    expect(ro.indexOf("Când: Sâmbătă, 21 nov. 2026")).toBeGreaterThan(ro.indexOf("declarația"));
    expect(ro).toContain("Unde: Parcul Tractorul");
    expect(ro.indexOf("Semnează declarația:")).toBeGreaterThan(ro.indexOf("Când:"));
  });

  it("draws the block under a text the club saved, which needs no edit and no new field", async () => {
    const [copywriter] = await db.insert(staffUsers).values({ email: "copywriter@dev.test", displayName: "Redactor", role: "COPYWRITER" }).returning();
    await updateEmailCopy(
      db,
      copywriter,
      { messageType: "REGISTRATION_CONFIRMED", locale: "ro", entry: { subject: "Confirmat: {eventTitle}", paragraphs: ["Ne vedem la {eventTitle}, {participantName}!"] } },
      NOW,
    );
    const event = await seedEvent();
    const [ro] = halves(await render(event.id, "ro", "REGISTRATION_CONFIRMED"));
    expect(ro).toContain("Ne vedem la Crosul, Runner");
    expect(ro).toContain("Când: Sâmbătă, 21 nov. 2026");
    expect(ro).toContain("Cost: 50 lei");
  });
});
