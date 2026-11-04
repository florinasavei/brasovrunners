import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01 — «Emailuri azi» (`/admin/settings/emails/today`, the design «telling the owner about every email a
 * staff press sends», slice 1, its section 5) names people and their addresses, so it is the Administrator's and
 * the Superadministrator's alone, asserted on the server: the page itself refuses every other role before it reads a
 * row — the desk's volunteer, the Organizer (§289) and the Tehnic role (§38) — whatever link a page drew or not.
 *
 * The session is the real one (`session.ts`, the development switcher's cookie), over PGlite; the page is called as
 * Next calls it. The links to it are drawn under the same predicate the page asserts.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => createTranslator({ locale: "ro", messages: ro, namespace: "Admin" }),
}));

const { default: EmailsTodayPage } = await import("@/app/[locale]/admin/settings/emails/today/page");
const { default: EmailJournal } = await import("@/modules/notifications/ui/EmailJournal");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

let db: TestDatabase;
let close: () => Promise<void>;
const accounts = new Map<StaffRole, StaffUser>();

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  accounts.clear();
  for (const role of ["CONTRIBUTOR", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    const [account] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
    accounts.set(role, account);
  }
});

const open = () => EmailsTodayPage({ params: Promise.resolve({ locale: "ro" }) });

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "opened";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return code;
    throw error;
  }
}

/** The element of `type` in a tree the page returned, before rendering. */
function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  return find((node.props as { children?: unknown }).children, type);
}

describe("BR-REQ-060-01 «Emailuri azi» is the Administrator's and the Superadministrator's alone", () => {
  it("refuses the desk's volunteer, the Organizer and the Tehnic role with FORBIDDEN, on the server", async () => {
    for (const role of ["CONTRIBUTOR", "MODERATOR", "DEV"] as const) {
      state.cookie = accounts.get(role)?.id;
      expect(await codeOf(open()), role).toBe("FORBIDDEN");
    }
  });

  it("refuses nobody signed in", async () => {
    state.cookie = undefined;
    expect(await codeOf(open())).toBe("UNAUTHENTICATED");
  });

  it("opens for the Administrator and the Superadministrator, with the day's journal read", async () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.cookie = accounts.get(role)?.id;
      const page = await open();
      const journal = find(page, EmailJournal);
      expect(journal, role).not.toBeNull();
      expect(journal?.props.journal).toMatchObject({ waiting: [], departed: [], counts: { sent: 0, waiting: 0, failed: 0 }, repeats: [], more: 0 });
    }
  });

  it("draws its links under the predicate the page asserts: the queue's, the «Emailuri» tab's and the registrations' outbox panel", () => {
    expect(read("src/app/[locale]/admin/settings/emails/today/page.tsx")).toContain("await requireStaffCapability(canManageRegistrations)");
    const emails = read("src/app/[locale]/admin/settings/emails/page.tsx");
    expect(emails).toMatch(/const maySendNow = canManageRegistrations\(staff\.role\);/);
    expect(emails).toMatch(/const journalHref = maySendNow \? getPathname\(\{ locale, href: "\/admin\/settings\/emails\/today" \}\) : undefined;/);
    const list = read("src/app/[locale]/admin/registrations/(list)/page.tsx");
    expect(list).toMatch(/const mayManage = canManageRegistrations\(actor\.role\);/);
    expect(list).toMatch(/\{mayManage && \(\s*<Typography[^>]*>\s*<MuiLink href=\{getPathname\(\{ locale, href: "\/admin\/settings\/emails\/today" \}\)\}/);
  });
});
