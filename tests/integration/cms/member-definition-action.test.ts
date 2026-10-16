import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { MEMBER_DEFINITION_SETTING_KEY, readMemberDefinition } from "@/modules/content/members/member-definition";
import { readMembersPageSettings } from "@/modules/content/members/page-settings";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §789 — «Cine e membru» through its Server Action, over a real database and the real session (the
 * development switcher's cookie): the Administrator and the Redactor save it and land on the card; one
 * language alone is returned as a refusal naming the empty box with both boxes as typed; a member, a
 * Contributor and an Organizer write nothing; and the sentence is saved whether or not «Beneficiile
 * membrilor» is on the site.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { saveMemberDefinitionAction } = await import("@/app/[locale]/admin/pages/members/actions");
const { cachedMemberDefinition } = await import("@/modules/public-cache/reads");

const RO = "Ai fost la cel puțin 5 alergări de grup în ultimele 3 luni.";
const EN = "You have joined at least 5 group runs in the last 3 months.";

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("§789 the «Cine e membru» action", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const staff: Record<string, StaffUser> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "ADMIN"] as const) {
      [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
    }
  });

  it("saves both languages for the Administrator and for the Redactor, and lands on the card", async () => {
    for (const role of ["ADMIN", "COPYWRITER"] as const) {
      state.cookie = staff[role].id;
      const landed = await redirectedTo(saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: EN })));
      expect(landed, role).toBe("/ro/admin/pages/members?saved=memberDefinitionSaved#members-definition");
      expect(await readMemberDefinition(db), role).toMatchObject({ ro: RO, en: EN });
    }
    // The English backoffice lands on its own address.
    state.cookie = staff.ADMIN.id;
    expect(await redirectedTo(saveMemberDefinitionAction(null, form({ uiLocale: "en", memberDefinitionRo: RO, memberDefinitionEn: EN })))).toBe(
      "/en/admin/pages/members?saved=memberDefinitionSaved#members-definition",
    );
  });

  it("is read by the public forms in the page's language: none before a save, the club's sentence after, none again once cleared", async () => {
    expect(await cachedMemberDefinition("ro")).toBeNull();
    state.cookie = staff.ADMIN.id;
    await redirectedTo(saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: EN })));
    expect(await cachedMemberDefinition("ro")).toBe(RO);
    expect(await cachedMemberDefinition("en")).toBe(EN);
    await redirectedTo(saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: "", memberDefinitionEn: "" })));
    expect(await cachedMemberDefinition("ro")).toBeNull();
    expect(await cachedMemberDefinition("en")).toBeNull();
  });

  it("saves it while the members' page is a draft, and does not publish it", async () => {
    state.cookie = staff.ADMIN.id;
    expect((await readMembersPageSettings(db)).status).toBe("DRAFT");
    await redirectedTo(saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: EN })));
    expect((await readMembersPageSettings(db)).status).toBe("DRAFT");
    expect((await readMemberDefinition(db)).ro).toBe(RO);
  });

  it("returns one language alone as a refusal naming the empty box, both boxes kept as typed, nothing written", async () => {
    state.cookie = staff.ADMIN.id;
    const outcome = await saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: "" }));
    expect(outcome?.error).toBe("VALIDATION_ERROR");
    expect(outcome?.fields).toEqual(["memberDefinitionEn"]);
    expect(outcome?.values).toMatchObject({ memberDefinitionRo: [RO], memberDefinitionEn: [""] });
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, MEMBER_DEFINITION_SETTING_KEY))).toEqual([]);
  });

  it("refuses a member, a Contributor and an Organizer, and writes nothing", async () => {
    const expected = { MEMBER: "UNAUTHENTICATED", CONTRIBUTOR: "FORBIDDEN", MODERATOR: "FORBIDDEN" } as const;
    for (const role of ["MEMBER", "CONTRIBUTOR", "MODERATOR"] as const) {
      state.cookie = staff[role].id;
      const outcome = await saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: EN }));
      expect(outcome?.error, role).toBe(expected[role]);
    }
    state.cookie = undefined;
    expect((await saveMemberDefinitionAction(null, form({ uiLocale: "ro", memberDefinitionRo: RO, memberDefinitionEn: EN })))?.error).toBe("UNAUTHENTICATED");
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, MEMBER_DEFINITION_SETTING_KEY))).toEqual([]);
  });
});
