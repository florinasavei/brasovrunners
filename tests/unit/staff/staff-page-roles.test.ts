import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "@/db/schema/staff-users";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §450 — what an Administrator and a Superadministrator see on `/admin/staff`.
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
// The levels the club named (§811): the page reads them; none here.
vi.mock("@/modules/content/member-tiers/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/member-tiers/repository")>()),
  listAllMemberTiers: async () => [],
}));
vi.mock("@/modules/staff-identity/zitadel-users", () => ({ isZitadelInviteConfigured: () => false }));
vi.mock("@/modules/diagnostics/invite-key", () => ({
  checkInviteKey: async () => ({ kind: "inapplicable" }),
  hasNoAccount: () => false,
}));
vi.mock("@/shared/feedback/confirm-words", () => ({ confirmWords: async () => ({ cancel: "Renunță" }) }));
// «Retrimite invitația»'s two answers read the club's timing (§540); the roles do not depend on it.
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
// The invitations' refusals (§671) are a read of the outbox; the roles do not depend on them.
vi.mock("@/modules/notifications/delivery-evidence", () => ({ refusedInvitations: async () => new Map() }));
vi.mock("@/app/[locale]/admin/actions", () => ({
  changeStaffRoleAction: vi.fn(),
  inviteStaffAction: vi.fn(),
  inviteMembersAction: vi.fn(),
  resendStaffInviteAction: vi.fn(),
  revokeStaffAction: vi.fn(),
  sendStaffPasswordResetAction: vi.fn(),
  setMemberTierAction: vi.fn(),
  setStaffAccountActiveAction: vi.fn(),
  setStaffPermissionAction: vi.fn(),
}));

const { default: StaffPage } = await import("@/app/[locale]/admin/staff/page");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first, through children. */
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

/** The tree under the first element whose `data-testid` is `testId`. */
const under = (tree: ReactElement<Props>[], testId: string) => elements(tree.find((element) => element.props["data-testid"] === testId));

/**
 * The page's tree, the «Adaugă o persoană» form's, and each member's row fold (§842) as the page draws it — its line and,
 * behind the pencil, its controls — with `controls` the fold's body alone (nothing for a row that has no fold).
 */
async function render(reader: StaffRole) {
  actor = member("reader", reader);
  team = [actor, ...STAFF_ROLES.map((role) => member(`m-${role}`, role))];
  const tree = await StaffPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) });
  const all = elements(tree);
  const rowOf = (id: string) => elements(all.find((element) => element.props["data-testid"] === "staff-row" && element.props["data-staff-id"] === id));
  const rows = new Map(team.map((row) => [row.id, rowOf(row.id)]));
  const controls = new Map(
    team.map((row) => {
      const fold = rows.get(row.id)!.find((element) => element.props["data-testid"] === "staff-row-edit");
      // The fold's children: the line (`summary`) and the controls under it.
      const body = fold ? (fold.props.children as ReactNode[]).filter((child) => !(isValidElement<Props>(child) && child.props["data-testid"] === "staff-row-toggle")) : [];
      return [row.id, elements(body)];
    }),
  );
  return { all, invite: under(all, "staff-invite-form"), rows, controls };
}

/** The values a select named `role` offers inside `tree`. */
function roleOptions(tree: ReactElement<Props>[]): string[][] {
  return tree
    .filter((element) => element.props.name === "role" && element.props.select === true)
    .map((select) => elements(select.props.children).map((option) => String(option.props.value)));
}

/** The chips on a row's line, by test id, in order. */
const chips = (tree: ReactElement<Props>[]) => tree.flatMap((element) => (typeof element.props.testId === "string" ? [element.props.testId] : []));

const superadminLine = (tree: ReactElement<Props>[]) => tree.filter((element) => element.props["data-testid"] === "staff-superadmin-row");

