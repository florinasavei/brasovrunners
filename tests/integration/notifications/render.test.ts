import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-01 — the renderer that fills the outbox's `EmailRenderer` seam: it looks up the
 * participant/registration/event a row points at and, for a message type that needs one,
 * mints a fresh action token right here rather than earlier (see `notifications/render.ts` and
 * `outbox.ts` for why token issuance is deferred to render time).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-080-01 outbox renderer", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
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
      .values({
        type: "GROUP_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId,
        status: "PENDING_DECLARATION",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
      })
      .returning();
    registrationId = registration.id;
  });

  it("mints a fresh token and builds a working action link for a token-bearing message", async () => {
    const message = await renderOutboxMessage(
      {
        id: "row-1",
        participantId,
        registrationId,
        messageType: "COMPLETE_DECLARATION",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:1",
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
      },
      db,
      NOW,
    );

    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toMatch(/https?:\/\/.+\/inregistrari\/declaratie\//);

    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, registrationId));
    expect(token.purpose).toBe("COMPLETE_DECLARATION");
    // The declaration link lives until the race, not until the hold (§160): a hold past its
    // deadline is kept while nobody waits, and the link must still open the declaration then.
    // Read from the event's own row, so it does not depend on a translation existing.
    expect(token.expiresAt).toEqual(new Date("2026-10-01T09:00:00.000Z"));
  });

  it("gives the declaration token the event's start, the offer's token the offer's deadline (§160)", async () => {
    const [event] = await db.select().from(events).limit(1);
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });

    const row = {
      id: "row-t",
      participantId,
      registrationId,
      messageType: "COMPLETE_DECLARATION" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "test:t",
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    };

    // With the translation in place the answer is the same instant: the event's start.
    await renderOutboxMessage(row, db, NOW);
    const [declaration] = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect(declaration.expiresAt).toEqual(event.startsAt);

    // An offer is a promise to the queue: its token dies with the offer, not with the race.
    const offerDeadline = new Date(NOW.getTime() + 24 * 60 * 60_000);
    await db
      .update(registrations)
      .set({ status: "WAITLIST_OFFERED", holdExpiresAt: offerDeadline })
      .where(eq(registrations.id, registrationId));
    await renderOutboxMessage({ ...row, id: "row-o", messageType: "WAITLIST_SPOT_OFFER", idempotencyKey: "test:o" }, db, NOW);
    const [offer] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "WAITLIST_OFFER"));
    expect(offer.expiresAt).toEqual(offerDeadline);

    // Past the start there is no place left to bound the link: the fourteen-day default.
    const afterStart = new Date(event.startsAt.getTime() + 60_000);
    await db
      .update(registrations)
      .set({ status: "PENDING_DECLARATION", holdExpiresAt: null })
      .where(eq(registrations.id, registrationId));
    await renderOutboxMessage({ ...row, id: "row-l", idempotencyKey: "test:l" }, db, afterStart);
    const late = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect(late.at(-1)?.expiresAt).toEqual(new Date(afterStart.getTime() + 14 * 24 * 60 * 60_000));
  });

  it("repeats the programme's rows in the reminder, each half in its own language (§117)", async () => {
    const [event] = await db.select().from(events).limit(1);
    // The details come through the translation; the fixture above has none.
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    await db
      .update(events)
      .set({
        scheduleItems: [
          { startsAt: "2026-10-01T06:30:00.000Z", endsAt: null, label: { ro: "Briefing", en: "Briefing" }, place: null },
          { startsAt: "2026-10-01T06:00:00.000Z", endsAt: null, label: { ro: "Ridicarea numerelor", en: "Number pickup" }, place: "Cort" },
        ],
      })
      .where(eq(events.id, event.id));

    const message = await renderOutboxMessage(
      {
        id: "row-r",
        participantId,
        registrationId,
        messageType: "EVENT_REMINDER",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:r",
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
      },
      db,
      NOW,
    );

    // Sorted, at the event's wall clock (09:00 EEST), the Romanian half first and the English after —
    // the facts block's own row now (§392), one line per row, in place of the one sentence.
    expect(message.text).toContain("Program: 09:00 — Ridicarea numerelor (Cort)\n  09:30 — Briefing");
    expect(message.text).toContain("Programme: 09:00 — Number pickup (Cort)\n  09:30 — Briefing");
    expect(message.text).not.toContain("Programul: 09:00");
  });

  it("says the sunset and to bring a light in the reminder of a night event only (§394)", async () => {
    const [event] = await db.select().from(events).limit(1);
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    const row = {
      id: "row-n",
      participantId,
      registrationId,
      messageType: "EVENT_REMINDER" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "test:n",
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    };
    let sent = 0;
    const render = () => renderOutboxMessage({ ...row, id: `row-n${++sent}`, idempotencyKey: `test:n${sent}` }, db, NOW);

    // The fixture starts at noon on 1 October, automatic: broad daylight, no line.
    const day = await render();
    expect(day.text).not.toContain("Alergare de noapte");
    expect(day.text).not.toContain("Night run");

    // A Wednesday 19:00 in November, automatic: after dusk — the sunset of that day in both
    // halves. The fixture's type is GROUP_RUN (§394), so the run's own words: «Alergare de noapte».
    await db.update(events).set({ startsAt: new Date("2026-11-18T17:00:00.000Z") }).where(eq(events.id, event.id));
    const night = await render();
    expect(night.text).toContain("Alergare de noapte: începe la 19:00, după apusul de la 16:44. Ia o frontală.");
    expect(night.text).toContain("Night run: starts at 19:00, after the 16:44 sunset. Bring a headlamp.");

    // A 05:30 group run on Wednesday 13 January 2027 (§404): night before that day's sunrise, and
    // the line names the sunrise (07:55) — never «după apusul de la 16:57», an evening eleven hours on.
    await db.update(events).set({ startsAt: new Date("2027-01-13T03:30:00.000Z") }).where(eq(events.id, event.id));
    const dawn = await render();
    expect(dawn.text).toContain("Alergare de noapte: începe la 05:30, înainte de răsăritul de la 07:55. Ia o frontală.");
    expect(dawn.text).toContain("Night run: starts at 05:30, before sunrise at 07:55. Bring a headlamp.");
    expect(dawn.text).not.toContain("după apusul");
    expect(dawn.text).not.toContain("after the 16:57 sunset");
    await db.update(events).set({ startsAt: new Date("2026-11-18T17:00:00.000Z") }).where(eq(events.id, event.id));

    // §394 (review round 3): a daylight start whose own end («Durata», no programme rows) is after
    // dusk — 16:00 to 17:30 on 18 November — carries the line too; ending at 16:45, it does not.
    await db
      .update(events)
      .set({ startsAt: new Date("2026-11-18T14:00:00.000Z"), endsAt: new Date("2026-11-18T15:30:00.000Z"), scheduleItems: null })
      .where(eq(events.id, event.id));
    const late = await render();
    expect(late.text).toContain("Alergare de noapte: începe la 16:00, apusul la 16:44, se termină la 17:30. Ia o frontală.");
    expect(late.text).toContain("Night run: starts at 16:00, sunset at 16:44, ends at 17:30. Bring a headlamp.");
    await db.update(events).set({ endsAt: new Date("2026-11-18T14:45:00.000Z") }).where(eq(events.id, event.id));
    expect((await render()).text).not.toContain("Alergare de noapte");
    await db.update(events).set({ startsAt: new Date("2026-11-18T17:00:00.000Z"), endsAt: null }).where(eq(events.id, event.id));

    // «Nu» wins over the sun, and «Da» over the daylight.
    await db.update(events).set({ nightOverride: false }).where(eq(events.id, event.id));
    expect((await render()).text).not.toContain("Alergare de noapte");
    await db.update(events).set({ nightOverride: true, startsAt: new Date("2026-10-01T09:00:00.000Z") }).where(eq(events.id, event.id));
    expect((await render()).text).toMatch(/Alergare de noapte: începe la 12:00, apusul la \d\d:\d\d\. Ia o frontală\./);

    // Never on another message about the same night event: the sunset and the light are the
    // reminder's line alone. The confirmation's facts block draws the page's route pills, so it
    // names the night pill — the same `nightPill`, never the reminder's sentence.
    const confirmed = await renderOutboxMessage({ ...row, id: "row-nc", idempotencyKey: "test:nc", messageType: "REGISTRATION_CONFIRMED" }, db, NOW);
    expect(confirmed.text).not.toMatch(/Alergare de noapte: (începe|apusul)/);
    expect(confirmed.text).not.toContain("Ia o frontală");
    expect(confirmed.text).not.toContain("Bring a headlamp");
    expect(confirmed.text).toContain("Traseu: Alergare de noapte");
  });

  it("points the reminder at the page's links with one line, only when the event has links (§332)", async () => {
    const [event] = await db.select().from(events).limit(1);
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    const row = {
      id: "row-l",
      participantId,
      registrationId,
      messageType: "EVENT_REMINDER" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "test:l",
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    };

    // No links: no line, and no `#links` anchor to point at a section that is not there.
    const without = await renderOutboxMessage(row, db, NOW);
    expect(without.html).not.toContain("#links");
    expect(without.text).not.toContain("Linkuri și fișiere");

    const drive = ["https:/", "drive.example.test", "file", "d", "gpx", "view"].join("/");
    await db.update(events).set({ links: [{ kind: "GPX", url: drive, labelRo: null, labelEn: null }] }).where(eq(events.id, event.id));
    const withLinks = await renderOutboxMessage({ ...row, id: "row-l2", idempotencyKey: "test:l2" }, db, NOW);
    expect(withLinks.html).toMatch(/\/evenimente\/crosul#links"/);
    // One link in each half's facts block (§392), to the page's section — never the Drive address.
    expect(withLinks.text).toMatch(/Linkuri și fișiere: \S+\/evenimente\/crosul#links/);
    expect(withLinks.text).toMatch(/Links and files: \S+\/evenimente\/crosul#links/);
    expect(withLinks.html).not.toContain(drive);
    expect(withLinks.text).not.toContain(drive);
  });

  it("a GPX with a route description has no page it can point at (§387, review round)", async () => {
    // A weekly run's typical shape: a route description in both languages and a GPX link, no
    // other link. `EventLinks` then renders nothing (every link moved into the route section),
    // so the page has no `#links` — the email must not send the runner to an anchor that is not
    // there, and must not claim the GPX is "Linkuri și fișiere" when the page draws it in "Traseul".
    const [event] = await db.select().from(events).limit(1);
    const description = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Oprire cu apă la km 4." }] }] };
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul-traseu", title: "Crosul", excerpt: "x", routeDescriptionJson: description });
    const drive = ["https:/", "drive.example.test", "file", "d", "gpx2", "view"].join("/");
    await db.update(events).set({ links: [{ kind: "GPX", url: drive, labelRo: null, labelEn: null }] }).where(eq(events.id, event.id));

    const message = await renderOutboxMessage(
      {
        id: "row-l3",
        participantId,
        registrationId,
        messageType: "EVENT_REMINDER" as const,
        locale: "ro" as const,
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:l3",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING" as const,
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: NOW,
        providerMessageId: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      NOW,
    );

    expect(message.html).not.toContain("#links");
    expect(message.text).not.toContain("Linkuri și fișiere");

    // The positive case: a route description plus the GPX (taken into the route section) plus
    // a DOCUMENT link (which is not a route kind, so `partitionEventLinks` leaves it in `other`)
    // — the page still has a `#links` section, and the reminder must still point at it. A
    // regression that keys off `hasRouteDescription` alone, rather than the page's own split,
    // would drop this line even though the anchor is there.
    const doc = ["https:/", "drive.example.test", "file", "d", "doc1", "view"].join("/");
    await db
      .update(events)
      .set({
        links: [
          { kind: "GPX", url: drive, labelRo: null, labelEn: null },
          { kind: "DOCUMENT", url: doc, labelRo: null, labelEn: null },
        ],
      })
      .where(eq(events.id, event.id));
    const withDoc = await renderOutboxMessage(
      {
        id: "row-l4",
        participantId,
        registrationId,
        messageType: "EVENT_REMINDER" as const,
        locale: "ro" as const,
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:l4",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING" as const,
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: NOW,
        providerMessageId: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      NOW,
    );
    expect(withDoc.html).toMatch(/crosul-traseu#links"/);
    expect(withDoc.text).toMatch(/Linkuri și fișiere: \S+crosul-traseu#links/);
    expect(withDoc.text).toMatch(/Links and files: \S+crosul-traseu#links/);
    expect(withDoc.html).not.toContain(doc);
    expect(withDoc.text).not.toContain(doc);
  });

  it("renders a message with no token and no action link", async () => {
    const message = await renderOutboxMessage(
      {
        id: "row-2",
        participantId,
        registrationId,
        messageType: "REGISTRATION_CANCELLED",
        locale: "en",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:2",
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
      },
      db,
      NOW,
    );

    // Below the header band, which links nothing and only shows the lockup (§174).
    expect(message.html.slice(message.html.indexOf("</div>") + 6)).not.toContain("http");
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, registrationId));
    expect(tokens).toHaveLength(0);
  });

  it("falls back to the default token lifetime when the borrowed hold has already lapsed by render time", async () => {
    // A hold that was still live when this message was queued, but has since expired — the
    // delayed-batch race `notifications/render.ts` guards against.
    const renderedAt = new Date(NOW.getTime() + 60 * 60_000); // one hour after the hold's own deadline

    const message = await renderOutboxMessage(
      {
        id: "row-3",
        participantId,
        registrationId,
        messageType: "COMPLETE_DECLARATION",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:3",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING",
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: renderedAt,
        providerMessageId: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      renderedAt,
    );

    expect(message.html).toMatch(/https?:\/\//);
    const [token] = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.registrationId, registrationId));
    // Not the lapsed hold deadline (NOW + 30 minutes, already in the past) — the default
    // lifetime instead, so the token itself is still issuable.
    expect(token.expiresAt.getTime()).toBeGreaterThan(renderedAt.getTime());
  });
});
