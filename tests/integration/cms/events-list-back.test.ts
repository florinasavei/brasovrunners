import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { events, eventTranslations } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-051-01 (`DECISIONS.md` §NNN) — archiving from a filtered, ordered, paged events list
 * lands back on that list: the bulk form posts the list's query string as `back`, and the
 * action's redirect carries it, with only the list's own keys, before its outcome.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { bulkArchiveEventsAction } = await import("@/app/[locale]/admin/actions");

describe("§NNN archive from a filtered list → back on the filtered list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", role: "ADMIN", displayName: "Admin" }).returning();
    state.actor = admin;
  });
  afterAll(async () => close());

  it("redirects to the list with its search, state, order and page, then the outcome", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", surface: "ASPHALT", startsAt: new Date("2026-10-07T16:00:00Z"), timezone: "Europe/Bucharest", editorialStatus: "DRAFT" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "tampa-ro", title: "Tâmpa" },
      { eventId: event.id, locale: "en", slug: "tampa-en", title: "Tâmpa" },
    ]);

    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("back", "q=tampa&state=DRAFT&sort=title-asc&page=2&saved=old&next=//elsewhere");
    form.append("eventRef", `${event.id}:${event.version}`);
    await expect(bulkArchiveEventsAction(form)).rejects.toThrow("NEXT_REDIRECT");

    const url = state.redirected.at(-1) ?? "";
    expect(url).toBe("/ro/admin?q=tampa&state=DRAFT&sort=title-asc&page=2&saved=eventsArchived&archived=1&failed=0#admin-alert");
    const [row] = await db.select({ status: events.editorialStatus }).from(events).where(eq(events.id, event.id));
    expect(row.status).toBe("ARCHIVED");
  });

  it("an empty tick goes back to the same list with the refusal", async () => {
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("back", "state=PAST");
    await expect(bulkArchiveEventsAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected.at(-1)).toBe("/ro/admin?state=PAST&error=NOTHING_SELECTED#admin-alert");
  });
});