describe("BR-REQ-060-01 the team page, read by an Administrator (§450)", () => {
  let page: Awaited<ReturnType<typeof render>>;
  beforeEach(async () => {
    page = await render("ADMIN");
  });

  it("offers every role but the Superadministrator in the invitation", () => {
    const inviteSelects = roleOptions(page.invite);
    expect(inviteSelects).toEqual([["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"]]);
  });

  it("shows a Superadministrator's row as a line with no verb", () => {
    const row = page.rows.get("m-SUPERADMIN")!;
    const line = superadminLine(row);
    expect(line).toHaveLength(1);
    expect(line[0].props.children).toBe("Rolul și accesul unui Superadministrator le schimbă doar un Superadministrator.");
    expect(roleOptions(row)).toEqual([]);
    expect(row.some((element) => typeof element.props.action === "function")).toBe(false);
    // A line, not a fold: a fold that opens onto nothing is a control that lies (§842).
    expect(row.some((element) => element.props["data-testid"] === "staff-row-edit")).toBe(false);
    expect(chips(row)).toEqual(["staff-role"]);
  });

  it.each(STAFF_ROLES.filter((role) => role !== "SUPERADMIN"))("gives the %s row a role select without the top role, and no line", (role) => {
    const row = page.rows.get(`m-${role}`)!;
    expect(superadminLine(row)).toEqual([]);
    expect(roleOptions(row)).toEqual([["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"]]);
  });

  it("offers nothing on the reader's own row: a line with «Tu», no fold and no form", () => {
    const own = page.rows.get("reader")!;
    expect(own.some((element) => element.props["data-testid"] === "staff-row-edit")).toBe(false);
    expect(own.some((element) => typeof element.props.action === "function")).toBe(false);
    expect(chips(own)).toEqual(["staff-role", "staff-you"]);
  });

  it.each(STAFF_ROLES.filter((role) => role !== "SUPERADMIN"))("folds the %s row's controls behind its line, «Retrage accesul» last", (role) => {
    const controls = page.controls.get(`m-${role}`)!;
    const forms = controls.filter((element) => typeof element.props.action === "function").map((element) => element.props["data-testid"]);
    expect(forms[0]).toBe("staff-role-form");
    expect(forms.at(-1)).toBe("staff-revoke-form");
    // Signed in: the password reset, not the invitation again (§171); both account verbs and the revoke ask first (§256, §384).
    expect(forms).toContain("staff-password-form");
    expect(forms).not.toContain("staff-resend-form");
    for (const form of controls.filter((element) => typeof element.props.action === "function")) expect(form.props.confirm, String(form.props["data-testid"])).toBeTruthy();
    const destructive = controls.filter((element) => (element.props.confirm as { destructive?: boolean } | undefined)?.destructive).map((element) => element.props["data-testid"]);
    expect(destructive).toEqual(expect.arrayContaining(["staff-deactivate-form", "staff-revoke-form"]));
  });
});

