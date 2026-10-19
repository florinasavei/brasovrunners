import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "@/db/schema/staff-users";
import { STAFF_ROLES, canManageStaff, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * §811, §817 — «Nivel» in «Adaugă o persoană» (BR-REQ-060-01): under the role, a select of the levels the club still gives,
 * drawn while the role is «Membru» and only for the Administrator who reads the team page. It is the one select the member
 * rows and «Adaugă mai mulți membri» draw (`MemberTierSelect`), never a third copy. The page is a Server Component, so it is
 * called and its element tree walked.
 */
let actor: StaffUser;
let locale: "ro" | "en";
let tiers: { id: string; nameRo: string; nameEn: string; descriptionRo: string | null; descriptionEn: string | null; glyph: string; hidden: boolean }[];

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/admin/staff" }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/shared/config/env", () => ({ env: { STAFF_AUTH_MODE: "dev-switcher" } }));
vi.mock("@/modules/staff-identity/session", () => ({ requireStaff: async () => actor }));
vi.mock("@/modules/staff-identity/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/staff-identity/service")>()),
  listStaff: async () => [actor, member("m-1", "MEMBER", null)],
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
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async (boxes: Record<string, string>) => boxes }));
vi.mock("@/modules/notifications/delivery-evidence", () => ({ refusedInvitations: async () => new Map() }));
vi.mock("@/app/[locale]/admin/actions", () => ({
  changeStaffRoleAction: vi.fn(),
  inviteMembersAction: vi.fn(),
  inviteStaffAction: vi.fn(),
  resendStaffInviteAction: vi.fn(),
  revokeStaffAction: vi.fn(),
  sendStaffPasswordResetAction: vi.fn(),
  setMemberTierAction: vi.fn(),
  setStaffAccountActiveAction: vi.fn(),
  setStaffPermissionAction: vi.fn(),
}));

