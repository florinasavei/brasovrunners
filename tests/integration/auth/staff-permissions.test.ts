import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { shopProductVariants } from "@/db/schema/shop";
import { staffUserPermissions } from "@/db/schema/staff-user-permissions";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §NNN — permissions per person on top of the role ladder: «Gestionează magazinul».
 *
 * Proven on real PostgreSQL (PGlite), through the real session (`session.ts`, the development
 * switcher's cookie): a grant is a row and an audit row, and the next request's session carries it;
 * a withdrawn grant is gone at the next read; the service refuses a member's row, an
 * Administrator's, a Superadministrator's for an Administrator, the actor's own, and every actor
 * below the Administrator; a role a grant may not stay with takes it away in the same transaction,
 * audited `role_change`. Then the shop's doors: a volunteer holding it writes the catalogue, the
 * settings and an order's status, and the same volunteer without it is refused `FORBIDDEN` — at
 * the service and at the door. The orders CSV gives the holder the file without the address column,
 * and the gallery list behind the product photo's «Din galerie» answers the holder alone;
 * «Magazin»'s gate answers 404 without the grant; «Membri» no longer carries the shop.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => {
  /** A namespace by its dotted path — `Admin`, `Admin.richText` — or the object form a route handler passes. */
  const translator = (namespace: string | { namespace: string }) => {
    const path = typeof namespace === "string" ? namespace : namespace.namespace;
    const messages = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], ro) as Record<string, string>;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  };
  return { setRequestLocale: () => {}, getLocale: async () => "ro", getMessages: async () => ro, getTranslations: async (namespace: string | { namespace: string }) => translator(namespace) };
});

const { getCurrentStaffUser, requireStaffCapability } = await import("@/modules/staff-identity/session");
const { canManageShop, canReadShop } = await import("@/modules/staff-identity/domain/roles");
const { changeStaffRole, listStaff, setStaffPermission } = await import("@/modules/staff-identity/service");
const { createProduct } = await import("@/modules/content/shop/service");
const { moveOrderByClub, placeOrder } = await import("@/modules/content/shop/orders");
const { saveShopSettings } = await import("@/modules/content/shop/settings");
const { GET: exportOrders } = await import("@/app/api/admin/shop/orders/route");
const { GET: listGallery } = await import("@/app/api/admin/media/route");
const { default: ShopSectionLayout } = await import("@/app/[locale]/admin/shop/layout");
const { default: AdminMembersPage } = await import("@/app/[locale]/admin/pages/members/page");
const { default: ShopCard } = await import("@/app/[locale]/admin/pages/members/ShopCard");

const NOW = new Date("2026-10-10T09:00:00.000Z");
const PRODUCT = { titleRo: "Tricou exemplu", titleEn: "Sample t-shirt", descriptionRo: "", descriptionEn: "", price: "45", variants: "", stock: "", visible: true };

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element under `node`, depth first, through children — the tree a Server Component returned. */
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

/** The HTTP status a `notFound()` carries, or null when nothing was thrown. */
async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return Number(digest.split(";")[1]);
    throw error;
  }
}