describe("BR-REQ-060-01 the team page, read by a Superadministrator (§450)", () => {
  let page: Awaited<ReturnType<typeof render>>;
  beforeEach(async () => {
    page = await render("SUPERADMIN");
  });

  it("offers every role in the invitation", () => {
    expect(roleOptions(page.invite)).toEqual([[...STAFF_ROLES]]);
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

/**
 * BR-REQ-060-01, §687 — «Gestionează magazinul» on the rows: offered where the service would accept
 * it, drawn ticked and greyed where the role has it by rank, absent elsewhere.
 */
describe("BR-REQ-060-01 «Gestionează magazinul» on «Echipa» (§687)", () => {
  const tickForm = (row: ReactElement<Props>[]) => row.filter((element) => element.props["data-testid"] === "staff-permission-shop-form");
  const implied = (row: ReactElement<Props>[]) => row.filter((element) => element.props["data-testid"] === "staff-permission-shop-implied");
  const hidden = (row: ReactElement<Props>[], name: string) =>
    row.filter((element) => element.type === "input" && element.props.name === name).map((element) => element.props.value);

  it.each(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const)("an Administrator is offered the tick on a %s row, posting the permission and its new state", async (role) => {
    const page = await render("ADMIN");
    const row = page.rows.get(`m-${role}`)!;
    expect(tickForm(row)).toHaveLength(1);
    expect(hidden(row, "permission")).toEqual(["shop.manage"]);
    expect(hidden(row, "on")).toEqual(["1"]);
    expect(implied(row)).toEqual([]);
  });

  it("a row that holds it posts the tick off, and its line carries the chip «Magazin»", async () => {
    actor = member("reader", "ADMIN");
    const holder = { ...member("m-holder", "CONTRIBUTOR"), permissions: new Set(["shop.manage"]) } as unknown as StaffUser;
    team = [actor, holder, member("m-plain", "CONTRIBUTOR")];
    const tree = elements(await StaffPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));
    const rowOf = (id: string) => elements(tree.find((element) => element.props["data-staff-id"] === id));
    const lineOf = (id: string) => elements(rowOf(id).find((element) => element.props["data-testid"] === "staff-row-toggle"));
    expect(hidden(rowOf("m-holder"), "on")).toEqual(["0"]);
    expect(lineOf("m-holder").filter((element) => element.props.testId === "staff-permission-shop").map((element) => element.props.label)).toEqual(["Magazin"]);
    expect(lineOf("m-plain").filter((element) => element.props.testId === "staff-permission-shop")).toEqual([]);
  });

  it("an Administrator's row is drawn ticked and greyed, «inclus în rol»; a member's row has no tick", async () => {
    const page = await render("ADMIN");
    const admin = page.rows.get("m-ADMIN")!;
    expect(tickForm(admin)).toEqual([]);
    expect(implied(admin)).toHaveLength(1);
    expect(implied(admin)[0].props.disabled).toBe(true);
    const memberRow = page.rows.get("m-MEMBER")!;
    expect(tickForm(memberRow)).toEqual([]);
    expect(implied(memberRow)).toEqual([]);
  });

  it("nothing on the reader's own row or on a Superadministrator's row an Administrator reads", async () => {
    const page = await render("ADMIN");
    expect(tickForm(page.rows.get("reader")!)).toEqual([]);
    expect(implied(page.rows.get("reader")!)).toEqual([]);
    expect(tickForm(page.rows.get("m-SUPERADMIN")!)).toEqual([]);
    expect(implied(page.rows.get("m-SUPERADMIN")!)).toEqual([]);
  });

  it("a Superadministrator is offered it on the same rows, and sees the top role's row greyed", async () => {
    const page = await render("SUPERADMIN");
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) expect(tickForm(page.rows.get(`m-${role}`)!), role).toHaveLength(1);
    expect(implied(page.rows.get("m-SUPERADMIN")!)).toHaveLength(1);
    expect(tickForm(page.rows.get("m-MEMBER")!)).toEqual([]);
  });
});

/**
 * §842 — «Adaugă o persoană» and «Adaugă mai mulți membri» are folds after the list, like every «Adaugă…» of the backoffice:
 * open by themselves only while there is nobody to edit — the team is the reader alone, whose own row is always on the list.
 */
describe("§842 the add folds on «Echipa»", () => {
  const folds = (tree: ReactElement<Props>[]) =>
    ["staff-invite", "staff-members"].map((testId) => (tree.find((element) => element.props["data-testid"] === testId)!.props.openWhen as { primary: boolean }).primary);

  it("stay closed while the team has someone besides the reader", async () => {
    const page = await render("ADMIN");
    expect(folds(page.all)).toEqual([false, false]);
  });

  it("open by themselves while the reader is alone on the list", async () => {
    actor = member("reader", "ADMIN");
    team = [actor];
    const tree = elements(await StaffPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));
    expect(folds(tree)).toEqual([true, true]);
  });

  it("come after the list", async () => {
    const page = await render("ADMIN");
    const order = page.all.map((element) => element.props["data-testid"]).filter((testId) => testId === "staff-list" || testId === "staff-invite" || testId === "staff-members");
    expect(order).toEqual(["staff-list", "staff-invite", "staff-members"]);
  });
});