const { default: StaffPage } = await import("@/app/[locale]/admin/staff/page");
const { default: MemberTierSelect } = await import("@/modules/content/member-tiers/ui/MemberTierSelect");
const { default: OnlyForType } = await import("@/modules/content/events/ui/OnlyForType");

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`; with `expand`, the shared select is drawn too, as the browser would, to reach its `<option>`s. */
function elements(node: ReactNode, expand: boolean, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, expand, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  if (expand && node.type === MemberTierSelect) elements((MemberTierSelect as (props: Props) => ReactNode)(node.props), expand, acc);
  else elements(node.props.children, expand, acc);
  return acc;
}

function member(id: string, role: StaffRole, memberTierId: string | null): StaffUser {
  return {
    id,
    email: `${id}@dev.test`,
    displayName: id,
    role,
    memberTierId,
    firstSignedInAt: new Date("2026-09-01T10:00:00.000Z"),
  } as unknown as StaffUser;
}

const tier = (id: string, nameRo: string, nameEn: string, hidden = false) => ({ id, nameRo, nameEn, descriptionRo: null, descriptionEn: null, glyph: "star", hidden });

async function render(reader: StaffRole, language: "ro" | "en" = "ro") {
  actor = member("reader", reader, null);
  locale = language;
  const tree = await StaffPage({ params: Promise.resolve({ locale: language }), searchParams: Promise.resolve({}) });
  return { plain: elements(tree, false), all: elements(tree, true) };
}

/** The «Adaugă o persoană» form's subtree. */
const inviteForm = (tree: ReactElement<Props>[]) => elements(tree.find((element) => element.props["data-testid"] === "staff-invite-form")!, true);

const optionsOf = (select: ReactElement<Props>) =>
  elements(select.props.children, true)
    .filter((child) => child.type === "option")
    .map((option) => [String(option.props.value), String(option.props.children)]);

describe("§817 «Nivel» in «Adaugă o persoană»", () => {
  beforeEach(() => {
    tiers = [tier("t-new", "Membru", "Member"), tier("t-old", "Fondator", "Founder", true), tier("t-sup", "Sprijinitor", "Supporter")];
  });

  it("draws the select under «Rol», with «—» first and the levels not hidden, none chosen", async () => {
    const form = inviteForm((await render("ADMIN")).all);
    const selects = form.filter((element) => element.props.name === "tierId" && element.props.select === true);
    expect(selects).toHaveLength(1);
    expect(selects[0].props.label).toBe("Nivel");
    expect(selects[0].props.defaultValue).toBe("");
    expect(selects[0].props["data-testid"]).toBe("staff-invite-tier");
    expect(optionsOf(selects[0])).toEqual([["", "—"], ["t-new", "Membru"], ["t-sup", "Sprijinitor"]]);
    // Under the role, before the language and the button.
    const names = form.filter((element) => element.props.select === true).map((element) => element.props.name);
    expect(names).toEqual(["role", "tierId", "preferredLocale"]);
  });

  it("shows it only while the role is «Membru»: hidden, never removed, over the role select the box already has", async () => {
    const { plain } = await render("ADMIN");
    const form = elements(plain.find((element) => element.props["data-testid"] === "staff-invite-form")!, false);
    const gate = form.find((element) => element.type === OnlyForType)!;
    expect(gate.props).toMatchObject({ type: "MEMBER", selectName: "role", initialType: "CONTRIBUTOR" });
    expect(elements(gate.props.children, false).some((element) => element.type === MemberTierSelect)).toBe(true);
    const role = form.find((element) => element.props.name === "role" && element.props.select === true)!;
    expect(role.props.defaultValue).toBe("CONTRIBUTOR");
    // «Membru» is a role this reader may give.
    expect(elements(role.props.children, false).map((option) => option.props.value)).toContain("MEMBER");
  });

  it("names the box in a refusal, with the words of the page's language", async () => {
    const page = await render("ADMIN");
    const formElement = page.plain.find((element) => element.props["data-testid"] === "staff-invite-form")!;
    expect((formElement.props.messages as Record<string, string>).tierId).toBe("Nivel");
  });

  it("speaks English with the English names of the levels", async () => {
    const form = inviteForm((await render("ADMIN", "en")).all);
    const select = form.find((element) => element.props.name === "tierId" && element.props.select === true)!;
    expect(select.props.label).toBe("Level");
    expect(optionsOf(select)).toEqual([["", "—"], ["t-new", "Member"], ["t-sup", "Supporter"]]);
    expect(String(select.props.helperText)).toMatch(/not shown to them/);
  });

  it("is drawn for a Superadministrator too, and for no one else: the team page is the Administrator's, a 404 to every other role", async () => {
    const superadmin = inviteForm((await render("SUPERADMIN")).all);
    expect(superadmin.some((element) => element.props.name === "tierId")).toBe(true);
    for (const role of STAFF_ROLES.filter((candidate) => !canManageStaff(candidate))) {
      await expect(render(role)).rejects.toThrow("NOT_FOUND");
    }
  });

  it("is not drawn while the club named no level, or every level is hidden", async () => {
    tiers = [];
    expect(inviteForm((await render("ADMIN")).all).some((element) => element.props.name === "tierId")).toBe(false);
    tiers = [tier("t-old", "Fondator", "Founder", true)];
    expect(inviteForm((await render("ADMIN")).all).some((element) => element.props.name === "tierId")).toBe(false);
  });

  it("is the one shared select: the single add, «Adaugă mai mulți membri» and a member's row draw MemberTierSelect, and nothing draws a level box of its own", async () => {
    const { plain, all } = await render("ADMIN");
    // The page itself draws the shared component three times, and no box named tierId except through it.
    expect(plain.filter((element) => element.type === MemberTierSelect)).toHaveLength(2);
    const table = plain.find((element) => typeof element.props.rowActions === "function")!;
    const row = elements((table.props.rowActions as (row: StaffUser) => ReactNode)(member("m-1", "MEMBER", null)), false);
    expect(row.filter((element) => element.type === MemberTierSelect)).toHaveLength(1);
    expect(plain.filter((element) => element.props.name === "tierId")).toEqual([]);
    expect(all.filter((element) => element.props.name === "tierId" && element.props.select === true)).toHaveLength(2);
    const drawn = plain.filter((element) => element.type === MemberTierSelect).map((element) => element.props["data-testid"]);
    expect(drawn).toEqual(["staff-invite-tier", "staff-members-tier"]);
  });

  it("keeps the two forms' boxes apart: «Adaugă mai mulți membri» has a scope of its own, so «Nivel» links to the right one", async () => {
    const { plain } = await render("ADMIN");
    const bulk = plain.find((element) => element.props["data-testid"] === "staff-members-form")!;
    expect(bulk.props.scope).toBe("members");
    const single = plain.find((element) => element.props["data-testid"] === "staff-invite-form")!;
    expect(single.props.scope).toBeUndefined();
  });
});
