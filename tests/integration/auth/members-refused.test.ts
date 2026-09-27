import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §NNN — a club member is refused by the backoffice at every kind of door, and an
 * Administrator adds members in bulk, the whole list or nobody.
 *
 * The session is the real one (`session.ts`, the development switcher's cookie), over a real
 * database. With a member's cookie:
 *
 * - the backoffice's layout **redirects to the members' zone** (`/ro/zona-membri`) — the chosen
 *   answer, rather than the 404 a stranger gets where there is no sign-in at all: a member is
 *   signed in, and the sign-in page would only send them back here;
 * - a backoffice page (`/admin/pages/members`) refuses with `UNAUTHENTICATED` from `requireStaff`;
 * - a Server Action (`saveMembersTextAction`, `inviteMembersAction`) returns the refusal and writes
 *   nothing;
 * - a route handler (`/api/admin/registrations/export`) answers 401.
 *
 * «Adaugă mai mulți membri»: one row that is not an address, or one address already on the team,
 * and nobody is added — no row, no invitation; a clean list adds every row as `MEMBER` with its
 * own `MEMBER_INVITATION`, in one transaction.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/ui/BackofficeShell", () => ({ default: () => null }));
vi.mock("@/shared/feedback/ToastProvider", () => ({ default: () => null }));
vi.mock("@/shared/forms/pickers/PickerProvider", () => ({ default: () => null }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getMessages: async () => ro,
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { default: AdminLayout } = await import("@/app/[locale]/admin/layout");
const { default: AdminMembersPage } = await import("@/app/[locale]/admin/pages/members/page");
const { saveMembersTextAction } = await import("@/app/[locale]/admin/pages/members/actions");
const { inviteMembersAction } = await import("@/app/[locale]/admin/actions");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

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

describe("§NNN the backoffice refuses a member at every door", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let member: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Ana Membru", role: "MEMBER" }).returning();
    await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ioana", role: "ADMIN" });
  });

  it("sends a member from any backoffice page to the members' zone, and a stranger to the sign-in", async () => {
    state.cookie = member.id;
    expect(await redirectedTo(AdminLayout({ children: null, params: Promise.resolve({ locale: "ro" }) }))).toBe("/ro/zona-membri");
    state.cookie = undefined;
    expect(await redirectedTo(AdminLayout({ children: null, params: Promise.resolve({ locale: "ro" }) }))).toBe("/ro/autentificare");
  });

  it("refuses a member on a backoffice page, in a Server Action and on an admin route", async () => {
    state.cookie = member.id;
    await expect(
      AdminMembersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const saved = await saveMembersTextAction(null, form({ uiLocale: "ro", text: "zone", zoneRoBody: "", zoneEnBody: "" }));
    expect(saved?.error).toBe("UNAUTHENTICATED");

    const invited = await inviteMembersAction(null, form({ uiLocale: "ro", members: "altul@dev.test", preferredLocale: "ro" }));
    expect(invited?.error).toBe("UNAUTHENTICATED");
    expect(await db.select().from(staffUsers).where(eq(staffUsers.email, "altul@dev.test"))).toHaveLength(0);

    const response = await exportRegistrations(new Request("http://localhost/api/admin/registrations/export"));
    expect(response.status).toBe(401);
  });
});

describe("§NNN «Adaugă mai mulți membri» — the whole list or nobody", () => {
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
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Ioana", role: "ADMIN" }).returning();
    state.cookie = admin.id;
  });

  const members = () => db.select().from(staffUsers).where(eq(staffUsers.role, "MEMBER")).orderBy(asc(staffUsers.email));

  it("adds nobody when one row is not an address, and names that row", async () => {
    const outcome = await inviteMembersAction(
      null,
      form({ uiLocale: "ro", preferredLocale: "ro", members: "Ana Pop, ana@dev.test\nnu-e-adresa\nmihai@dev.test" }),
    );
    expect(outcome?.error).toBe("INVALID_ADDRESSES");
    expect(outcome?.errorValues).toEqual({ addresses: "nu-e-adresa" });
    expect(outcome?.fields).toEqual(["members"]);
    expect(outcome?.values.members?.[0]).toContain("nu-e-adresa");
    expect(await members()).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("adds nobody when one address is already on the team, and names it", async () => {
    const outcome = await inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "ana@dev.test\nADMIN@dev.test" }));
    expect(outcome?.error).toBe("MEMBERS_ON_TEAM");
    expect(outcome?.errorValues).toEqual({ addresses: "admin@dev.test" });
    expect(await members()).toHaveLength(0);
  });

  it("adds every row of a clean list as a member, each with their own invitation", async () => {
    const to = await redirectedTo(
      inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "en", members: "Ana Pop, ana@dev.test\n\nmihai@dev.test\nana@dev.test" })),
    );
    expect(to).toContain("saved=membersInvited");
    expect(to).toContain("count=2");
    const added = await members();
    expect(added.map((row) => [row.email, row.displayName, row.preferredLocale])).toEqual([
      ["ana@dev.test", "Ana Pop", "en"],
      ["mihai@dev.test", "mihai", "en"],
    ]);
    const invitations = await db.select().from(emailOutbox);
    expect(invitations.map((row) => row.messageType)).toEqual(["MEMBER_INVITATION", "MEMBER_INVITATION"]);
    // One audit row per press, counts and row ids only — never an address.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.members_invited"));
    expect(audit.metadataJson).toMatchObject({ added: 2, existing: 0 });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("@");
  });

  it("takes an address that is already a member again, so a failed account is retried by pressing again", async () => {
    await redirectedTo(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: "ana@dev.test" })));
    const to = await redirectedTo(inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: ["ANA@dev.test", "mihai@dev.test"].join("\n") })));
    expect(to).toContain("count=1");
    expect(to).toContain("retried=1");
    expect((await members()).map((row) => row.email)).toEqual(["ana@dev.test", "mihai@dev.test"]);
    // No second platform invitation for the member already there.
    expect((await db.select().from(emailOutbox)).map((row) => row.recipientEmail).sort()).toEqual(["ana@dev.test", "mihai@dev.test"]);
  });

  it("refuses more than fifty rows in one press", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => `m${index}@dev.test`).join("\n");
    const outcome = await inviteMembersAction(null, form({ uiLocale: "ro", preferredLocale: "ro", members: rows }));
    expect(outcome?.error).toBe("TOO_MANY_ADDRESSES");
    expect(outcome?.errorValues).toEqual({ max: "50" });
    expect(await members()).toHaveLength(0);
  });
});