describe("§NNN «Gestionează magazinul» — a permission per person", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let superadmin: StaffUser;
  let admin: StaffUser;
  let organizer: StaffUser;
  let volunteer: StaffUser;
  let member: StaffUser;

  const grantsOf = async (id: string) =>
    (await db.select().from(staffUserPermissions).where(eq(staffUserPermissions.staffUserId, id))).map((row) => row.permission);
  const auditsOf = async (id: string) =>
    (await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "staff_user"), eq(auditLogs.entityId, id)))).map((row) => ({
      action: row.action,
      metadata: row.metadataJson,
    }));

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [superadmin] = await db.insert(staffUsers).values({ email: "super@dev.test", displayName: "Super", role: "SUPERADMIN" }).returning();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizator@dev.test", displayName: "Organizator", role: "MODERATOR" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@dev.test", displayName: "Voluntar", role: "CONTRIBUTOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru@dev.test", displayName: "Membru Exemplu", role: "MEMBER" }).returning();
  });

  it("a grant is a row and an audit row, and the next request's session carries it", async () => {
    state.cookie = volunteer.id;
    await expect(requireStaffCapability(canManageShop)).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW })).toEqual({ changed: true });
    expect(await grantsOf(volunteer.id)).toEqual(["shop.manage"]);
    const [row] = await db.select().from(staffUserPermissions);
    expect(row.grantedByStaffUserId).toBe(admin.id);
    expect(await auditsOf(volunteer.id)).toEqual([{ action: "staff.permission.granted", metadata: { staffUserId: volunteer.id, permission: "shop.manage" } }]);

    const session = await getCurrentStaffUser();
    expect([...(session?.permissions ?? [])]).toEqual(["shop.manage"]);
    expect((await requireStaffCapability(canManageShop)).id).toBe(volunteer.id);
    expect((await requireStaffCapability(canReadShop)).id).toBe(volunteer.id);
    // «Echipa» reads the same grant on the row.
    expect([...((await listStaff(db, admin)).find((one) => one.id === volunteer.id)?.permissions ?? [])]).toEqual(["shop.manage"]);
  });

  it("granting twice is one row and one audit; revoking stops it at the next request, audited `tick`; revoking again does nothing", async () => {
    await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
    expect(await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW })).toEqual({ changed: false });
    expect(await grantsOf(volunteer.id)).toHaveLength(1);

    state.cookie = volunteer.id;
    expect((await requireStaffCapability(canManageShop)).id).toBe(volunteer.id);
    expect(await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: false, now: NOW })).toEqual({ changed: true });
    await expect(requireStaffCapability(canManageShop)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: false, now: NOW })).toEqual({ changed: false });

    expect((await auditsOf(volunteer.id)).map((entry) => [entry.action, (entry.metadata as { reason?: string }).reason])).toEqual([
      ["staff.permission.granted", undefined],
      ["staff.permission.revoked", "tick"],
    ]);
  });

  it("refuses a member's row, an Administrator's, the actor's own and — for an Administrator — a Superadministrator's", async () => {
    await expect(setStaffPermission(db, admin, { targetId: member.id, permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [other] = await db.insert(staffUsers).values({ email: "admin2@dev.test", displayName: "Admin 2", role: "ADMIN" }).returning();
    await expect(setStaffPermission(db, admin, { targetId: other.id, permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setStaffPermission(db, admin, { targetId: admin.id, permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("own") });
    await expect(setStaffPermission(db, admin, { targetId: superadmin.id, permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setStaffPermission(db, admin, { targetId: "00000000-0000-4000-8000-000000000000", permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(staffUserPermissions)).toEqual([]);
    // A Superadministrator grants on the rows below the Administrator, as the Administrator does.
    expect(await setStaffPermission(db, superadmin, { targetId: organizer.id, permission: "shop.manage", on: true, now: NOW })).toEqual({ changed: true });
  });

  it("refuses every actor below the Administrator, the volunteer holding the grant included", async () => {
    await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
    const holder = { ...volunteer, permissions: new Set(["shop.manage"] as const) };
    for (const actor of [organizer, holder, member]) {
      await expect(setStaffPermission(db, actor, { targetId: organizer.id, permission: "shop.manage", on: true, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("a role that may not hold it takes it away in the same change, audited `role_change` — a member's and an Administrator's", async () => {
    await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
    await changeStaffRole(db, admin, volunteer.id, "MEMBER");
    expect(await grantsOf(volunteer.id)).toEqual([]);
    expect((await auditsOf(volunteer.id)).at(-1)).toEqual({
      action: "staff.permission.revoked",
      metadata: { staffUserId: volunteer.id, permission: "shop.manage", reason: "role_change" },
    });

    await setStaffPermission(db, admin, { targetId: organizer.id, permission: "shop.manage", on: true, now: NOW });
    await changeStaffRole(db, admin, organizer.id, "COPYWRITER");
    expect(await grantsOf(organizer.id)).toEqual(["shop.manage"]);
    await changeStaffRole(db, admin, organizer.id, "ADMIN");
    expect(await grantsOf(organizer.id)).toEqual([]);
    // A change with nothing to take away audits nothing about permissions.
    const before = (await auditsOf(organizer.id)).length;
    await changeStaffRole(db, admin, organizer.id, "MODERATOR");
    expect(await auditsOf(organizer.id)).toHaveLength(before);
  });

  it("a member with a stale grant row is no staff and gets nothing (§524)", async () => {
    await db.insert(staffUserPermissions).values({ staffUserId: member.id, permission: "shop.manage", grantedByStaffUserId: admin.id });
    state.cookie = member.id;
    expect(await getCurrentStaffUser()).toBeNull();
    await expect(requireStaffCapability(canReadShop)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("the database refuses a permission the code does not know", async () => {
    await expect(db.insert(staffUserPermissions).values({ staffUserId: volunteer.id, permission: "shop.everything" })).rejects.toThrow();
  });

  describe("the shop's doors read the grant", () => {
    async function placedOrder(): Promise<string> {
      const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
      const [variant] = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, product.id));
      const placed = await placeOrder(db, {
        account: member,
        locale: "ro",
        noticeDescribes: true,
        fields: { productId: product.id, variantId: variant.id, quantity: "1", note: "" },
        now: NOW,
      });
      return placed.id;
    }

    it("a volunteer holding it writes the catalogue, the settings and an order; without it, FORBIDDEN on the server", async () => {
      const orderId = await placedOrder();
      const plain = { ...volunteer, permissions: new Set<"shop.manage">() };
      await expect(createProduct(db, { actor: plain, fields: PRODUCT, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveShopSettings(db, { actor: plain, fields: { paymentRo: "", paymentEn: "", ordersTo: "" }, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(moveOrderByClub(db, { actor: plain, orderId, verb: "pay", now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });

      await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
      state.cookie = volunteer.id;
      // The actor the session hands out, as the actions pass it.
      const holder = await requireStaffCapability(canManageShop);
      expect((await createProduct(db, { actor: holder, fields: { ...PRODUCT, titleRo: "Buff", titleEn: "Buff" }, now: NOW })).id).toBeTruthy();
      await expect(saveShopSettings(db, { actor: holder, fields: { paymentRo: "Numerar", paymentEn: "Cash", ordersTo: "" }, now: NOW })).resolves.toMatchObject({ paymentRo: "Numerar" });
      expect((await moveOrderByClub(db, { actor: holder, orderId, verb: "pay", now: NOW })).status).toBe("PAID");
    });

    it("the orders CSV: the holder gets the file without the address column; the volunteer without the grant 403", async () => {
      await placedOrder();
      state.cookie = volunteer.id;
      expect((await exportOrders(new Request("http://localhost/api/admin/shop/orders?lang=ro"))).status).toBe(403);

      await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
      const response = await exportOrders(new Request("http://localhost/api/admin/shop/orders?lang=ro"));
      expect(response.status).toBe(200);
      const csv = await response.text();
      const header = csv.replace(/^﻿/, "").split(/\r?\n/)[0];
      expect(header).toContain(ro.Admin.members.shop.columns.member);
      expect(header).not.toContain(ro.Admin.members.shop.columns.email);
      expect(csv).toContain("Membru Exemplu");
      expect(csv).not.toContain(member.email);

      // The Organizer, who reads addresses by role, still has the column: the grant changed nobody else's file.
      state.cookie = organizer.id;
      const organizers = (await (await exportOrders(new Request("http://localhost/api/admin/shop/orders?lang=ro"))).text()).replace(/^﻿/, "");
      expect(organizers.split(/\r?\n/)[0]).toContain(ro.Admin.members.shop.columns.email);
    });

    it("«Din galerie» in the product photo field: the holder lists the gallery; the volunteer without the grant 403", async () => {
      state.cookie = volunteer.id;
      expect((await listGallery(new Request("http://localhost/api/admin/media"))).status).toBe(403);

      await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
      const response = await listGallery(new Request("http://localhost/api/admin/media"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ assets: expect.any(Array) });

      // Withdrawn, the list is closed again at the next request.
      await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: false, now: NOW });
      expect((await listGallery(new Request("http://localhost/api/admin/media"))).status).toBe(403);
    });

    it("«Magazin»'s gate: 404 for a volunteer without the grant, the section for one with it", async () => {
      state.cookie = volunteer.id;
      expect(await statusOf(ShopSectionLayout({ children: "shop" }))).toBe(404);
      await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
      expect(await statusOf(ShopSectionLayout({ children: "shop" }))).toBeNull();
      state.cookie = organizer.id;
      expect(await statusOf(ShopSectionLayout({ children: "shop" }))).toBeNull();
    });

    it("«Pagini» → «Membri» carries no shop card: one line to «Magazin» for a reader of the shop, none for the Redactor", async () => {
      state.cookie = organizer.id;
      const organizers = elements(await AdminMembersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));
      expect(organizers.some((element) => element.type === ShopCard)).toBe(false);
      expect(organizers.filter((element) => element.props["data-testid"] === "members-shop-moved")).toHaveLength(1);

      const [copywriter] = await db.insert(staffUsers).values({ email: "redactor@dev.test", displayName: "Redactor", role: "COPYWRITER" }).returning();
      state.cookie = copywriter.id;
      const copywriters = elements(await AdminMembersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));
      expect(copywriters.some((element) => element.type === ShopCard)).toBe(false);
      expect(copywriters.filter((element) => element.props["data-testid"] === "members-shop-moved")).toEqual([]);
    });
  });
});
