import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied } from "@/modules/registrations/repository";
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
  async function enter(eventId: string, status: RegistrationStatus, kind: "REAL" | "TEST" = "REAL", holdExpiresAt: Date | null = null) {
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
      holdExpiresAt,
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

  it("§476 splits the figure per upcoming event, in the reader's language, summing to the badge", async () => {
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
        { eventId: upcoming, title: "Crosul", count: 2, withPlace: 1, awaitingEmail: 0, waitlisted: 1, capacity: 100 },
        { eventId: later.id, title: "—", count: 1, withPlace: 1, awaitingEmail: 0, waitlisted: 0, capacity: 100 },
      ],
    });
    // No English row: a dash, never the Romanian title.
    const en = await registeredBadgeBreakdown(db, NOW, "en");
    expect(en?.events.map((row) => row.title)).toEqual(["—", "—"]);
    expect(ro?.total).toBe(await countRegisteredForUpcoming(db, NOW));
  });

  it("§476 memoizes the split a minute per language, and forgetting drops it", async () => {
    await enter(upcoming, "CONFIRMED");
    expect((await registeredBadgeBreakdown(db, NOW, "ro"))?.total).toBe(1);
    await enter(upcoming, "CONFIRMED");
    expect((await registeredBadgeBreakdown(db, new Date(NOW.getTime() + 1_000), "ro"))?.events).toEqual([
      { eventId: upcoming, title: "—", count: 1, withPlace: 1, awaitingEmail: 0, waitlisted: 0, capacity: 100 },
    ]);
    // The other language has its own memo, read fresh.
    expect((await registeredBadgeBreakdown(db, NOW, "en"))?.total).toBe(2);
    forgetRegisteredBadgeCount();
    expect((await registeredBadgeBreakdown(db, NOW, "ro"))?.total).toBe(2);
  });

  it("§476 leaves a cancelled event out of the split", async () => {
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

  it("the split says who holds a place: confirmed, awaiting the signature and offered; not awaiting the email, not waitlisted", async () => {
    await enter(upcoming, "CONFIRMED");
    await enter(upcoming, "CONFIRMED");
    await enter(upcoming, "PENDING_DECLARATION");
    await enter(upcoming, "WAITLIST_OFFERED", "REAL", new Date(NOW.getTime() + DAY));
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION");
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION");
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION");
    await enter(upcoming, "WAITLISTED");
    await enter(upcoming, "CANCELLED");
    await enter(upcoming, "CONFIRMED", "TEST");
    const split = await registeredBadgeBreakdown(db, NOW, "ro");
    expect(split?.events).toEqual([
      { eventId: upcoming, title: "—", count: 8, withPlace: 4, awaitingEmail: 3, waitlisted: 1, capacity: 100 },
    ]);
    expect(split?.total).toBe(await countRegisteredForUpcoming(db, NOW));
  });

  it("§543 a family's reservation holds a place like the allocator says; a lapsed offer holds none", async () => {
    await enter(upcoming, "CONFIRMED");
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION", "REAL", new Date(NOW.getTime() + DAY)); // reserved
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION", "REAL", new Date(NOW.getTime() - DAY)); // reservation lapsed
    await enter(upcoming, "PENDING_EMAIL_CONFIRMATION"); // no reservation
    await enter(upcoming, "WAITLIST_OFFERED", "REAL", new Date(NOW.getTime() - DAY)); // lapsed offer
    const split = await registeredBadgeBreakdown(db, NOW, "ro");
    expect(split?.events).toEqual([
      { eventId: upcoming, title: "—", count: 5, withPlace: 2, awaitingEmail: 2, waitlisted: 1, capacity: 100 },
    ]);
    expect(split?.events[0].withPlace).toBe(computeOccupied(await countOccupied(db, upcoming, NOW)));
  });

  it("an event without a limit carries a null capacity", async () => {
    const [open] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 2 * DAY), registrationMode: "INTERNAL", capacity: null })
      .returning();
    await enter(open.id, "CONFIRMED");
    expect((await registeredBadgeBreakdown(db, NOW, "ro"))?.events[0]?.capacity).toBeNull();
  });

  function words(locale: "ro" | "en") {
    const t = createTranslator({ locale, messages: locale === "ro" ? roMessages : enMessages, namespace: "Admin" });
    return {
      rule: t("nav.registeredHint"),
      event: (title: string, count: number, parts: string) => t("nav.registeredEvent", { title, count, parts }),
      withPlace: (count: number) => t("nav.registeredWithPlace", { count }),
      withPlaceOf: (count: number, capacity: number) => t("nav.registeredWithPlaceOf", { count, capacity }),
      awaitingEmail: (count: number) => t("nav.registeredAwaitingEmail", { count }),
      waitlisted: (count: number) => t("nav.registeredWaitlisted", { count }),
      more: (count: number) => t("nav.registeredMoreEvents", { count }),
    };
  }
  const row = (i: number, extra: Partial<RegisteredOnEvent> = {}): RegisteredOnEvent => ({
    eventId: `e${i}`,
    title: `Cros ${i}`,
    count: i,
    withPlace: i,
    awaitingEmail: 0,
    waitlisted: 0,
    capacity: null,
    ...extra,
  });

  it("the tooltip's words, in Romanian and in English: the rule, five events, how many more", () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1));
    expect(registeredBadgeHint(rows, words("ro")).split("\n")).toEqual([
      "Oameni cu o înscriere în curs la evenimentele viitoare — nu locuri. Cine așteaptă confirmarea emailului sau e pe lista de așteptare e numărat aici, dar nu ocupă încă un loc.",
      "Cros 1: 1 — 1 cu loc",
      "Cros 2: 2 — 2 cu loc",
      "Cros 3: 3 — 3 cu loc",
      "Cros 4: 4 — 4 cu loc",
      "Cros 5: 5 — 5 cu loc",
      "+2 altele",
    ]);
    expect(registeredBadgeHint(rows, words("en")).split("\n")).toEqual([
      "People with a registration in progress on the upcoming events — not places. Somebody awaiting the email confirmation or on the waiting list is counted here but holds no place.",
      "Cros 1: 1 — 1 with a place",
      "Cros 2: 2 — 2 with a place",
      "Cros 3: 3 — 3 with a place",
      "Cros 4: 4 — 4 with a place",
      "Cros 5: 5 — 5 with a place",
      "+2 more",
    ]);
    // Five or fewer: no "more" line.
    expect(registeredBadgeHint(rows.slice(0, 5), words("en")).split("\n")).toHaveLength(6);
  });

  it("each event's line carries the split, omitting a zero part except the places", () => {
    const owner = row(1, { title: "Cursa", count: 153, withPlace: 144, awaitingEmail: 9, waitlisted: 0, capacity: 150 });
    const full = row(2, { title: "Alt cros", count: 5, withPlace: 2, awaitingEmail: 1, waitlisted: 2, capacity: 20 });
    const none = row(3, { title: "Fără loc", count: 1, withPlace: 0, awaitingEmail: 0, waitlisted: 1, capacity: 10 });
    expect(registeredBadgeHint([owner, full, none], words("ro")).split("\n").slice(1)).toEqual([
      "Cursa: 153 — 144 cu loc din 150, 9 așteaptă confirmarea emailului",
      "Alt cros: 5 — 2 cu loc din 20, 1 așteaptă confirmarea emailului, 2 pe lista de așteptare",
      "Fără loc: 1 — 0 cu loc din 10, 1 pe lista de așteptare",
    ]);
    expect(registeredBadgeHint([owner, full], words("en")).split("\n").slice(1)).toEqual([
      "Cursa: 153 — 144 of 150 places taken, 9 awaiting the email confirmation",
      "Alt cros: 5 — 2 of 20 places taken, 1 awaiting the email confirmation, 2 on the waiting list",
    ]);
  });
});
