import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { queueOrderFor } from "@/modules/registrations/domain/waitlist";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §627 — «Coada de înscrieri» lists the people waiting in the order the club hands places out by,
 * and says when each form was sent. With `waitlist_auto_offer` off (the club picks by hand) the order
 * is `submitted_at`; with it on, the line's own `waitlisted_at`, the order automatic offers follow.
 * «Sent» is the current cycle's: `greatest(submitted_at, privacy_acknowledged_at)`, the journey's rule,
 * because a restart rewrites the second and never the first. The time of a form is a backoffice line: the public list's select does not carry it
 * (`tests/privacy/public-surface.test.ts`).
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

vi.mock("@/modules/deadlines/request", async () => {
  const { DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");
  return { deadlinesForThisRequest: async () => ({ ...DEFAULT_DEADLINES }) };
});

const { default: QueuePanel } = await import("@/modules/registrations/ui/QueuePanel");
const { listQueueForEvent } = await import("@/modules/registrations/admin-repository");

const NOW = new Date("2026-10-01T16:00:00.000Z");
/** Sent first, joined the line last (a form whose address was confirmed late). */
const SENT_EARLY = new Date("2026-09-30T08:00:00.000Z");
const SENT_MIDDLE = new Date("2026-09-30T09:00:00.000Z");
const SENT_LATE = new Date("2026-09-30T10:00:00.000Z");
const JOINED_FIRST = new Date("2026-10-01T07:00:00.000Z");
const JOINED_SECOND = new Date("2026-10-01T08:00:00.000Z");
const JOINED_THIRD = new Date("2026-10-01T09:00:00.000Z");

async function createEvent(waitlistAutoOffer: boolean) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T08:00:00.000Z"),
      timezone: CLUB_TIME_ZONE,
      capacity: 1,
      waitlistAutoOffer,
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
    // A first form acknowledges the notice in the same instant it is sent; a restart rewrites only this one.
    privacyAcknowledgedAt: row.submittedAt ?? NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "WAITLISTED",
    ...row,
  });
}

/** Three waiting people whose two orders disagree: by form Ciprian, Bianca, Ana; by line Ana, Bianca, Ciprian. */
async function threeWaiting(eventId: string) {
  await register(eventId, "Ana Prima", { submittedAt: SENT_LATE, waitlistedAt: JOINED_FIRST });
  await register(eventId, "Bianca Doua", { submittedAt: SENT_MIDDLE, waitlistedAt: JOINED_SECOND });
  await register(eventId, "Ciprian Trei", { submittedAt: SENT_EARLY, waitlistedAt: JOINED_THIRD });
}

