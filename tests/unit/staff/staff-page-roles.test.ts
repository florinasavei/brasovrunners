import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "@/db/schema/staff-users";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §NNN — what an Administrator and a Superadministrator see on `/admin/staff`.
 *
 * The service refuses an Administrator who reaches for a Superadministrator; this is the other
 * half, the page: a Superadministrator's row carries a line saying whose it is and no verb, and
 * every role select — the invitation's and each row's — offers exactly the roles the reader may
 * give. The page is a Server Component, so it is called and its element tree walked: the selects'
 * options are a closed menu that no static render would print.
 */
let actor: StaffUser;
let team: StaffUser[];

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/staff" }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/shared/config/env", () => ({ env: { STAFF_AUTH_MODE: "dev-switcher" } }));
vi.mock("@/modules/staff-identity/session", () => ({ requireStaff: async () => actor }));
vi.mock("@/modules/staff-identity/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/staff-identity/service")>()),
  listStaff: async () => team,
}));
vi.mock("@/modules/staff-identity/zitadel-users", () => ({ isZitadelInviteConfigured: () => false }));
vi.mock("@/modules/diagnostics/invite-key", () => ({
  checkInviteKey: async () => ({ kind: "inapplicable" }),
  hasNoAccount: () => false,
}));
vi.mock("@/shared/feedback/confirm-words", () => ({ confirmWords: async () => ({ cancel: "Renunță" }) }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
vi.mock("@/app/[locale]/admin/actions", () => ({
  changeStaffRoleAction: vi.fn(),
  inviteStaffAction: vi.fn(),
  resendStaffInviteAction: vi.fn(),
  revokeStaffAction: vi.fn(),
  sendStaffPasswordResetAction: vi.fn(),
  setStaffAccountActiveAction: vi.fn(),
}));

const { default: StaffPage } = await import("@/app/[locale]/admin/staff/page");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first, through children and through the table's row verbs. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

function member(id: string, role: StaffRole): StaffUser {
  return {
    id,
    email: `${id}@dev.test`,
    displayName: id,
    role,
    firstSignedInAt: new Date("2026-09-01T10:00:00.000Z"),
  } as unknown as StaffUser;
}

/** The page's tree, the table's element, and the row verbs as the table would draw them per member. */
async function render(reader: StaffRole) {
  actor = member("reader", reader);
  team = [actor, ...STAFF_ROLES.map((role) => member(`m-${role}`, role))];
  const tree = await StaffPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) });
  const all = elements(tree);
  const table = all.find((element) => typeof element.props.rowActions === "function");
  if (!table) throw new Error("no AdminTable in the page");
  const rowActions = table.props.rowActions as (row: StaffUser) => ReactNode;
  const rows = new Map(team.map((row) => [row.id, elements(rowActions(row))]));
  return { all, rows };
}

/** The values a select named `role` offers inside `tree`. */
function roleOptions(tree: ReactElement<Props>[]): string[][] {
  return tree
    .filter((element) => element.props.name === "role" && element.props.select === true)
    .map((select) => elements(select.props.children).map((option) => String(option.props.value)));
}

const superadminLine = (tree: ReactElement<Props>[]) => tree.filter((element) => element.props["data-testid"] === "staff-superadmin-row");

describe("BR-REQ-060-01 the team page, read by an Administrator (§NNN)", () => {
  let page: Awaited<ReturnType<typeof render>>;
  beforeEach(async () => {
    page = await render("ADMIN");
  });

  it("offers every role but the Superadministrator in the invitation", () => {
    const inviteSelects = roleOptions(page.all);
    expect(inviteSelects).toEqual([["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"]]);
  });

  it("shows a Superadministrator's row as a line with no verb", () => {
    const row = page.rows.get("m-SUPERADMIN")!;
    const line = superadminLine(row);
    expect(line).toHaveLength(1);
    expect(line[0].props.children).toBe("Rolul și accesul unui Superadministrator le schimbă doar un Superadministrator.");
    expect(roleOptions(row)).toEqual([]);
    expect(row.some((element) => typeof element.props.action === "function")).toBe(false);
  });

  it.each(STAFF_ROLES.filter((role) => role !== "SUPERADMIN"))("gives the %s row a role select without the top role, and no line", (role) => {
    const row = page.rows.get(`m-${role}`)!;
    expect(superadminLine(row)).toEqual([]);
    expect(roleOptions(row)).toEqual([["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"]]);
  });

  it("offers nothing on the reader's own row", () => {
    expect(page.rows.get("reader")).toEqual([]);
  });
});

describe("BR-REQ-060-01 the team page, read by a Superadministrator (§NNN)", () => {
  let page: Awaited<ReturnType<typeof render>>;
  beforeEach(async () => {
    page = await render("SUPERADMIN");
  });

  it("offers every role in the invitation", () => {
    expect(roleOptions(page.all)).toEqual([[...STAFF_ROLES]]);
  });

  it.each([...STAFF_ROLES])("gives the %s row every role and no read-only line", (role) => {
    const row = page.rows.get(`m-${role}`)!;
    expect(superadminLine(row)).toEqual([]);
    expect(roleOptions(row)).toEqual([[...STAFF_ROLES]]);
  });
});

describe("BR-REQ-060-01 the team page below the Administrator", () => {
  it.each(STAFF_ROLES.filter((role) => role !== "ADMIN" && role !== "SUPERADMIN"))("answers 404 to a %s", async (role) => {
    await expect(render(role)).rejects.toThrow("NOT_FOUND");
  });
});
