import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Ce arată site-ul despre asociație» on «Pagini» → «Contact»: one `platform_settings` row (no
 * migration), changed by the Administrator alone. The action is pressed as each role: the door asks
 * for `canManageClubSettings` (the session's check, applied to the role here as the real one does),
 * and the service asserts it again behind it.
 */
const NOW = new Date("2026-11-02T18:00:00.000Z");
/** Made up. */
const SHOWN_SEAT = "Strada Exemplu nr. 1, Localitate";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string }) => href, Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    const actor = state.actor as StaffUser;
    if (!capability(actor)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not ${capability.name}`);
    return actor;
  },
}));

const { updateClubIdentityAction } = await import("@/app/[locale]/admin/pages/contact/actions");
const { CLUB_IDENTITY_SETTING_KEY, readClubIdentityShown, updateClubIdentityShown } = await import("@/modules/contact/club-identity");

/** The grid as posted: a box per ticked place, under its line's name. */
function form(ticks: { showName?: string[]; showSeat?: string[]; showEmail?: string[] }): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  for (const [name, places] of Object.entries(ticks)) for (const place of places ?? []) data.append(name, place);
  return data;
}

describe("§NNN what the site shows about the association: the Administrator's alone", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  it("refuses a non-Administrator's press at the action and at the service, and stores nothing", async () => {
    state.actor = organizer;
    const outcome = await updateClubIdentityAction(null, form({ showName: ["home"], showSeat: ["home", "contact"] }));
    expect(outcome).toMatchObject({ error: "FORBIDDEN" });
    await expect(updateClubIdentityShown(db, organizer, { name: [], seat: ["home"], email: [], seatAddress: SHOWN_SEAT }, NOW)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, CLUB_IDENTITY_SETTING_KEY))).toEqual([]);
    expect((await readClubIdentityShown(db)).seat).toEqual([]);
  });

  it("saves the Administrator's ticks and audits them", async () => {
    state.actor = admin;
    // A save redirects back to the page with `?saved=clubIdentity`.
    const posted = form({ showName: ["home", "footer"], showSeat: ["contact"] });
    posted.set("seatAddress", ` ${SHOWN_SEAT} `);
    await expect(updateClubIdentityAction(null, posted)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await readClubIdentityShown(db)).toMatchObject({ name: ["home", "footer"], seat: ["contact"], email: [], seatAddress: SHOWN_SEAT });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "club_identity.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    // Whether a seat is typed, never the address.
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Exemplu");
  });
});