async function renderPanel(event: Awaited<ReturnType<typeof createEvent>>, waiting = 3) {
  const element = await QueuePanel({
    db,
    event: {
      id: event.id,
      capacity: event.capacity,
      waitlistCapacity: event.waitlistCapacity,
      timezone: event.timezone,
      waitlistAutoOffer: event.waitlistAutoOffer,
    },
    waiting,
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

describe("§627 the queue reader's order", () => {
  it("lists the waiting by when the form was sent when the club hands places out by hand", async () => {
    const event = await createEvent(false);
    await threeWaiting(event.id);
    const rows = await listQueueForEvent(db, event.id, NOW, queueOrderFor(event.waitlistAutoOffer));
    expect(rows.map((row) => row.registeredName)).toEqual(["Ciprian Trei", "Bianca Doua", "Ana Prima"]);
    // Both times on every row: the panel writes the form's, and the join stays for the line.
    for (const row of rows) {
      expect(row.formSentAt).toBeInstanceOf(Date);
      expect(row.waitlistedAt).toBeInstanceOf(Date);
    }
  });

  it("keeps the line's own order, the allocator's, when offers go out on their own", async () => {
    const event = await createEvent(true);
    await threeWaiting(event.id);
    const rows = await listQueueForEvent(db, event.id, NOW, queueOrderFor(event.waitlistAutoOffer));
    expect(rows.map((row) => row.registeredName)).toEqual(["Ana Prima", "Bianca Doua", "Ciprian Trei"]);
    for (const row of rows) expect(row.formSentAt).toBeInstanceOf(Date);
  });

  it("dates and orders by the form sent again, not the first one a restart left behind", async () => {
    const event = await createEvent(false);
    // Dan sent his first form at SENT_EARLY, let the link lapse, and sent it again at SENT_LATE: a
    // restart rewrote privacy_acknowledged_at and left submitted_at where it was.
    await register(event.id, "Dan Retrimis", { submittedAt: SENT_EARLY, privacyAcknowledgedAt: SENT_LATE, waitlistedAt: JOINED_THIRD });
    await register(event.id, "Eva Mijloc", { submittedAt: SENT_MIDDLE, waitlistedAt: JOINED_SECOND });
    const rows = await listQueueForEvent(db, event.id, NOW, "SUBMITTED");
    expect(rows.map((row) => row.registeredName)).toEqual(["Eva Mijloc", "Dan Retrimis"]);
    expect(rows[1].formSentAt.getTime()).toBe(SENT_LATE.getTime());
    expect(rows[0].formSentAt.getTime()).toBe(SENT_MIDDLE.getTime());

    locale = "ro";
    const html = await renderPanel(event, 2);
    const at = (date: Date) => formatDay(date, { locale: "ro", timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
    expect(html).toContain(ro.Admin.queue.sent.replace("{when}", at(SENT_LATE)));
    expect(html).not.toContain(ro.Admin.queue.sent.replace("{when}", at(SENT_EARLY)));
  });

  it("breaks a tie by id in either order", async () => {
    const event = await createEvent(false);
    for (const name of ["Dan Egal", "Eva Egal"]) await register(event.id, name, { submittedAt: SENT_EARLY, waitlistedAt: JOINED_FIRST });
    const submitted = await listQueueForEvent(db, event.id, NOW, "SUBMITTED");
    const line = await listQueueForEvent(db, event.id, NOW, "LINE");
    expect(submitted.map((row) => row.id)).toEqual([...submitted.map((row) => row.id)].sort());
    expect(line.map((row) => row.id)).toEqual(submitted.map((row) => row.id));
  });
});

describe("§627 the queue panel's rows", () => {
  for (const language of ["ro", "en"] as const) {
    it(`says when each waiting form was sent, beside when the person joined the line, in the shown order (${language})`, async () => {
      locale = language;
      const event = await createEvent(false);
      await threeWaiting(event.id);
      const html = await renderPanel(event);
      const words = (language === "ro" ? ro : en).Admin.queue;
      const at = (date: Date) => formatDay(date, { locale: language, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

      expect(html).toContain(words.sent.replace("{when}", at(SENT_EARLY)));
      expect(html).toContain(words.sent.replace("{when}", at(SENT_LATE)));
      expect(html).toContain(words.joined.replace("{when}", at(JOINED_FIRST)));
      expect(html).toContain(words.orderSubmitted);
      expect(html).not.toContain(words.orderLine);
      // The rows follow the forms: Ciprian sent first, Ana last.
      expect(html.indexOf("Ciprian Trei")).toBeLessThan(html.indexOf("Bianca Doua"));
      expect(html.indexOf("Bianca Doua")).toBeLessThan(html.indexOf("Ana Prima"));
    });
  }

  it("lists in the line's order and says so when offers go out on their own", async () => {
    const event = await createEvent(true);
    await threeWaiting(event.id);
    const html = await renderPanel(event);
    expect(html).toContain(ro.Admin.queue.orderLine);
    expect(html).not.toContain(ro.Admin.queue.orderSubmitted);
    expect(html.indexOf("Ana Prima")).toBeLessThan(html.indexOf("Bianca Doua"));
    expect(html.indexOf("Bianca Doua")).toBeLessThan(html.indexOf("Ciprian Trei"));
    // The time of the form is on the row in this order too.
    expect(html).toContain(ro.Admin.queue.sent.split("{")[0]);
  });
});
