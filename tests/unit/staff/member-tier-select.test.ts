import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * §811 — «Nivel» on «Echipa» (BR-REQ-060-01): a member's row carries a select of the levels the club named, a colleague's row
 * none; «Adaugă mai mulți membri» carries one select for all the rows it adds. The page is a Server Component, so it is called
 * and its element tree walked (a native select's `<option>`s are in the tree; a closed menu would not be).
 *
 * The select offers «—» (no level) and the levels not hidden, and a hidden level only on the row of the member who holds it,
 * marked, so saving that row does not clear what the member has. Nothing is offered while the club named no level.
 */
let actor: StaffUser;
let team: StaffUser[];
let tiers: { id: string; nameRo: string; nameEn: string; descriptionRo: string | null; descriptionEn: string | null; glyph: string; hidden: boolean }[];

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
vi.mock("@/modules/content/member-tiers/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/member-tiers/repository")>()),
  listAllMemberTiers: async () => tiers,
}));
vi.mock("@/modules/staff-identity/zitadel-users", () => ({ isZitadelInviteConfigured: () => false }));
vi.mock("@/modules/diagnostics/invite-key", () => ({
  checkInviteKey: async () => ({ kind: "inapplicable" }),
  hasNoAccount: () => false,
}));
vi.mock("@/shared/feedback/confirm-words", () => ({ confirmWords: async () => ({ cancel: "Renunță" }) }));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
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
const { default: MemberTierSelect } = await import("@/modules/content/member-tiers/ui/MemberTierSelect");

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  // The one shared select (§811, §817) is a component of its own: drawn here, as the browser would, to reach its `<option>`s.
  if (node.type === MemberTierSelect) elements((MemberTierSelect as (props: Props) => ReactNode)(node.props), acc);
  else elements(node.props.children, acc);
  return acc;
}

function person(id: string, role: StaffRole, memberTierId: string | null = null): StaffUser {
  return {
    id,
    email: `${id}@dev.test`,
    displayName: id,
    role,
    memberTierId,
    firstSignedInAt: new Date("2026-09-01T10:00:00.000Z"),
  } as unknown as StaffUser;
}

const tier = (id: string, nameRo: string, nameEn: string, hidden = false, glyph = "star") => ({ id, nameRo, nameEn, descriptionRo: null, descriptionEn: null, glyph, hidden });

async function render() {
  actor = person("reader", "ADMIN");
  team = [actor, person("m-plain", "MEMBER"), person("m-held", "MEMBER", "t-old"), person("c-volunteer", "CONTRIBUTOR"), person("c-admin", "ADMIN")];
  const tree = await StaffPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) });
  const all = elements(tree);
  const table = all.find((element) => typeof element.props.rowActions === "function")!;
  const rowActions = table.props.rowActions as (row: StaffUser) => ReactNode;
  const columns = table.props.columns as { key: string; render: (row: StaffUser) => ReactNode }[];
  return {
    all,
    row: (id: string) => elements(rowActions(team.find((candidate) => candidate.id === id)!)),
    cell: (key: string, id: string) => elements(columns.find((column) => column.key === key)!.render(team.find((candidate) => candidate.id === id)!)),
  };
}

/** The `<option>`s of the native select named `tierId`, as [value, label]. */
const options = (tree: ReactElement<Props>[]) =>
  tree
    .filter((element) => element.props.name === "tierId" && element.props.select === true)
    .map((select) => elements(select.props.children).filter((child) => child.type === "option").map((option) => [String(option.props.value), String(option.props.children)]));

describe("§811 «Nivel» on the team page", () => {
  beforeEach(() => {
    tiers = [tier("t-new", "Membru", "Member"), tier("t-old", "Fondator", "Founder", true, "trophy"), tier("t-sup", "Sprijinitor", "Supporter", false, "heart")];
  });

  it("offers a member's row the levels not hidden and «—», and the hidden level they hold, marked", async () => {
    const page = await render();
    expect(options(page.row("m-plain"))).toEqual([[["", "—"], ["t-new", "Membru"], ["t-sup", "Sprijinitor"]]]);
    expect(options(page.row("m-held"))).toEqual([[["", "—"], ["t-new", "Membru"], ["t-old", "Fondator (ascuns)"], ["t-sup", "Sprijinitor"]]]);
  });

  it("selects the level the member holds, and nothing for a member with none", async () => {
    const page = await render();
    const select = (id: string) => page.row(id).find((element) => element.props.name === "tierId" && element.props.select === true)!;
    expect(select("m-plain").props.defaultValue).toBe("");
    expect(select("m-held").props.defaultValue).toBe("t-old");
  });

  it("posts the row's id and the interface language, to the action that asks first", async () => {
    const page = await render();
    const form = page.row("m-held").find((element) => element.props["data-testid"] === "staff-member-tier-form")!;
    expect(typeof form.props.action).toBe("function");
    expect((form.props.confirm as { title: string }).title).toBe("Schimbi nivelul?");
    const hidden = elements(form.props.children).filter((element) => element.type === "input");
    expect(hidden.map((element) => [element.props.name, element.props.value])).toEqual([["uiLocale", "ro"], ["staffUserId", "m-held"]]);
  });

  it("offers a colleague's row no level — a colleague is no member — and not the reader's own", async () => {
    const page = await render();
    expect(options(page.row("c-volunteer"))).toEqual([]);
    expect(options(page.row("c-admin"))).toEqual([]);
    expect(options(page.row("reader"))).toEqual([]);
  });

  it("names a member's level in the role column — glyph and name, hidden or not — and a colleague's none", async () => {
    const page = await render();
    const badge = (id: string) => page.cell("role", id).filter((element) => element.props.testId === "staff-member-tier");
    expect(badge("m-plain")).toEqual([]);
    expect(badge("c-volunteer")).toEqual([]);
    const held = badge("m-held");
    expect(held).toHaveLength(1);
    expect((held[0].props.tier as { name: string; glyph: string })).toMatchObject({ name: "Fondator", glyph: "trophy" });
  });

  it("gives «Adaugă mai mulți membri» one select of the levels not hidden, with «—» first and none chosen", async () => {
    const page = await render();
    const bulk = page.all.filter((element) => element.props.name === "tierId" && element.props["data-testid"] === "staff-members-tier");
    expect(bulk).toHaveLength(1);
    expect(bulk[0].props.defaultValue).toBe("");
    expect(elements(bulk[0].props.children).filter((child) => child.type === "option").map((option) => [option.props.value, option.props.children])).toEqual([
      ["", "—"],
      ["t-new", "Membru"],
      ["t-sup", "Sprijinitor"],
    ]);
  });

  it("offers nothing while the club named no level", async () => {
    tiers = [];
    const page = await render();
    expect(options(page.all)).toEqual([]);
    expect(options(page.row("m-plain"))).toEqual([]);
    expect(page.row("m-plain").some((element) => element.props["data-testid"] === "staff-member-tier-form")).toBe(false);
  });

  it("offers the bulk select no level at all while every one is hidden, but still names the held one on its row", async () => {
    tiers = [tier("t-old", "Fondator", "Founder", true)];
    const page = await render();
    expect(page.all.filter((element) => element.props["data-testid"] === "staff-members-tier")).toEqual([]);
    expect(options(page.row("m-held"))).toEqual([[["", "—"], ["t-old", "Fondator (ascuns)"]]]);
  });
});
