import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { SUPPLEMENTARY_PLACE_UNCONFIRMED } from "@/modules/registrations/domain/capacity";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, the invitations review of 2026-10-03 — «Trimite invitațiile» refused with
 * `SUPPLEMENTARY_PLACE_UNCONFIRMED` answers with state, not a redirect, so the page is not redrawn: the
 * action hands back the server's current capacity and places free for invitations
 * (`readInvitationForecast`), and the next press, asked on those numbers, goes through — no reload.
 * The island's question is `InviteForm`'s: `capacity + max(count − free, 0)`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations" }));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { inviteAction } = await import("@/app/[locale]/admin/registrations/invitation-actions");
const { readInvitationForecast } = await import("@/modules/registrations/admin-service");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

async function createEvent(capacity: number): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + 30 * 24 * 3_600_000),
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: false,
      eventStatus: "SCHEDULED",
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return event.id;
}

function press(eventId: string, typed: string, addPlace: number | null): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("typed", typed);
  form.set("days", "7");
  form.set("inviteLocale", "en");
  form.set("addPlace", addPlace === null ? "" : String(addPlace));
  return form;
}

/** `InviteForm`'s question on a forecast: the capacity it names, or null when no place is added. */
const named = (forecast: { capacity: number | null; free: number | null }, count: number) =>
  forecast.capacity === null || forecast.free === null || count <= forecast.free ? null : forecast.capacity + (count - forecast.free);

describe("§NNN a refused send hands the next dialog the server's numbers", () => {
  it("the page drawn with a free place, the place taken since: refused with the new numbers, and the second press goes through", async () => {
    const eventId = await createEvent(1);
    const drawn = await readInvitationForecast(db, eventId, new Date());
    expect(drawn).toEqual({ capacity: 1, free: 1 });

    // Another Administrator's invitation takes the free place after the page was drawn.
    await expect(inviteAction(null, press(eventId, "Ana Pop <ana@example.invalid>", named(drawn!, 1)))).rejects.toThrow(/REDIRECT .*saved=invitationsSent/);

    // The press asked on the page's numbers names no raise: refused, nothing written, the numbers handed back.
    const refused = await inviteAction(null, press(eventId, "Bogdan Pop <bogdan@example.invalid>", named(drawn!, 1)));
    expect(refused).toMatchObject({ error: SUPPLEMENTARY_PLACE_UNCONFIRMED, forecast: { capacity: 1, free: 0 } });
    expect((await db.select().from(eventInvitations).where(eq(eventInvitations.canonicalEmail, "bogdan@example.invalid"))).length).toBe(0);

    // The second press, asked on the handed-back numbers, names «capacitatea devine 2» and is sent.
    await expect(inviteAction(refused, press(eventId, "Bogdan Pop <bogdan@example.invalid>", named(refused!.forecast!, 1)))).rejects.toThrow(
      /REDIRECT .*saved=invitationsSentRaised&count=1&capacity=2/,
    );
    const [bogdan] = await db.select().from(eventInvitations).where(eq(eventInvitations.canonicalEmail, "bogdan@example.invalid"));
    expect(bogdan).toMatchObject({ supplementaryRaise: true, locale: "en" });
    expect((await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity).toBe(2);
  });

  it("any refusal carries the numbers too: a duplicate line is refused by name with the forecast beside it", async () => {
    const eventId = await createEvent(3);
    const refused = await inviteAction(null, press(eventId, "Ana Pop <ana@example.invalid>\nAna P. <ana@example.invalid>", null));
    expect(refused).toMatchObject({ error: "INVITATION_DUPLICATE", forecast: { capacity: 3, free: 3 } });
    expect(await db.execute(sql`select count(*)::int as n from event_invitations`)).toMatchObject({ rows: [{ n: 0 }] });
  });
});
