import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §524 — a club member signs in through the staff door and is no staff.
 *
 * The session is read the one way it is everywhere (`session.ts`, the development switcher's
 * cookie in tests), from a real database: a member is an account (`getCurrentAccount`) and not a
 * staff session (`getCurrentStaffUser`), so every backoffice door that asks `requireStaff` or
 * `requireStaffCapability` refuses one as it refuses a stranger. The backoffice's layout sends a
 * member on to the members' zone; the zone sends a stranger to the sign-in in the members' words
 * and shows a member the club's words for members.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/admin/actions", () => ({ signOutAction: async () => {} }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { getCurrentAccount, getCurrentStaffUser, requireStaff, requireStaffCapability } = await import("@/modules/staff-identity/session");
const { canOpenMembersZone, canWorkTheDesk } = await import("@/modules/staff-identity/domain/roles");
const { saveMembersText } = await import("@/modules/content/members/page-settings");
const { default: MembersAreaPage } = await import("@/app/[locale]/members-area/page");

/** Where a Next `redirect()` pointed, read from the error it throws. */
async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("§524 a member signs in and is no staff", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let member: StaffUser;
  let volunteer: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@dev.test", displayName: "Vlad", role: "CONTRIBUTOR" }).returning();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ioana", role: "ADMIN" }).returning();
  });

  it("is an account and not a staff session, so every staff door refuses them", async () => {
    state.cookie = member.id;
    expect((await getCurrentAccount())?.id).toBe(member.id);
    expect(await getCurrentStaffUser()).toBeNull();
    await expect(requireStaff()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    // Even a capability every account has is not a way through the staff door.
    await expect(requireStaffCapability(canOpenMembersZone)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("leaves every colleague a staff session, the volunteer included", async () => {
    state.cookie = volunteer.id;
    expect((await getCurrentStaffUser())?.id).toBe(volunteer.id);
    expect((await requireStaffCapability(canWorkTheDesk)).id).toBe(volunteer.id);
    expect((await getCurrentAccount())?.id).toBe(volunteer.id);
  });

  it("sends a stranger from the members' zone to the sign-in in the members' words", async () => {
    const to = await redirectedTo(MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(to).toBe("/ro/autentificare?to=members");
  });

  it("shows a member the club's words for members, their name, and no way into the backoffice", async () => {
    await saveMembersText(db, {
      actor: admin,
      text: "zone",
      fields: {
        zoneRoBody: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Codul de reducere: ALERG." }] }] }),
        zoneEnBody: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The discount code: ALERG." }] }] }),
      },
    });
    state.cookie = member.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain("Codul de reducere: ALERG.");
    expect(html).not.toContain("The discount code");
    expect(html).toContain("Ana Membru");
    expect(html).toContain('data-testid="members-sign-out"');
    expect(html).toContain('name="from" value="members"');
    expect(html).not.toContain('data-testid="members-backoffice"');
  });

  it("shows an Administrator no way into the backoffice either (§NNN)", async () => {
    state.cookie = admin.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain('data-testid="members-sign-out"');
    expect(html).not.toContain('data-testid="members-backoffice"');
    expect(html).not.toMatch(/href="\/ro\/admin/);
  });

  it("says the platform's sentence when the zone is written in one language only, or not at all", async () => {
    state.cookie = member.id;
    const html = renderToStaticMarkup(await MembersAreaPage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain('data-testid="members-zone-empty"');
    expect(html).toContain(ro.Members.zoneEmpty);
  });
});
