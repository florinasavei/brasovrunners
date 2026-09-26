import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { createTranslator } from "next-intl";
import enMessages from "../../../messages/en.json";
import roMessages from "../../../messages/ro.json";
import {
  countRegisteredForUpcoming,
  forgetRegisteredBadgeCount,
  registeredBadgeBreakdown,
  registeredBadgeHint,
  type RegisteredOnEvent,
} from "@/modules/registrations/nav-count";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-041-01, `DECISIONS.md` §255 — the figure beside the "Înscrieri" tab.
 *
 * The owner asked for it with a constraint attached: "but DB efficiently! please note we use a
 * light DB". So what is asserted here is as much *what is not counted* as what is: one query,
 * no cancellations, no test rows, nothing from an event that has already run — and a memo, so
 * the shell that renders on every backoffice page does not ask again on every page.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");
const DAY = 86_400_000;

describe("§255 how many are signed up", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let upcoming: string;
  let past: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    forgetRegisteredBadgeCount();
    const [next] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 7 * DAY), registrationMode: "INTERNAL", capacity: 100 })
      .returning();
    const [done] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() - 7 * DAY), registrationMode: "INTERNAL", capacity: 100 })
      .returning();
    upcoming = next.id;
    past = done.id;
  });

  let counter = 0;
  async function enter(eventId: string, status: RegistrationStatus, kind: "REAL" | "TEST" = "REAL") {
    counter += 1;
    const email = `runner-${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${counter}` })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status,
      kind,
      locale: "ro",
      registeredName: `Runner ${counter}`,
      displayName: `Runner ${counter}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
    });
  }

  it("counts everybody still in the queue for an event that has not run", async () => {
    for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"] as const) {
      await enter(upcoming, status);
    }
    expect(await countRegisteredForUpcoming(db, NOW)).toBe(5);
  });

  it("leaves out what the club does not mean by 'signed up'", async () => {
    await enter(upcoming, "CONFIRMED");
    // Gone: cancelled and expired rows.
    await enter(upcoming, "CANCELLED");
    await enter(upcoming, "EXPIRED");
    // Never in a number the club is given (§12.6).
    await enter(upcoming, "CONFIRMED", "TEST");
    // History: last month's race is not "signed up".
    await enter(past, "CONFIRMED");

    expect(await countRegisteredForUpcoming(db, NOW)).toBe(1);
  });

  it("§NNN splits the figure per upcoming event, in the reader's language, summing to the badge", async () => {
    await db.insert(eventTranslations).values({ eventId: upcoming, locale: "ro", slug: "crosul", title: "Crosul" });
    const [later] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 14 * DAY), registrationMode: "INTERNAL", capacity: 100 })
      .returning();
    await enter(upcoming, "CONFIRMED");
    await enter(upcoming, "WAITLISTED");
    await enter(upcoming, "CONFIRMED", "TEST");
    await enter(later.id, "PENDING_DECLARATION");
    await enter(past, "CONFIRMED");

    const ro = await registeredBadgeBreakdown(db, NOW, "ro");
    expect(ro).toEqual({
      total: 3,
      events: [
        { eventId: upcoming, title: "Crosul", count: 2 },
        { eventId: later.id, title: "—", count: 1 },
      ],
    });
    // No English row: a dash, never the Romanian title.
    const en = await registeredBadgeBreakdown(db, NOW, "en");
    expect(en?.events.map((row) => row.title)).toEqual(["—", "—"]);
    expect(ro?.total).toBe(await countRegisteredForUpcoming(db, NOW));
  });

  it("§NNN memoizes the split a minute per language, and forgetting drops it", async () => {
    await enter(upcoming, "CONFIRMED");
    expect((await registeredBadgeBreakdown(db, NOW, "ro"))?.total).toBe(1);
    await enter(upcoming, "CONFIRMED");
    expect((await registeredBadgeBreakdown(db, new Date(NOW.getTime() + 1_000), "ro"))?.events).toEqual([
      { eventId: upcoming, title: "—", count: 1 },
    ]);
    // The other language has its own memo, read fresh.
    expect((await registeredBadgeBreakdown(db, NOW, "en"))?.total).toBe(2);
    forgetRegisteredBadgeCount();
    expect((await registeredBadgeBreakdown(db, NOW, "ro"))?.total).toBe(2);
  });

  it("§NNN leaves a cancelled event out of the split", async () => {
    const [cancelled] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 3 * DAY), registrationMode: "INTERNAL", capacity: 100, eventStatus: "CANCELLED" })
      .returning();
    await enter(cancelled.id, "CONFIRMED");
    await enter(upcoming, "CONFIRMED");
    const split = await registeredBadgeBreakdown(db, NOW, "ro");
    expect(split?.events.map((row) => row.eventId)).toEqual([upcoming]);
    expect(split?.total).toBe(1);
  });

  it("§NNN the tooltip's words, in Romanian and in English: the rule, five events, how many more", () => {
    const rows: RegisteredOnEvent[] = Array.from({ length: 7 }, (_, i) => ({ eventId: `e${i}`, title: `Cros ${i + 1}`, count: i + 1 }));
    function words(locale: "ro" | "en") {
      const t = createTranslator({ locale, messages: locale === "ro" ? roMessages : enMessages, namespace: "Admin" });
      return {
        rule: t("nav.registeredHint"),
        event: (title: string, count: number) => t("nav.registeredEvent", { title, count }),
        more: (count: number) => t("nav.registeredMoreEvents", { count }),
      };
    }
    expect(registeredBadgeHint(rows, words("ro")).split("\n")).toEqual([
      "Înscrieri active (fără anulate și teste) la evenimentele care urmează:",
      "Cros 1: 1",
      "Cros 2: 2",
      "Cros 3: 3",
      "Cros 4: 4",
      "Cros 5: 5",
      "+2 altele",
    ]);
    expect(registeredBadgeHint(rows, words("en")).split("\n")).toEqual([
      "Active registrations (no cancelled, no tests) on the events still to come:",
      "Cros 1: 1",
      "Cros 2: 2",
      "Cros 3: 3",
      "Cros 4: 4",
      "Cros 5: 5",
      "+2 more",
    ]);
    // Five or fewer: no "more" line.
    expect(registeredBadgeHint(rows.slice(0, 5), words("en")).split("\n")).toHaveLength(6);
  });
});
