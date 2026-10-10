import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { shopOrders, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the members' shop: the catalogue kept by an Administrator on «Pagini» → «Membri» →
 * «Magazin», orders from the members' zone behind the member's own account, payment outside the site.
 *
 * Proven on real PostgreSQL (PGlite): an order with and without a stock, an order larger than the
 * stock refused whole, a cancellation giving the stock back exactly once, the status moves and who may
 * make them — a member, an Organizer, a Tehnic and a volunteer refused on the server, whatever the
 * screen offered (BR-REQ-060-01) — the notice gate, the emails queued in the order's transaction and
 * what they say, the archive in place of a delete, the CSV's address column by role, and the zone's
 * section as a member reads it. Two orders racing for the last unit are `tests/concurrency/shop-stock.test.ts`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The zone's two Server Actions are posted by the forms; their door (the session) is not this file's.
vi.mock("@/app/[locale]/members-area/actions", () => ({ placeShopOrderAction: async () => {}, cancelShopOrderAction: async () => {} }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { createProduct, deleteProduct, moveProduct, saveProduct } = await import("@/modules/content/shop/service");
const { cancelOwnOrder, moveOrderByClub, placeOrder } = await import("@/modules/content/shop/orders");
const { readShopSettings, saveShopSettings } = await import("@/modules/content/shop/settings");
const { countOrdersForAdmin, countVisibleProducts, listOrdersForAdmin, listOrdersOfMember, listProductsForAdmin, listProductsForMembers } = await import(
  "@/modules/content/shop/repository"
);
const { buildOrdersCsv } = await import("@/modules/content/shop/csv");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { default: MembersShop } = await import("@/app/[locale]/members-area/MembersShop");

const NOW = new Date("2026-10-10T09:00:00.000Z");

const PRODUCT = {
  titleRo: "Tricou exemplu",
  titleEn: "Sample t-shirt",
  descriptionRo: "Bumbac.",
  descriptionEn: "Cotton.",
  price: "45",
  variants: "M: 2\nL",
  stock: "",
  visible: true,
};

describe("§NNN the members' shop", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let tehnic: StaffUser;
  let volunteer: StaffUser;
  let member: StaffUser;
  let other: StaffUser;
  let version = 1;

  async function approveNotice(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }) {
    const translations = [
      { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
      { locale: "en" as const, title: "Privacy notice", body: bodies.en },
    ];
    const current = version++;
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: current,
      effectiveAt: new Date(NOW.getTime() - 3_600_000 + current * 60_000),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }
  const strip = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split("{{membersShop}}").join("magazinul")) as LegalDocumentBody;

  /** The product's variants by label, as the order form posts them. */
  async function variantsOf(productId: string) {
    const rows = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, productId));
    return Object.fromEntries(rows.map((row) => [row.label ?? "", row]));
  }

  const order = (account: StaffUser, productId: string, variantId: string, quantity: number, extra: { note?: string; open?: boolean } = {}) =>
    placeOrder(db, {
      account,
      locale: "ro",
      noticeDescribes: extra.open ?? true,
      fields: { productId, variantId, quantity: String(quantity), note: extra.note ?? "" },
      now: NOW,
    });

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    version = 1;
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.org", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizator@example.org", displayName: "Organizator", role: "MODERATOR" }).returning();
    [tehnic] = await db.insert(staffUsers).values({ email: "tehnic@example.org", displayName: "Tehnic", role: "DEV" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@example.org", displayName: "Voluntar", role: "CONTRIBUTOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru@example.org", displayName: "Ana Exemplu", role: "MEMBER" }).returning();
    [other] = await db.insert(staffUsers).values({ email: "altul@example.org", displayName: "Ion Exemplu", role: "MEMBER" }).returning();
  });

  it("an Administrator adds, writes, moves and deletes a product, each with an audit row naming no title", async () => {
    const first = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const second = await createProduct(db, { actor: admin, fields: { ...PRODUCT, titleRo: "Buff", titleEn: "Buff", variants: "", stock: "" }, now: NOW });
    expect([first.position, second.position]).toEqual([1, 2]);
    expect(first.priceBani).toBe(4500);
    const saved = await saveProduct(db, { actor: admin, productId: first.id, expectedVersion: first.version, fields: { ...PRODUCT, price: "49,90" }, now: NOW });
    expect(saved.priceBani).toBe(4990);
    await expect(saveProduct(db, { actor: admin, productId: first.id, expectedVersion: first.version, fields: PRODUCT, now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });
    await moveProduct(db, { actor: admin, productId: second.id, direction: "up", now: NOW });
    expect((await listProductsForAdmin(db)).map((product) => product.titleRo)).toEqual(["Buff", "Tricou exemplu"]);
    expect(await deleteProduct(db, { actor: admin, productId: second.id, now: NOW })).toBe("deleted");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "shop_product"));
    expect(audit.map((row) => row.action).sort()).toEqual(["shop.product.created", "shop.product.created", "shop.product.deleted", "shop.product.moved", "shop.product.saved"].sort());
    expect(JSON.stringify(audit.map((row) => row.metadataJson))).not.toContain("Tricou");
  });

  it("refuses one-sided descriptions, a bad price and a bad variant list, naming the box", async () => {
    await expect(createProduct(db, { actor: admin, fields: { ...PRODUCT, descriptionEn: "" }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["descriptionEn"] });
    await expect(createProduct(db, { actor: admin, fields: { ...PRODUCT, price: "patruzeci" }, now: NOW })).rejects.toMatchObject({ fields: ["price"] });
    await expect(createProduct(db, { actor: admin, fields: { ...PRODUCT, variants: "M\nM" }, now: NOW })).rejects.toMatchObject({ fields: ["variants"] });
    await expect(createProduct(db, { actor: admin, fields: { ...PRODUCT, titleEn: "" }, now: NOW })).rejects.toMatchObject({ fields: ["titleEn"] });
  });

  it("BR-REQ-060-01: the Organizer, the Tehnic, a volunteer and a member write nothing — on the server", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    for (const actor of [organizer, tehnic, volunteer, member]) {
      await expect(createProduct(db, { actor, fields: PRODUCT, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveProduct(db, { actor, productId: product.id, expectedVersion: 1, fields: PRODUCT, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteProduct(db, { actor, productId: product.id, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveShopSettings(db, { actor, fields: { paymentRo: "", paymentEn: "", ordersTo: "" }, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const variants = await variantsOf(product.id);
    const placed = await order(member, product.id, variants.L.id, 1);
    for (const actor of [organizer, tehnic, volunteer, member]) {
      await expect(moveOrderByClub(db, { actor, orderId: placed.id, verb: "pay", now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Another member cannot cancel it: to them it is no such order.
    await expect(cancelOwnOrder(db, { account: other, orderId: placed.id, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an order takes the stock under the lock, refuses more than is left whole, and a cancellation gives it back once", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    expect(variants.M.stock).toBe(2);
    expect(variants.L.stock).toBeNull();

    // More than is left: refused whole, nothing taken.
    await expect(order(member, product.id, variants.M.id, 3)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await variantsOf(product.id)).M.stock).toBe(2);

    const first = await order(member, product.id, variants.M.id, 2, { note: "  Pentru sâmbătă  " });
    expect(first).toMatchObject({ status: "PLACED", quantity: 2, unitPriceBani: 4500, stockTaken: true, note: "Pentru sâmbătă", productTitleRo: "Tricou exemplu", variantLabel: "M", memberName: "Ana Exemplu" });
    expect((await variantsOf(product.id)).M.stock).toBe(0);
    // The last one is gone: the next order is refused, never oversold.
    await expect(order(other, product.id, variants.M.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    // An unlimited variant takes nothing.
    const unlimited = await order(other, product.id, variants.L.id, 5);
    expect(unlimited.stockTaken).toBe(false);

    // The members' read says sold out, never a number.
    const [shown] = await listProductsForMembers(db, "en");
    expect(shown.title).toBe("Sample t-shirt");
    expect(shown.variants).toEqual([
      { id: variants.M.id, label: "M", soldOut: true },
      { id: variants.L.id, label: "L", soldOut: false },
    ]);

    await cancelOwnOrder(db, { account: member, orderId: first.id, now: NOW });
    expect((await variantsOf(product.id)).M.stock).toBe(2);
    // Twice is refused, and gives nothing back twice.
    await expect(cancelOwnOrder(db, { account: member, orderId: first.id, now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveOrderByClub(db, { actor: admin, orderId: first.id, verb: "cancel", now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await variantsOf(product.id)).M.stock).toBe(2);
    const [cancelled] = await db.select().from(shopOrders).where(eq(shopOrders.id, first.id));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledBy: "MEMBER", cancelledByStaffUserId: member.id, stockTaken: false });
  });

  it("the same press twice within ten seconds is one order: nothing taken, audited or sent again", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const at = (seconds: number, note = "Pentru sâmbătă", account = member) =>
      placeOrder(db, {
        account,
        locale: "ro",
        noticeDescribes: true,
        fields: { productId: product.id, variantId: variants.M.id, quantity: "1", note },
        now: new Date(NOW.getTime() + seconds * 1000),
      });
    const first = await at(0);
    // A double tap, three seconds on: the order already placed is the answer.
    const repeat = await at(3);
    expect(repeat.id).toBe(first.id);
    expect((await variantsOf(product.id)).M.stock).toBe(1);
    expect(await db.select().from(shopOrders)).toHaveLength(1);
    const placedAudits = (await db.select().from(auditLogs).where(eq(auditLogs.entityType, "shop_order"))).filter((row) => row.action === "shop.order.placed");
    expect(placedAudits).toHaveLength(1);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "SHOP_ORDER_PLACED"))).toHaveLength(1);

    // Another note, or another member, is another order.
    const noted = await at(4, "Altă notă");
    expect(noted.id).not.toBe(first.id);
    expect((await variantsOf(product.id)).M.stock).toBe(0);
    await cancelOwnOrder(db, { account: member, orderId: noted.id, now: NOW });
    await expect(at(5, "Pentru sâmbătă", other)).resolves.toMatchObject({ memberStaffUserId: other.id });
    await cancelOwnOrder(db, { account: other, orderId: (await listOrdersOfMember(db, other.id))[0].id, now: NOW });

    // A cancelled order is no repeat to answer with: the same order again is a new one.
    await cancelOwnOrder(db, { account: member, orderId: first.id, now: NOW });
    const again = await at(6);
    expect(again.id).not.toBe(first.id);
    // Past the window the same order is wanted twice, and is placed twice.
    await expect(at(17)).resolves.not.toMatchObject({ id: again.id });
  });

  it("a cancellation after a save removed the order's variant locks product, variant, order and gives nothing back", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const placed = await order(member, product.id, variants.M.id, 1);
    // «M» no longer listed: the variant is deleted and the order keeps its copy, without the id.
    await saveProduct(db, { actor: admin, productId: product.id, expectedVersion: 1, fields: { ...PRODUCT, variants: "L" }, now: NOW });
    const [orphan] = await db.select().from(shopOrders).where(eq(shopOrders.id, placed.id));
    expect(orphan).toMatchObject({ variantId: null, productId: product.id, variantLabel: "M", stockTaken: true });
    const cancelled = await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "cancel", now: NOW });
    expect(cancelled).toMatchObject({ status: "CANCELLED", stockTaken: false });
    // Another member's order is no such order, before any lock is taken.
    const mine = await order(member, product.id, (await variantsOf(product.id)).L.id, 1);
    await expect(cancelOwnOrder(db, { account: other, orderId: mine.id, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a save that leaves a stock untouched keeps what the orders took; a changed number is written", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    // The form was loaded with M at 2; an order takes one meanwhile.
    await order(member, product.id, variants.M.id, 1);
    const loaded = JSON.stringify({ m: 2, l: null });
    const saved = await saveProduct(db, { actor: admin, productId: product.id, expectedVersion: 1, fields: { ...PRODUCT, variantsLoaded: loaded }, now: NOW });
    expect((await variantsOf(product.id)).M.stock).toBe(1);
    await saveProduct(db, { actor: admin, productId: product.id, expectedVersion: saved.version, fields: { ...PRODUCT, variants: "M: 9\nXL", variantsLoaded: loaded }, now: NOW });
    const after = await variantsOf(product.id);
    expect(after.M.stock).toBe(9);
    expect(after.XL.stock).toBeNull();
    // «L» is no longer listed: removed; the order on «M» keeps its own copy of everything.
    expect(after.L).toBeUndefined();
  });

  it("the club moves an order: paid, then handed over; cancelled until the hand-over; the member may cancel only while placed", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    const placed = await order(member, product.id, variants.M.id, 1);
    // Handed over before paid: refused.
    await expect(moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "handOver", now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });
    const paid = await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "pay", now: NOW });
    expect(paid).toMatchObject({ status: "PAID", paidAt: NOW });
    // The member cannot cancel a paid order.
    await expect(cancelOwnOrder(db, { account: member, orderId: placed.id, now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });
    const handed = await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "handOver", now: NOW });
    expect(handed.status).toBe("HANDED_OVER");
    await expect(moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "cancel", now: NOW })).rejects.toMatchObject({ code: "CONFLICT" });

    // A paid order cancelled by the club gives its stock back too.
    const second = await order(other, product.id, variants.M.id, 1);
    await moveOrderByClub(db, { actor: admin, orderId: second.id, verb: "pay", now: NOW });
    expect((await variantsOf(product.id)).M.stock).toBe(0);
    const cancelled = await moveOrderByClub(db, { actor: admin, orderId: second.id, verb: "cancel", now: NOW });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledBy: "CLUB", cancelledByStaffUserId: admin.id });
    expect((await variantsOf(product.id)).M.stock).toBe(1);

    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.entityType, "shop_order"))).map((row) => row.action);
    expect(actions.filter((action) => action === "shop.order.placed")).toHaveLength(2);
    expect(actions).toContain("shop.order.paid");
    expect(actions).toContain("shop.order.handed_over");
    expect(actions).toContain("shop.order.cancelled");
  });

  it("refuses an order while the notice is silent, for a hidden or archived product, and outside one to five", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const hidden = await createProduct(db, { actor: admin, fields: { ...PRODUCT, visible: false }, now: NOW });
    const variants = await variantsOf(product.id);
    await expect(order(member, product.id, variants.L.id, 1, { open: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(order(member, hidden.id, (await variantsOf(hidden.id)).L.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A variant of another product is no variant of this one.
    await expect(order(member, product.id, (await variantsOf(hidden.id)).L.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(order(member, product.id, variants.L.id, 6)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(order(member, product.id, variants.L.id, 0)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(order(member, product.id, variants.L.id, 1, { note: "x".repeat(301) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.select().from(shopOrders)).toHaveLength(0);
  });

  it("the notice gate reads the marker in every language", async () => {
    expect(await noticeDescribesMembersShop(db, NOW)).toBe(false);
    await approveNotice({ ro: strip(privacyNoticeRo), en: strip(privacyNoticeEn) });
    expect(await noticeDescribesMembersShop(db, NOW)).toBe(false);
    await approveNotice({ ro: privacyNoticeRo, en: strip(privacyNoticeEn) });
    expect(await noticeDescribesMembersShop(db, NOW)).toBe(false);
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    expect(await noticeDescribesMembersShop(db, NOW)).toBe(true);
  });

  it("deleting a product with orders archives it: out of the shop and the editor, the orders keep their copy", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const placed = await order(member, product.id, (await variantsOf(product.id)).L.id, 1);
    await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "cancel", now: NOW });
    expect(await countVisibleProducts(db)).toBe(1);
    expect(await deleteProduct(db, { actor: admin, productId: product.id, now: NOW })).toBe("archived");
    const [row] = await db.select().from(shopProducts).where(eq(shopProducts.id, product.id));
    expect(row.archivedAt).toEqual(NOW);
    expect(row.visible).toBe(false);
    expect(await listProductsForAdmin(db)).toHaveLength(0);
    expect(await listProductsForMembers(db, "ro")).toHaveLength(0);
    expect(await countVisibleProducts(db)).toBe(0);
    const [kept] = await listOrdersForAdmin(db, { status: null, productId: product.id });
    expect(kept.productTitleRo).toBe("Tricou exemplu");
  });

  it("queues «Comanda ta a fost primită» with the payment words, the club's notice when an address is set, and «plătită» on the club's press", async () => {
    await saveShopSettings(db, {
      actor: admin,
      fields: { paymentRo: "IBAN RO00 TEST 0000 0000, sau numerar", paymentEn: "IBAN RO00 TEST 0000 0000, or cash", ordersTo: "Comenzi@Example.org" },
      now: NOW,
    });
    expect((await readShopSettings(db)).ordersTo).toBe("comenzi@example.org");
    await expect(saveShopSettings(db, { actor: admin, fields: { paymentRo: "IBAN", paymentEn: "", ordersTo: "" }, now: NOW })).rejects.toMatchObject({ fields: ["paymentEn"] });
    await expect(saveShopSettings(db, { actor: admin, fields: { paymentRo: "", paymentEn: "", ordersTo: "not an address" }, now: NOW })).rejects.toMatchObject({ fields: ["ordersTo"] });

    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const placed = await order(member, product.id, (await variantsOf(product.id)).M.id, 2, { note: "Mărimea M" });
    const rows = await db.select().from(emailOutbox);
    expect(rows.map((row) => [row.messageType, row.recipientEmail]).sort()).toEqual([
      ["SHOP_ORDER_CLUB_NOTICE", "comenzi@example.org"],
      ["SHOP_ORDER_PLACED", "membru@example.org"],
    ]);
    for (const row of rows) {
      expect(row.payloadJson).toEqual({ orderId: placed.id });
      expect(row.participantId).toBeNull();
    }

    const placedRow = rows.find((row) => row.messageType === "SHOP_ORDER_PLACED")!;
    const message = await renderOutboxMessage({ ...placedRow, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toContain("Comanda ta a fost primită: Tricou exemplu");
    expect(message.text).toContain("Comanda nr.");
    expect(message.text).toContain("Tricou exemplu — M × 2 — 90 lei");
    expect(message.text).toContain("Cum se plătește: IBAN RO00 TEST 0000 0000, sau numerar");
    expect(message.text).toContain("How to pay: IBAN RO00 TEST 0000 0000, or cash");
    expect(message.text).toContain("Nota comenzii: „Mărimea M”");
    expect(message.text).toContain("Salut, Ana Exemplu");
    // No card, no token, and the button opens the members' zone.
    expect(message.text).toContain("/ro/zona-membri#members-shop");

    const clubRow = rows.find((row) => row.messageType === "SHOP_ORDER_CLUB_NOTICE")!;
    const club = await renderOutboxMessage({ ...clubRow, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(club.subject).toContain("Ana Exemplu");
    expect(club.text).toContain("/admin/pages/members#shop-orders");
    expect(club.text).not.toContain("membru@example.org");

    await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "pay", now: NOW });
    const [paidRow] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "SHOP_ORDER_PAID"));
    expect(paidRow.recipientEmail).toBe("membru@example.org");
    const paid = await renderOutboxMessage({ ...paidRow, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(paid.subject).toContain("Comanda ta e plătită");
  });

  it("without an address for orders, the club gets no email: the list alone", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    await order(member, product.id, (await variantsOf(product.id)).L.id, 1);
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType)).toEqual(["SHOP_ORDER_PLACED"]);
  });

  it("the CSV carries the member's address only when asked to, and the list filters by status and product", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const placed = await order(member, product.id, (await variantsOf(product.id)).L.id, 1, { note: "=HYPERLINK(1)" });
    await order(other, product.id, (await variantsOf(product.id)).L.id, 2);
    await moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "pay", now: NOW });
    expect(await listOrdersForAdmin(db, { status: "PAID", productId: null })).toHaveLength(1);
    expect(await listOrdersForAdmin(db, { status: null, productId: product.id })).toHaveLength(2);
    // The card's «Comenzi · N» is the filter's count, not the rows drawn: past the limit it still says them all.
    expect(await countOrdersForAdmin(db, { status: "PAID", productId: null })).toBe(1);
    expect(await countOrdersForAdmin(db, { status: null, productId: null })).toBe(2);
    expect(await listOrdersForAdmin(db, { status: null, productId: null }, 1)).toHaveLength(1);
    const rows = await listOrdersForAdmin(db, { status: null, productId: null });
    const header = { number: "Nr.", date: "Data", member: "Membru", email: "Email", product: "Produs", variant: "Varianta", quantity: "Bucăți", unitPrice: "Preț", total: "Total", status: "Starea", note: "Nota" };
    const word = (status: string) => status;
    const withEmail = buildOrdersCsv(header, rows, { locale: "ro", withEmail: true, statusWord: word });
    const without = buildOrdersCsv(header, rows, { locale: "ro", withEmail: false, statusWord: word });
    expect(withEmail).toContain("membru@example.org");
    expect(without).not.toContain("membru@example.org");
    expect(without).not.toContain("Email");
    // A formula in a note opens as text.
    expect(withEmail).toContain("'=HYPERLINK(1)");
    expect(withEmail.startsWith("﻿")).toBe(true);
    expect(withEmail.split("\r\n")).toHaveLength(3);
  });

  it("a member's account removed: the order stays with the name, without the address", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    await order(member, product.id, (await variantsOf(product.id)).L.id, 1);
    await db.delete(staffUsers).where(eq(staffUsers.id, member.id));
    const [kept] = await listOrdersForAdmin(db, { status: null, productId: null });
    expect(kept).toMatchObject({ memberName: "Ana Exemplu", memberEmail: null });
  });

  it("the zone draws the shop and «Comenzile mele» with the payment words under an unpaid order", async () => {
    const product = await createProduct(db, { actor: admin, fields: PRODUCT, now: NOW });
    const variants = await variantsOf(product.id);
    await order(member, product.id, variants.M.id, 2);
    const html = renderToStaticMarkup(
      await MembersShop({
        products: await listProductsForMembers(db, "ro"),
        orders: await listOrdersOfMember(db, member.id),
        payment: "IBAN RO00 TEST",
        shopOpen: true,
        outcome: "placed",
        locale: "ro",
      }),
    );
    expect(html).toContain(ro.Members.shop.title);
    expect(html).toContain("Tricou exemplu");
    expect(html).toContain("45 lei");
    // M is sold out after the order: offered disabled, with its words.
    expect(html).toContain("M — stoc epuizat");
    expect(html).toContain(ro.Members.shop.ordersTitle);
    expect(html).toContain("IBAN RO00 TEST");
    expect(html).toContain(ro.Members.shop.outcome.placed);
    // Never a stock number.
    expect(html).not.toMatch(/stoc: \d/i);

    // The notice silent: no shop, but the member's own orders stay readable.
    const closed = renderToStaticMarkup(
      await MembersShop({ products: [], orders: await listOrdersOfMember(db, member.id), payment: null, shopOpen: false, outcome: null, locale: "ro" }),
    );
    expect(closed).not.toContain('data-testid="members-shop"');
    expect(closed).toContain('data-testid="members-orders"');
    expect(closed).toContain(ro.Members.shop.paymentByClub);
    // And with neither, nothing at all.
    expect(renderToStaticMarkup(await MembersShop({ products: [], orders: [], payment: null, shopOpen: true, outcome: null, locale: "ro" }))).toBe("");
    expect(en.Members.shop.title).not.toBe(ro.Members.shop.title);
  });
});
