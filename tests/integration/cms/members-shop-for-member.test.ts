import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { shopOrders, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Adaugă o comandă pentru un membru»: the club places an order in a member's name, through
 * the member order's own locks and stock rule (`insertOrder`, one sequence for both doors), marked
 * `placed_by = CLUB` with the acting account, audited; the member's confirmation only when asked, the
 * club's own notice never; «Marchează direct ca plătită» moves it to PAID through the one transition
 * in the same transaction. Who may press it is asserted on the server (BR-REQ-060-01), and the order
 * is a member account's record: a stranger's id is refused, never a free-text name.
 *
 * Also here: the editor's rows rendered with a euro price, and the CSV's «Adăugată de» column.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The Server Actions the two screens post to; their door (the session) is not this file's.
vi.mock("@/app/[locale]/members-area/actions", () => ({ placeShopOrderAction: async () => {}, cancelShopOrderAction: async () => {} }));
vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({
  createShopProductAction: async () => {},
  deleteShopProductAction: async () => {},
  moveShopOrderAction: async () => {},
  moveShopProductAction: async () => {},
  placeOrderForMemberAction: async () => {},
  saveShopProductAction: async () => {},
  saveShopSettingsAction: async () => {},
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { createProduct } = await import("@/modules/content/shop/service");
const { cancelOwnOrder, moveOrderByClub, placeOrder, placeOrderForMember } = await import("@/modules/content/shop/orders");
const { saveShopSettings } = await import("@/modules/content/shop/settings");
const { listOrderableItems, listOrdersForAdmin, listOrdersOfMember, listProductsForAdmin, listZoneAccountsForOrder } = await import("@/modules/content/shop/repository");
const { buildOrdersCsv } = await import("@/modules/content/shop/csv");
const { getTranslations } = await import("next-intl/server");
const { default: ShopCard } = await import("@/app/[locale]/admin/pages/members/ShopCard");
const { default: MembersShop } = await import("@/app/[locale]/members-area/MembersShop");

const NOW = new Date("2026-10-10T09:00:00.000Z");

const PRODUCT = {
  titleRo: "Tricou",
  titleEn: "T-shirt",
  descriptionRo: "",
  descriptionEn: "",
  price: "12,34 €",
  currency: "EUR",
  variants: "M: 2\nL",
  stock: "",
  visible: true,
};

const CSV_HEADER = {
  number: "Nr.",
  date: "Data",
  member: "Membru",
  email: "Email",
  placedBy: "Adăugată de",
  product: "Produs",
  variant: "Varianta",
  quantity: "Bucăți",
  unitPrice: "Preț",
  currency: "Monedă",
  total: "Total",
  status: "Starea",
  note: "Nota",
};
const CSV_WORDS = { statusWord: (status: string) => status, placedByWord: (placedBy: "MEMBER" | "CLUB") => (placedBy === "CLUB" ? "club" : "membru") };

describe("§NNN the club places an order in a member's name", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let member: StaffUser;

  /** The product's variants by label. */
  async function variantsOf(productId: string) {
    const rows = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, productId));
    return Object.fromEntries(rows.map((row) => [row.label ?? "", row]));
  }

  /** The form as the fold posts it: the member, «<productId>:<variantId>», the quantity, the note, the two ticks. */
  const forMember = (
    actor: StaffUser,
    memberId: string,
    productId: string,
    variantId: string,
    quantity: number,
    extra: { note?: string; emailMember?: boolean; markPaid?: boolean; at?: Date } = {},
  ) =>
    placeOrderForMember(db, {
      actor,
      fields: {
        memberStaffUserId: memberId,
        item: `${productId}:${variantId}`,
        quantity: String(quantity),
        note: extra.note ?? "",
        emailMember: extra.emailMember ? "on" : "",
        markPaid: extra.markPaid ? "on" : "",
      },
      now: extra.at ?? NOW,
    });

  const audits = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityType, "shop_order"))).map((row) => row.action);
  const emails = async () => (await db.select().from(emailOutbox)).map((row) => row.messageType).sort();

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.org", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizator@example.org", displayName: "Organizator", role: "MODERATOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru-a@example.org", displayName: "Membru A", role: "MEMBER", preferredLocale: "en" }).returning();
    // The club's mailbox is set: a member's own order would notify it; the club's own press never does.
    await saveShopSettings(db, { actor: admin, fields: { paymentRo: "IBAN RO00 TEST", paymentEn: "IBAN RO00 TEST", ordersTo: "comenzi@example.org" }, now: NOW });
  });

  it("takes the stock under the lock, copies the product with its currency, marks who placed it, audits, and emails nobody unless asked", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const order = await forMember(admin, member.id, product.id, variants.M.id, 2, { note: "  Din tabel  " });
    expect(order).toMatchObject({
      status: "PLACED",
      quantity: 2,
      unitPriceBani: 1234,
      currency: "EUR",
      stockTaken: true,
      note: "Din tabel",
      productTitleRo: "Tricou",
      productTitleEn: "T-shirt",
      variantLabel: "M",
      memberStaffUserId: member.id,
      memberName: "Membru A",
      // The member's language, not the colleague's screen.
      locale: "en",
      placedBy: "CLUB",
      placedByStaffUserId: admin.id,
      paidAt: null,
    });
    expect((await variantsOf(product.id)).M.stock).toBe(0);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shop.order.placed_by_club"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.metadataJson).toEqual({ orderId: order.id, memberStaffUserId: member.id, productId: product.id, variantId: variants.M.id, quantity: 2, paidAtOnce: false, emailed: false });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Membru A");
    expect(JSON.stringify(audit.metadataJson)).not.toContain("tabel");
    expect(await audits()).toEqual(["shop.order.placed_by_club"]);
    // The tick off: no confirmation to the member — and never the club's notice for the club's own press.
    expect(await emails()).toEqual([]);
  });

  it("with the tick on, the member is told «Comanda ta a fost primită» in their language; the club still is not", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const order = await forMember(admin, member.id, product.id, (await variantsOf(product.id)).L.id, 1, { emailMember: true });
    const rows = await db.select().from(emailOutbox);
    expect(rows.map((row) => [row.messageType, row.recipientEmail, row.locale])).toEqual([["SHOP_ORDER_PLACED", "membru-a@example.org", "en"]]);
    expect(rows[0].payloadJson).toEqual({ orderId: order.id });
    expect(rows[0].requestedByStaffUserId).toBe(admin.id);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shop.order.placed_by_club"));
    expect(audit.metadataJson).toMatchObject({ emailed: true });
  });

  it("«Marchează direct ca plătită» moves the order to PAID through the one transition, in the same transaction, both audit rows written", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const quiet = await forMember(admin, member.id, product.id, variants.L.id, 1, { markPaid: true });
    expect(quiet).toMatchObject({ status: "PAID", paidAt: NOW, placedBy: "CLUB" });
    expect(await audits()).toEqual(["shop.order.placed_by_club", "shop.order.paid"]);
    const [placedAudit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shop.order.placed_by_club"));
    expect(placedAudit.metadataJson).toMatchObject({ paidAtOnce: true });
    const [paidAudit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shop.order.paid"));
    expect(paidAudit.metadataJson).toMatchObject({ from: "PLACED", to: "PAID", by: "CLUB" });
    // Without the email tick, not even «Comanda ta e plătită».
    expect(await emails()).toEqual([]);

    // With both ticks: the confirmation and «plătită», both to the member, none to the club.
    const told = await forMember(admin, member.id, product.id, variants.M.id, 1, { emailMember: true, markPaid: true, note: "a doua" });
    expect(told.status).toBe("PAID");
    expect(await emails()).toEqual(["SHOP_ORDER_PAID", "SHOP_ORDER_PLACED"]);
    // A paid order is handed over next, as any paid order.
    const handed = await moveOrderByClub(db, { actor: admin, orderId: told.id, verb: "handOver", now: NOW });
    expect(handed.status).toBe("HANDED_OVER");
  });

  it("BR-REQ-060-01: an Organizer is refused on the server; a stranger's id is no member account; a sold-out variant is refused whole", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    await expect(forMember(organizer, member.id, product.id, variants.L.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(forMember(member, member.id, product.id, variants.L.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // An id that names no account: refused naming the box — an order is a member account's record.
    await expect(forMember(admin, "00000000-0000-4000-8000-000000000000", product.id, variants.L.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN", fields: ["memberStaffUserId"] });
    // A name, or a half of the choice, is not a member nor an item.
    await expect(placeOrderForMember(db, { actor: admin, fields: { memberStaffUserId: "Membru A", item: `${product.id}:${variants.L.id}`, quantity: "1" }, now: NOW })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["memberStaffUserId"],
    });
    await expect(placeOrderForMember(db, { actor: admin, fields: { memberStaffUserId: member.id, item: product.id, quantity: "1" }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["item"] });
    await expect(forMember(admin, member.id, product.id, variants.L.id, 6)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["quantity"] });
    // More than is left: refused whole, nothing taken; then the last one, then none.
    await expect(forMember(admin, member.id, product.id, variants.M.id, 3)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await variantsOf(product.id)).M.stock).toBe(2);
    await forMember(admin, member.id, product.id, variants.M.id, 2);
    await expect(forMember(admin, member.id, product.id, variants.M.id, 1, { note: "încă unul" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(shopOrders)).toHaveLength(1);
    expect(await audits()).toEqual(["shop.order.placed_by_club"]);
  });

  it("the same press twice within ten seconds is one order, paid or not; past the window it is placed again", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const first = await forMember(admin, member.id, product.id, variants.L.id, 1, { markPaid: true, emailMember: true });
    const again = await forMember(admin, member.id, product.id, variants.L.id, 1, { markPaid: true, emailMember: true, at: new Date(NOW.getTime() + 3000) });
    expect(again.id).toBe(first.id);
    expect(again.status).toBe("PAID");
    expect(await audits()).toEqual(["shop.order.placed_by_club", "shop.order.paid"]);
    expect(await emails()).toEqual(["SHOP_ORDER_PAID", "SHOP_ORDER_PLACED"]);
    // The member's own identical press, too, finds the club's order.
    const own = await placeOrder(db, { account: member, locale: "en", noticeDescribes: true, fields: { productId: product.id, variantId: variants.L.id, quantity: "1", note: "" }, now: new Date(NOW.getTime() + 5000) });
    expect(own.id).toBe(first.id);
    const later = await forMember(admin, member.id, product.id, variants.L.id, 1, { at: new Date(NOW.getTime() + 11_000) });
    expect(later.id).not.toBe(first.id);
    expect(await db.select().from(shopOrders)).toHaveLength(2);
  });

  it("a hidden product may be ordered for a member — the sheet's items need not be on sale yet — but not an archived one", async () => {
    const hidden = await createProduct(db, { actor: admin, fields: { ...PRODUCT, visible: false }, now: NOW });
    const variants = await variantsOf(hidden.id);
    const order = await forMember(admin, member.id, hidden.id, variants.L.id, 1);
    expect(order.productId).toBe(hidden.id);
    // The member's own door still refuses the hidden product.
    await expect(
      placeOrder(db, { account: member, locale: "ro", noticeDescribes: true, fields: { productId: hidden.id, variantId: variants.L.id, quantity: "1", note: "x" }, now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listOrderableItems(db)).map((item) => [item.titleRo, item.variants.map((variant) => [variant.label, variant.stock])])).toEqual([["Tricou", [["M", 2], ["L", null]]]]);
  });

  it("the member reads it in «Comenzile mele» like any order and may cancel it while PLACED; the stock goes back", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const order = await forMember(admin, member.id, product.id, variants.M.id, 2);
    const mine = await listOrdersOfMember(db, member.id);
    expect(mine.map((row) => [row.id, row.status, row.currency])).toEqual([[order.id, "PLACED", "EUR"]]);
    const html = renderToStaticMarkup(await MembersShop({ products: [], orders: mine, payment: "IBAN RO00 TEST", shopOpen: false, outcome: null, locale: "ro" }));
    expect(html).toContain("24,68 €");
    expect(html).toContain('data-testid="member-order-cancel"');
    // Nothing says "club" to the member: an order is an order.
    expect(html).not.toContain(ro.Admin.members.shop.forMember.placedByClub);
    await cancelOwnOrder(db, { account: member, orderId: order.id, now: NOW });
    expect((await variantsOf(product.id)).M.stock).toBe(2);
    const [cancelled] = await db.select().from(shopOrders).where(eq(shopOrders.id, order.id));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledBy: "MEMBER", placedBy: "CLUB" });
  });

  it("lists the member accounts by name in Romanian order, every zone account and no stranger", async () => {
    await db.insert(staffUsers).values([
      { email: "membru-s@example.org", displayName: "Ștefan Exemplu", role: "MEMBER" },
      { email: "membru-t@example.org", displayName: "Tudor Exemplu", role: "MEMBER" },
      { email: "membru-a2@example.org", displayName: "ana exemplu", role: "MEMBER" },
    ]);
    const names = (await listZoneAccountsForOrder(db)).map((account) => account.displayName);
    // Every account the club made opens the zone (§524), colleagues included; «Ș» sorts with «S», case aside.
    expect(names).toEqual(["Admin", "ana exemplu", "Membru A", "Organizator", "Ștefan Exemplu", "Tudor Exemplu"]);
  });

  it("the CSV says who placed each order, and the editor's rows show the euro prices and the club's mark", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    await forMember(admin, member.id, product.id, variants.M.id, 2);
    await placeOrder(db, { account: member, locale: "ro", noticeDescribes: true, fields: { productId: product.id, variantId: variants.L.id, quantity: "1", note: "" }, now: new Date(NOW.getTime() + 1000) });
    const rows = await listOrdersForAdmin(db, { status: null, productId: null });
    expect(rows.map((row) => row.placedBy)).toEqual(["MEMBER", "CLUB"]);
    const csv = buildOrdersCsv(CSV_HEADER, rows, { locale: "ro", withEmail: true, ...CSV_WORDS });
    const [header, newest, oldest] = csv.slice(1).split("\r\n");
    expect(header).toBe("Nr.,Data,Membru,Email,Adăugată de,Produs,Varianta,Bucăți,Preț,Monedă,Total,Starea,Nota");
    expect(newest).toContain(",Membru A,membru-a@example.org,membru,Tricou,L,1,");
    expect(oldest).toContain(",Membru A,membru-a@example.org,club,Tricou,M,2,");
    expect(oldest).toContain("12,34 €");
    expect(oldest).toContain(",EUR,");
    expect(oldest).toContain("24,68 €");

    const t = await getTranslations("Admin");
    const render = (mayManage: boolean) =>
      renderToStaticMarkup(
        ShopCard({
          products: [],
          settings: { paymentRo: null, paymentEn: null, ordersTo: null },
          orders: rows,
          ordersTotal: rows.length,
          ordersQuery: { status: null, productId: null },
          productNames: [],
          accounts: [],
          items: [],
          noticeDescribes: true,
          storage: false,
          path: "/ro/admin/pages/members",
          locale: "ro",
          words: t as never,
          cancel: "Renunță",
          messages: { fieldError: "", summary: "", fields: {} } as never,
          photoLabels: {} as unknown as TeamPhotoLabels,
          mayManage,
          showEmail: false,
        }),
      );
    const readOnly = render(false);
    expect(readOnly).toContain("24,68 €");
    expect(readOnly).toContain("12,34 €");
    expect((readOnly.match(/data-testid="order-placed-by-club"/g) ?? []).length).toBe(1);
    expect(readOnly).toContain(ro.Admin.members.shop.forMember.placedByClub);
    // The fold is the Administrator's alone.
    expect(readOnly).not.toContain('data-testid="shop-order-for-member"');
    expect(en.Admin.members.shop.forMember.title).not.toBe(ro.Admin.members.shop.forMember.title);
    expect(en.Admin.members.shop.columns.placedBy).toBe("Placed by");

    const products = renderToStaticMarkup(
      ShopCard({
        products: await listProductsForAdmin(db),
        settings: { paymentRo: null, paymentEn: null, ordersTo: null },
        orders: [],
        ordersTotal: 0,
        ordersQuery: { status: null, productId: null },
        productNames: [],
        accounts: [],
        items: [],
        noticeDescribes: true,
        storage: false,
        path: "/ro/admin/pages/members",
        locale: "ro",
        words: t as never,
        cancel: "Renunță",
        messages: { fieldError: "", summary: "", fields: {} } as never,
        photoLabels: {} as unknown as TeamPhotoLabels,
        mayManage: false,
        showEmail: false,
      }),
    );
    expect(products).toContain("12,34 €");
  });
});
