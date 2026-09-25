import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationInterests } from "@/db/schema/registration-interests";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { AUTOMATIC_SEND_KEYS } from "@/modules/notifications/domain/automatic-sends";
import { queueEventReminders, queueParticipationConfirmations } from "@/modules/notifications/event-mail";
import { type ForecastRow, forecastAutomaticEmails } from "@/modules/notifications/forecast";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { queueRegistrationOpenedMessages } from "@/modules/registrations/interest";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-09T09:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

/**
 * §383 — "Următoarele emailuri automate" on `/admin/emails`: every message the platform sends a
 * participant on its own in the next fourteen days, and the moment it becomes due.
 *
 * What is protected is the one formula. The fixture is the brief's: an event three days out with
 * the club's 48-hour reminder, one ten days out with the reminder off, a participation window that
 * opens tomorrow, a hold that lapses in twenty hours with somebody waiting, an event that ended an
 * hour ago — and one whose registration opens in two days, with addresses waiting. The forecast
 * must list exactly the sends below; and for every row, the job's own code, run at that moment on
 * the same data, must pick exactly those registrations — and nobody a minute earlier.
 */
describe("§383 the forecast of automatic emails", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let seq = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function person(name: string) {
    seq += 1;
    const identity = canonicalizeEmail(`runner${seq}@example.ro`);
    const [row] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: name,
      })
      .returning();
    return row.id;
  }

  async function event(title: string, startsAt: Date, overrides: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt,
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: at(-30 * DAY),
        locationName: "Parcul Tractorul",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug: `ro-${row.id.slice(0, 8)}`, title },
      { eventId: row.id, locale: "en", slug: `en-${row.id.slice(0, 8)}`, title: `${title} (EN)` },
    ]);
    return row.id;
  }

  /** `label` is the registered name: the one thing that stays the same when the fixture is seeded again. */
  async function registration(eventId: string, label: string, status: RegistrationStatus, extra: Partial<typeof registrations.$inferInsert> = {}) {
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: await person(label),
        status,
        locale: "ro",
        registeredName: label,
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: at(-3 * DAY),
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        confirmedAt: status === "CONFIRMED" ? at(-2 * DAY) : null,
        waitlistedAt: status === "WAITLISTED" ? at(-2 * DAY) : null,
        ...extra,
      })
      .returning();
    return row.id;
  }

  type Fixture = Awaited<ReturnType<typeof seed>>;

  async function seed() {
    await resetTables(db);
    // A — three days out, the club's reminder (48 h): the reminder tomorrow; one runner still without a final number.
    const a = await event("Crosul A", at(3 * DAY), { confirmationOpensDaysBefore: 0 });
    const a1 = await registration(a, "a1", "CONFIRMED", { bibNumber: 1 });
    const a2 = await registration(a, "a2", "CONFIRMED");
    // B — ten days out, the reminder off: nothing.
    const b = await event("Crosul B", at(10 * DAY), { reminderHoursBefore: 0, confirmationOpensDaysBefore: 0 });
    await registration(b, "b1", "CONFIRMED", { bibNumber: 2 });
    // C — eight days out: its window (7 days / 2 days) opens tomorrow; the last call at the reminder's lead.
    const c = await event("Crosul C", at(8 * DAY));
    const c1 = await registration(c, "c1", "PENDING_DECLARATION", { holdExpiresAt: at(6 * DAY), bibNumber: 3 });
    // D — full, with a hold that lapses in twenty hours and somebody waiting; no reminder, no window.
    const d = await event("Crosul D", at(5 * DAY), { capacity: 1, reminderHoursBefore: 0, confirmationOpensDaysBefore: 0 });
    await registration(d, "d1", "PENDING_DECLARATION", { holdExpiresAt: at(20 * HOUR), bibNumber: 4 });
    const d2 = await registration(d, "d2", "WAITLISTED");
    // E — ended an hour ago, numbers settled: nothing — the thank-you is an Administrator's (§82).
    const e = await event("Crosul E", at(-3 * HOUR), { endsAt: at(-HOUR), bibsSettledAt: at(-3 * HOUR) });
    await registration(e, "e1", "CONFIRMED", { bibNumber: 5, checkedInAt: at(-3 * HOUR) });
    // F — registration opens in two days; two addresses wait for it.
    const f = await event("Crosul F", at(20 * DAY), { registrationOpensAt: at(2 * DAY) });
    for (const address of ["x@example.ro", "y@example.ro"]) {
      const identity = canonicalizeEmail(address);
      await db.insert(registrationInterests).values({
        eventId: f,
        deliveryEmail: identity.deliveryEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        locale: "ro",
      });
    }
    return { a, a1, a2, b, c, c1, d, d2, e, f };
  }

  const forecast = () => forecastAutomaticEmails(db, { now: NOW, horizonDays: 14, deadlines: DEFAULT_DEADLINES });
  const shape = (rows: ForecastRow[]) => rows.map(({ at: when, eventId, type, send, recipients }) => ({ at: when.toISOString(), eventId, type, send, recipients }));

  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seed();
  });

  it("lists each automatic send, by the moment it becomes due, and nothing staff send", async () => {
    const { a, c, d, f } = fixture;
    expect(shape(await forecast())).toEqual([
      { at: at(20 * HOUR).toISOString(), eventId: d, type: "WAITLIST_SPOT_OFFER", send: "nextInLine", recipients: 1 },
      { at: at(DAY).toISOString(), eventId: a, type: "EVENT_REMINDER", send: "reminder", recipients: 2 },
      { at: at(DAY).toISOString(), eventId: c, type: "COMPLETE_DECLARATION", send: "participation", recipients: 1 },
      { at: at(2 * DAY).toISOString(), eventId: f, type: "REGISTRATION_OPENED", send: "registrationOpened", recipients: 2 },
      { at: at(3 * DAY).toISOString(), eventId: a, type: "BIB_ASSIGNED", send: "bibs", recipients: 1 },
      { at: at(6 * DAY).toISOString(), eventId: c, type: "COMPLETE_DECLARATION", send: "lastCall", recipients: 1 },
    ]);
  });

  it("carries the event's title in both languages and its zone", async () => {
    const [row] = (await forecast()).filter((candidate) => candidate.send === "reminder");
    expect(row.eventTitle).toEqual({ ro: "Crosul A", en: "Crosul A (EN)" });
    expect(row.zone).toBe("Europe/Bucharest");
    expect(row.overdue).toBe(false);
  });

  it("leaves out a registration whose message is already in the outbox, as the job would", async () => {
    await db.insert(emailOutbox).values({
      participantId: null,
      registrationId: fixture.a1,
      messageType: "EVENT_REMINDER",
      locale: "ro",
      recipientEmail: "runner@example.ro",
      payloadJson: {},
      idempotencyKey: AUTOMATIC_SEND_KEYS.reminder(fixture.a1),
    });
    const [row] = (await forecast()).filter((candidate) => candidate.send === "reminder");
    expect(row.registrationIds).toEqual([fixture.a2]);
  });

  it("stops at the horizon", async () => {
    const rows = await forecastAutomaticEmails(db, { now: NOW, horizonDays: 2, deadlines: DEFAULT_DEADLINES });
    expect(rows.map((row) => row.send)).toEqual(["nextInLine", "reminder", "participation", "registrationOpened"]);
  });

  it("sends to a test registration like a real one, and counts it apart (§12.6, §30)", async () => {
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.id, fixture.a2));
    const [row] = (await forecast()).filter((candidate) => candidate.send === "reminder");
    expect(row.recipients).toBe(1);
    expect(row.testRecipients).toBe(1);
    expect(row.registrationIds).toHaveLength(2);
    // A test registration is never numbered (§214), so the close sends it nothing.
    expect((await forecast()).some((candidate) => candidate.send === "bibs")).toBe(false);
  });

  it("follows the club's reminder lead: none at all when the club sends none", async () => {
    const rows = await forecastAutomaticEmails(db, { now: NOW, horizonDays: 14, deadlines: { ...DEFAULT_DEADLINES, reminderHours: 0 } });
    expect(rows.some((row) => row.send === "reminder" || row.send === "lastCall")).toBe(false);
  });

  /**
   * §160 — the default window's deadline (`start - 2 days`) and the club's 48-hour reminder lead
   * land on the same instant, so a full event with a waiting list is the case where a declaration
   * hold's last call and its release to the queue would otherwise both claim that lapse. The
   * forecast must side with the job: one waitlist offer, no sign-reminder it can never send.
   */
  it("never promises a last call for a window hold the job releases to the waiting list instead (§160)", async () => {
    const g = await event("Crosul G", at(9 * DAY), { capacity: 1 });
    await registration(g, "g1", "PENDING_DECLARATION", { holdExpiresAt: at(7 * DAY) });
    const g2 = await registration(g, "g2", "WAITLISTED");

    const rows = (await forecast()).filter((row) => row.eventId === g);
    expect(rows.map((row) => row.send)).toEqual(["participation", "nextInLine", "bibs"]);
    expect(rows.find((row) => row.send === "nextInLine")?.registrationIds).toEqual([g2]);
    expect(rows.some((row) => row.send === "lastCall")).toBe(false);

    // The full job, run at that same instant on the same data, agrees: `g2` is offered the
    // place, and `g1` — released before `queueEventReminders` ever looked at it — gets no
    // sign-reminder (`c1`, the fixture's other window race, still gets its own, unaffected).
    await runRegistrationMaintenance(db, at(7 * DAY));
    expect(await queued("WAITLIST_SPOT_OFFER")).toContain("g2");
    expect(await queued("COMPLETE_DECLARATION", ":sign-reminder")).not.toContain("g1");
  });

  /**
   * §160 — a last call *earlier* than the lapse that will later consume its hold is still owed:
   * the job reaches it first, so dropping it merely because the hold eventually lapses to the
   * waiting list would promise a sign-reminder the job sends and the forecast never listed.
   */
  it("still promises a last call that falls before the lapse consuming its hold", async () => {
    const h = await event("Crosul H", at(10 * DAY), { capacity: 1, reminderHoursBefore: 48 });
    const h1 = await registration(h, "h1", "PENDING_DECLARATION", { holdExpiresAt: at(9 * DAY) });
    await registration(h, "h2", "WAITLISTED");

    const rows = (await forecast()).filter((row) => row.eventId === h);
    const lastCall = rows.find((row) => row.send === "lastCall");
    expect(lastCall?.at).toEqual(at(8 * DAY));
    expect(lastCall?.registrationIds).toEqual([h1]);
    expect(rows.find((row) => row.send === "nextInLine")?.at).toEqual(at(9 * DAY));

    // The job agrees: at the last call's own instant, before the hold ever lapses, it is sent.
    await runRegistrationMaintenance(db, at(8 * DAY));
    expect(await queued("COMPLETE_DECLARATION", ":sign-reminder")).toContain("h1");
  });

  /** The mirror case: a lapse strictly *before* the last call's instant wins, as the original §160 case. */
  it("drops a last call whose lapse comes strictly first", async () => {
    const j = await event("Crosul J", at(10 * DAY), { capacity: 1, reminderHoursBefore: 48 });
    await registration(j, "j1", "PENDING_DECLARATION", { holdExpiresAt: at(5 * DAY) });
    await registration(j, "j2", "WAITLISTED");

    const rows = (await forecast()).filter((row) => row.eventId === j);
    expect(rows.some((row) => row.send === "lastCall")).toBe(false);
    expect(rows.find((row) => row.send === "nextInLine")?.at).toEqual(at(5 * DAY));

    await runRegistrationMaintenance(db, at(5 * DAY));
    expect(await queued("COMPLETE_DECLARATION", ":sign-reminder")).not.toContain("j1");
  });

  /** The labels (registered names) of the registrations the outbox rows of one type are for, whose key ends as given. */
  async function queued(type: EmailMessageType, keySuffix = "") {
    const rows = await db
      .select({ label: registrations.registeredName })
      .from(emailOutbox)
      .innerJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
      .where(and(eq(emailOutbox.messageType, type), like(emailOutbox.idempotencyKey, `%${keySuffix}`)));
    return rows.map((row) => row.label).sort();
  }

  async function labelsOf(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db.select({ id: registrations.id, label: registrations.registeredName }).from(registrations);
    return rows.filter((row) => ids.includes(row.id)).map((row) => row.label).sort();
  }

  /**
   * Run the job's own step for one row at an instant, on a fresh copy of the fixture, and return
   * the labels of the registrations it queued that row's message for.
   */
  async function jobAt(row: ForecastRow, when: Date): Promise<{ ids: string[]; count: number }> {
    await seed();
    const participantOnly = async (type: EmailMessageType, suffix: string) => {
      const ids = await queued(type, suffix);
      return { ids, count: ids.length };
    };
    switch (row.send) {
      case "reminder":
        await queueEventReminders(db, when, DEFAULT_DEADLINES);
        return participantOnly("EVENT_REMINDER", ":reminder");
      case "lastCall":
        await queueEventReminders(db, when, DEFAULT_DEADLINES);
        return participantOnly("COMPLETE_DECLARATION", ":sign-reminder");
      case "participation":
        await queueParticipationConfirmations(db, when);
        return participantOnly("COMPLETE_DECLARATION", ":confirm-participation");
      case "nextInLine": {
        await runRegistrationMaintenance(db, when);
        return participantOnly("WAITLIST_SPOT_OFFER", "");
      }
      case "bibs":
        await runRegistrationMaintenance(db, when);
        return participantOnly("BIB_ASSIGNED", ":bib-settled");
      case "registrationOpened": {
        const { queued: count } = await queueRegistrationOpenedMessages(db, when);
        return { ids: [], count };
      }
    }
  }

  it("matches, row by row, what the job's own code picks at that moment — and nothing a minute before", async () => {
    const rows = await forecast();
    expect(rows).toHaveLength(6);
    const expected = new Map<ForecastRow, string[]>();
    for (const row of rows) expected.set(row, await labelsOf(row.registrationIds));
    expect(expected.get(rows.find((row) => row.send === "reminder") as ForecastRow)).toEqual(["a1", "a2"]);

    for (const row of rows) {
      const due = await jobAt(row, row.at);
      expect(due.count, `${row.send} at its moment`).toBe(row.recipients + row.testRecipients);
      if (row.registrationIds.length > 0) expect(due.ids, row.send).toEqual(expected.get(row));
      const early = await jobAt(row, new Date(row.at.getTime() - MINUTE));
      expect(early.count, `${row.send} a minute early`).toBe(0);
    }
    // The next in line is the person waiting.
    await jobAt(rows[0], rows[0].at);
    expect(await queued("WAITLIST_SPOT_OFFER")).toEqual(["d2"]);
  });
});
