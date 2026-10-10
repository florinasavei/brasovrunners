import sharp from "sharp";
import { eq } from "drizzle-orm";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { shopProductPictures, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { MEMBERS_PAGE_SETTING_KEY } from "@/modules/content/members/page-settings";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the shop's editor rebuilt: one page per product with its five cards, many pictures with the
 * first as cover, «Mărimile» as ticks in a fixed order with a stock each and a size chart, a rich
 * description with plain twins; the members' zone drawing the cover, the strip, the description and
 * the chart. Proven on real PostgreSQL (PGlite) through the service, the repository and the pages,
 * and through the real session for the gates (BR-REQ-060-01): a reader of the shop opens every page
 * and gets no box, a volunteer holding «Gestionează magazinul» gets the forms, a volunteer without it
 * gets the 404 any typed address gets.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/app/[locale]/members-area/actions", () => ({ placeShopOrderAction: async () => {}, cancelShopOrderAction: async () => {} }));
vi.mock("@/app/[locale]/admin/shop/actions", () => ({
  addShopPictureAction: async () => {},
  createShopProductAction: async () => {},
  deleteShopProductAction: async () => {},
  moveShopOrderAction: async () => {},
  moveShopPictureAction: async () => {},
  moveShopProductAction: async () => {},
  placeOrderForMemberAction: async () => {},
  removeShopPictureAction: async () => {},
  replaceShopPictureAction: async () => {},
  saveShopProductAction: async () => {},
  saveShopSettingsAction: async () => {},
}));
vi.mock("next-intl/server", () => {
  const translator = (namespace: string | { namespace: string }) => {
    const path = typeof namespace === "string" ? namespace : namespace.namespace;
    const messages = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], ro) as Record<string, string>;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  };
  return { setRequestLocale: () => {}, getLocale: async () => "ro", getMessages: async () => ro, getTranslations: async (namespace: string | { namespace: string }) => translator(namespace) };
});

const { addProductPicture, createProduct, deleteProduct, moveProductPicture, removeProductPicture, replaceProductPicture, saveProduct } = await import("@/modules/content/shop/service");
const { placeOrder } = await import("@/modules/content/shop/orders");
const { listProductsForAdmin, listProductsForMembers, readProductForAdmin } = await import("@/modules/content/shop/repository");
const { loadedStockJson } = await import("@/modules/content/shop/fields");
const { PICTURES_MAX } = await import("@/modules/content/shop/domain");
const { setStaffPermission } = await import("@/modules/staff-identity/service");
const { uploadBodyImage } = await import("@/modules/media/service");
const { deleteMediaAsset, listMediaAssetsForAdmin } = await import("@/modules/media/references");
const { isDomainError } = await import("@/shared/errors/domain-error");
const { default: ShopSectionLayout } = await import("@/app/[locale]/admin/shop/layout");
const { default: AdminShopPage } = await import("@/app/[locale]/admin/shop/page");
const { default: AdminShopNewProductPage } = await import("@/app/[locale]/admin/shop/products/new/page");
const { default: AdminShopProductPage } = await import("@/app/[locale]/admin/shop/products/[id]/page");
const { default: AdminShopSettingsPage } = await import("@/app/[locale]/admin/shop/settings/page");
const { default: ProductForm } = await import("@/modules/content/shop/ui/ProductForm");
const { default: ProductList } = await import("@/modules/content/shop/ui/ProductList");
const { default: ProductPicturesCard } = await import("@/modules/content/shop/ui/ProductPicturesCard");
const { default: ProductRemoveCard } = await import("@/modules/content/shop/ui/ProductRemoveCard");
const { default: ProductSizesCard } = await import("@/modules/content/shop/ui/ProductSizesCard");
const { default: ShopSettingsCard } = await import("@/modules/content/shop/ui/ShopSettingsCard");
const { default: MembersShop } = await import("@/app/[locale]/members-area/MembersShop");
const { getTranslations } = await import("next-intl/server");

const NOW = new Date("2026-10-10T09:00:00.000Z");

/** A paragraph, a table with a header row and a picture: what the owner asked the description to carry. */
const doc = (text: string, src?: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Material" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Bumbac" }] }] }] },
      ],
    },
    ...(src ? [{ type: "image", attrs: { src, alt: "", width: 800, height: 600 } }] : []),
  ],
});

/** «Mărimile» as the sizes card posts them: S and M ticked (S with a stock), a free label, one chart column. */
const SHIRT = {
  titleRo: "Tricou de probă",
  titleEn: "Sample shirt",
  descriptionRo: "",
  descriptionEn: "",
  price: "45",
  currency: "RON",
  sizes: ["M", "S"],
  sizeStock: { S: "5", M: "" },
  oneSize: "",
  stock: "",
  extraVariants: "Copii: 3",
  chartColumns: [{ ro: "Lățime piept (cm)", en: "Chest width (cm)" }],
  chartCells: { S: ["48"], M: ["50,5"], XL: ["99"] },
  visible: true,
};

type Props = Record<string, unknown> & { children?: ReactNode };

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

describe("§NNN the shop's editor: pictures, sizes, chart, description", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let volunteer: StaffUser;
  let member: StaffUser;

  const picture = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#3355ff" } }).jpeg().toBuffer();
  const upload = async (name: string) => uploadBodyImage(db, { actorId: admin.id, file: await picture(), originalFilename: name, now: NOW });
  const variantsOf = async (productId: string) =>
    (await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, productId))).sort((a, b) => a.position - b.position);
  const picturesOf = async (productId: string) =>
    (await db.select().from(shopProductPictures).where(eq(shopProductPictures.productId, productId))).sort((a, b) => a.position - b.position);
  const productRow = async (productId: string) => (await db.select().from(shopProducts).where(eq(shopProducts.id, productId)))[0];
  const params = () => Promise.resolve({ locale: "ro" });
  const withId = (id: string) => Promise.resolve({ locale: "ro", id });
  const none = Promise.resolve({});

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.cookie = undefined;
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.org", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizator@example.org", displayName: "Organizator", role: "MODERATOR" }).returning();
    [volunteer] = await db.insert(staffUsers).values({ email: "voluntar@example.org", displayName: "Voluntar", role: "CONTRIBUTOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "membru-a@example.org", displayName: "Membru A", role: "MEMBER" }).returning();
  });

  it("«Mărimile»: the ticked sizes become variants in the fixed order, each with its stock, the free labels after; the chart keeps the ticked rows only", async () => {
    const product = await createProduct(db, { actor: admin, fields: SHIRT, now: NOW });
    expect((await variantsOf(product.id)).map((row) => [row.label, row.stock])).toEqual([
      ["S", 5],
      ["M", null],
      ["Copii", 3],
    ]);
    const read = await readProductForAdmin(db, product.id);
    expect(read?.sizeChart).toEqual({ columns: [{ ro: "Lățime piept (cm)", en: "Chest width (cm)" }], rows: { S: [48], M: [50.5] } });

    // A free label that spells a size is refused on its box; a fifth chart column and a one-language column on the chart's.
    await expect(createProduct(db, { actor: admin, fields: { ...SHIRT, extraVariants: "xl" }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["extraVariants"] });
    await expect(createProduct(db, { actor: admin, fields: { ...SHIRT, chartColumns: [{ ro: "Piept", en: "" }] }, now: NOW })).rejects.toMatchObject({ fields: ["chartColumns"] });
    await expect(
      createProduct(db, { actor: admin, fields: { ...SHIRT, chartColumns: Array.from({ length: 5 }, (_, i) => ({ ro: `C${i}`, en: `C${i}` })) }, now: NOW }),
    ).rejects.toMatchObject({ fields: ["chartColumns"] });
    await expect(createProduct(db, { actor: admin, fields: { ...SHIRT, sizeStock: { S: "multe" } }, now: NOW })).rejects.toMatchObject({ fields: ["sizes"] });

    // «Mărime unică» with nothing ticked is the one-variant product; nothing at all is the same.
    const buff = await createProduct(db, { actor: admin, fields: { ...SHIRT, sizes: [], sizeStock: {}, extraVariants: "", oneSize: "on", stock: "12", chartColumns: [], chartCells: {} }, now: NOW });
    expect((await variantsOf(buff.id)).map((row) => [row.label, row.stock])).toEqual([[null, 12]]);
    expect((await readProductForAdmin(db, buff.id))?.sizeChart).toBeNull();
  });

  it("a save keeps an untouched size's stock as the orders left it, writes a changed one, and refuses to untick a size with an order", async () => {
    const product = await createProduct(db, { actor: admin, fields: SHIRT, now: NOW });
    const loaded = loadedStockJson(await variantsOf(product.id));
    const [s] = await variantsOf(product.id);
    await placeOrder(db, { account: member, locale: "ro", noticeDescribes: true, fields: { productId: product.id, variantId: s.id, quantity: "2", note: "" }, now: NOW });
    expect((await variantsOf(product.id))[0].stock).toBe(3);

    // The box S still says 5 (what the form loaded): untouched, so the 3 the order left stays; M gets its new 7.
    await saveProduct(db, { actor: admin, productId: product.id, expectedVersion: product.version, fields: { ...SHIRT, sizeStock: { S: "5", M: "7" }, variantsLoaded: loaded }, now: NOW });
    expect((await variantsOf(product.id)).map((row) => [row.label, row.stock])).toEqual([
      ["S", 3],
      ["M", 7],
      ["Copii", 3],
    ]);

    // S unticked while an order names it: refused on «Mărimile», nothing written.
    const refused = await saveProduct(db, { actor: admin, productId: product.id, expectedVersion: product.version + 1, fields: { ...SHIRT, sizes: ["M"], variantsLoaded: loaded }, now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("SHOP_SIZE_HAS_ORDERS");
    expect(isDomainError(refused) && refused.fields).toEqual(["sizes"]);
    expect((await variantsOf(product.id)).map((row) => row.label)).toEqual(["S", "M", "Copii"]);
  });

  it("the description is a rich text with tables and pictures, both languages or neither, with plain twins written by the save", async () => {
    const inText = await upload("desen.jpg");
    const product = await createProduct(db, {
      actor: admin,
      fields: { ...SHIRT, descriptionRoBody: JSON.stringify(doc("Bumbac organic.", inText.src)), descriptionEnBody: JSON.stringify(doc("Organic cotton.")) },
      now: NOW,
    });
    const row = await productRow(product.id);
    expect(row.descriptionRo).toContain("Bumbac organic.");
    expect(row.descriptionEn).toContain("Organic cotton.");
    expect(JSON.stringify(row.descriptionRoJson)).toContain('"type":"table"');
    expect(JSON.stringify(row.descriptionRoJson)).toContain(inText.src);

    const half = await createProduct(db, { actor: admin, fields: { ...SHIRT, descriptionRoBody: JSON.stringify(doc("Doar română.")) }, now: NOW }).catch((e: unknown) => e);
    expect(isDomainError(half) && half.code).toBe("VALIDATION_ERROR");
    // The refusal names the description's English box by the pair's plain name, which the product page maps to the same label.
    expect(isDomainError(half) && half.fields).toEqual(expect.arrayContaining(["descriptionEn"]));

    // The zone draws the table through the one renderer, in the reader's language.
    const [zone] = await listProductsForMembers(db, "en");
    expect(JSON.stringify(zone.description)).toContain("Organic cotton.");
    const html = renderToStaticMarkup(await MembersShop({ products: [zone], orders: [], payment: null, shopOpen: true, outcome: null, locale: "en" }));
    expect(html).toContain('data-testid="product-description"');
    expect(html).toContain("<table");
    expect(html).toContain("Material");
  });

  it("pictures: added at the end, the first is the cover and mirrored onto the product; moved, replaced and removed under one audit action naming no title", async () => {
    const product = await createProduct(db, { actor: admin, fields: SHIRT, now: NOW });
    const [a, b, c] = await Promise.all([upload("a.jpg"), upload("b.jpg"), upload("c.jpg")]);
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const first = await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: a.assetId, photoCrop: JSON.stringify(crop) }, now: NOW });
    await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: b.assetId, photoCrop: "" }, now: NOW });
    expect((await picturesOf(product.id)).map((row) => [row.mediaAssetId, row.position])).toEqual([
      [a.assetId, 1],
      [b.assetId, 2],
    ]);
    expect(await productRow(product.id)).toMatchObject({ photoMediaAssetId: a.assetId, photoCrop: crop, version: product.version });

    // The second moved up is the cover now; the mirror follows.
    const second = (await picturesOf(product.id))[1];
    await moveProductPicture(db, { actor: admin, productId: product.id, pictureId: second.id, direction: "up", now: NOW });
    expect((await picturesOf(product.id)).map((row) => row.mediaAssetId)).toEqual([b.assetId, a.assetId]);
    expect(await productRow(product.id)).toMatchObject({ photoMediaAssetId: b.assetId, photoCrop: null });

    // Another picture in the cover's place, with a crop; then the cover removed — the next one is the cover.
    await replaceProductPicture(db, { actor: admin, productId: product.id, pictureId: second.id, fields: { photoAssetId: c.assetId, photoCrop: JSON.stringify(crop) }, now: NOW });
    expect(await productRow(product.id)).toMatchObject({ photoMediaAssetId: c.assetId, photoCrop: crop });
    await removeProductPicture(db, { actor: admin, productId: product.id, pictureId: second.id, now: NOW });
    expect((await picturesOf(product.id)).map((row) => [row.mediaAssetId, row.position])).toEqual([[a.assetId, 1]]);
    expect(await productRow(product.id)).toMatchObject({ photoMediaAssetId: a.assetId, photoCrop: crop });
    expect((await readProductForAdmin(db, product.id))?.pictures.map((row) => row.id)).toEqual([first.id]);

    // Refused: a picture that is not stored, a stranger's picture id, the strip full, and every verb for who may not.
    await expect(addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: "11111111-2222-3333-4444-555555555555", photoCrop: "" }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["photoAssetId"] });
    await expect(removeProductPicture(db, { actor: admin, productId: product.id, pictureId: second.id, now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (let n = 1; n < PICTURES_MAX; n += 1) await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: b.assetId, photoCrop: "" }, now: NOW });
    await expect(addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: b.assetId, photoCrop: "" }, now: NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    for (const actor of [organizer, volunteer, member]) {
      await expect(addProductPicture(db, { actor, productId: product.id, fields: { photoAssetId: a.assetId, photoCrop: "" }, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeProductPicture(db, { actor, productId: product.id, pictureId: first.id, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "shop.product.pictures_changed"));
    expect(audit.map((row) => (row.metadataJson as { change: string }).change)).toEqual(expect.arrayContaining(["added", "moved", "replaced", "removed"]));
    expect(JSON.stringify(audit.map((row) => row.metadataJson))).not.toContain("Tricou");
  });

  it("the pictures page knows a picture of the strip and one in the description are used by the shop, and refuses to delete them; deleting the product frees the strip", async () => {
    const [inStrip, inText, loose] = await Promise.all([upload("strip.jpg"), upload("text.jpg"), upload("loose.jpg")]);
    const product = await createProduct(db, {
      actor: admin,
      fields: { ...SHIRT, descriptionRoBody: JSON.stringify(doc("Cu desen.", inText.src)), descriptionEnBody: JSON.stringify(doc("With a drawing.")) },
      now: NOW,
    });
    await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: inStrip.assetId, photoCrop: "" }, now: NOW });
    const byId = new Map((await listMediaAssetsForAdmin(db, "ro")).map((row) => [row.id, row]));
    const used = [{ kind: "membersPage", id: MEMBERS_PAGE_SETTING_KEY, title: null }];
    expect(byId.get(inStrip.assetId)?.references).toEqual(used);
    expect(byId.get(inText.assetId)?.references).toEqual(used);
    expect(byId.get(loose.assetId)?.references).toEqual([]);
    for (const assetId of [inStrip.assetId, inText.assetId]) {
      const refused = await deleteMediaAsset(db, { actor: admin, assetId }).catch((e: unknown) => e);
      expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    }
    expect(await deleteProduct(db, { actor: admin, productId: product.id, now: NOW })).toBe("deleted");
    expect(await picturesOf(product.id)).toEqual([]);
    expect((await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === inStrip.assetId)?.references).toEqual([]);
  });

  it("the zone draws the cover large, the rest as thumbnails, the size chart as a table and the sizes in the shop's order", async () => {
    const product = await createProduct(db, { actor: admin, fields: { ...SHIRT, sizes: ["XL", "S", "M"], sizeStock: { S: "5" }, extraVariants: "Copii" }, now: NOW });
    const [a, b, c] = await Promise.all([upload("a.jpg"), upload("b.jpg"), upload("c.jpg")]);
    for (const asset of [a, b, c]) await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: asset.assetId, photoCrop: "" }, now: NOW });

    const before = await listProductsForMembers(db, "ro");
    expect(before[0].pictures).toHaveLength(3);
    expect(new Set(before[0].pictures.map((picture) => picture.webUrl)).size).toBe(3);
    // The strip follows the positions: the last picture moved to the front is the cover now.
    const [, , last] = await picturesOf(product.id);
    await moveProductPicture(db, { actor: admin, productId: product.id, pictureId: last.id, direction: "up", now: NOW });
    await moveProductPicture(db, { actor: admin, productId: product.id, pictureId: last.id, direction: "up", now: NOW });
    const products = await listProductsForMembers(db, "ro");
    expect(products[0].pictures.map((picture) => picture.webUrl)).toEqual([before[0].pictures[2].webUrl, before[0].pictures[0].webUrl, before[0].pictures[1].webUrl]);
    expect(products[0].variants.map((variant) => variant.label)).toEqual(["S", "M", "XL", "Copii"]);
    // XL is ticked here, so its row is kept too — in the sizes' order, whatever order the cells were posted in.
    expect(products[0].sizeChart).toEqual({ columns: ["Lățime piept (cm)"], rows: [{ label: "S", cells: [48] }, { label: "M", cells: [50.5] }, { label: "XL", cells: [99] }] });

    const html = renderToStaticMarkup(await MembersShop({ products, orders: [], payment: null, shopOpen: true, outcome: null, locale: "ro" }));
    expect((html.match(/data-testid="product-cover"/g) ?? []).length).toBe(1);
    expect((html.match(/data-testid="product-picture-thumb"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-label="Fotografia 2"');
    expect(html).toContain('data-testid="size-chart"');
    expect(html).toContain("50,5");
    expect(html).toContain(ro.Members.shop.sizeChart);
    const options = [...html.matchAll(/<option[^>]*value="[0-9a-f-]{36}"[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]);
    expect(options).toEqual(["S", "M", "XL", "Copii"]);

    // The English zone reads the column's English name and the English number.
    const en = renderToStaticMarkup(await MembersShop({ products: await listProductsForMembers(db, "en"), orders: [], payment: null, shopOpen: true, outcome: null, locale: "en" }));
    expect(en).toContain("Chest width (cm)");
    expect(en).toContain("50.5");

    // A product written before the strip (§683's one photo) shows that photo as its cover.
    const old = await createProduct(db, { actor: admin, fields: { ...SHIRT, titleRo: "Buff", titleEn: "Buff" }, now: NOW });
    await db.update(shopProducts).set({ photoMediaAssetId: a.assetId }).where(eq(shopProducts.id, old.id));
    expect((await listProductsForMembers(db, "ro")).find((row) => row.id === old.id)?.pictures).toHaveLength(1);
  });

  it("the cards say what is stored: the list's row, the sizes' ticks and stock boxes, the chart's cells, the pictures with their cover", async () => {
    const product = await createProduct(db, { actor: admin, fields: SHIRT, now: NOW });
    const [a, b] = await Promise.all([upload("a.jpg"), upload("b.jpg")]);
    for (const asset of [a, b]) await addProductPicture(db, { actor: admin, productId: product.id, fields: { photoAssetId: asset.assetId, photoCrop: "" }, now: NOW });
    const read = (await readProductForAdmin(db, product.id))!;
    const t = (await getTranslations("Admin")) as never;
    // The list's links are next-intl's, which read the locale from the provider.
    const html = (node: ReactNode) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, node));

    const list = html(ProductList({ products: await listProductsForAdmin(db), locale: "ro", words: t, mayManage: true }));
    expect(list).toContain("Tricou de probă");
    expect(list).toContain("45 lei");
    expect(list).toContain("S: 5 · M · Copii: 3");
    expect(list).toContain("2 fotografii");
    expect(list).toContain(`/ro/admin/shop/products/${product.id}`);
    expect(list).toContain('data-testid="product-add-link"');
    expect(html(ProductList({ products: await listProductsForAdmin(db), locale: "ro", words: t, mayManage: false }))).not.toContain('data-testid="product-add-link"');

    const sizes = renderToStaticMarkup(ProductSizesCard({ product: read, words: t }));
    expect(sizes).toMatch(/name="sizes\[S\]"[^>]*checked/);
    expect(sizes).toMatch(/name="sizes\[M\]"[^>]*checked/);
    expect(sizes).not.toMatch(/name="sizes\[L\]"[^>]*checked/);
    expect(sizes).toMatch(/name="sizeStock\[S\]"[^>]*value="5"/);
    expect(sizes).toMatch(/name="extraVariants"[^>]*>Copii: 3</);
    expect(sizes).toMatch(/name="chartColumns\[0\]\[ro\]"[^>]*value="Lățime piept \(cm\)"/);
    expect(sizes).toMatch(/name="chartCells\[M\]\[0\]"[^>]*value="50,5"/);
    expect(sizes).toContain(`name="variantsLoaded"`);
    // The nine standard sizes in the fixed order, then «Mărime unică».
    const ticks = [...sizes.matchAll(/name="sizes\[([^\]]+)\]"/g)].map((match) => match[1]);
    expect(ticks).toEqual(["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"]);

    const labels = {} as never;
    const pictures = renderToStaticMarkup(ProductPicturesCard({ product: read, locale: "ro", words: t, cancel: "Renunță", messages: { fieldError: "", summary: "", fields: {} } as never, photoLabels: labels, storage: false, mayManage: true }));
    expect((pictures.match(/data-testid="shop-picture"/g) ?? []).length).toBe(2);
    expect((pictures.match(/data-testid="picture-cover"/g) ?? []).length).toBe(1);
    expect(pictures).toContain(ro.Admin.members.shop.pictures.cover);
    // Without storage no add form is offered; a reader gets no button at all.
    expect(pictures).not.toContain('data-testid="picture-add"');
    const reader = renderToStaticMarkup(ProductPicturesCard({ product: read, locale: "ro", words: t, cancel: "Renunță", messages: { fieldError: "", summary: "", fields: {} } as never, photoLabels: labels, storage: true, mayManage: false }));
    expect(reader).not.toContain("<button");
    const fresh = renderToStaticMarkup(ProductPicturesCard({ product: null, locale: "ro", words: t, cancel: "Renunță", messages: { fieldError: "", summary: "", fields: {} } as never, photoLabels: labels, storage: true, mayManage: true }));
    expect(fresh).toContain('data-testid="pictures-after-save"');
  });

  it("BR-REQ-060-01: every page is gated — a reader opens them and gets no box, a grant holder gets the forms, a volunteer without it gets 404, and «Adaugă un produs» is for who may manage", async () => {
    const product = await createProduct(db, { actor: admin, fields: SHIRT, now: NOW });
    const archived = await createProduct(db, { actor: admin, fields: { ...SHIRT, titleRo: "Vechi", titleEn: "Old" }, now: NOW });
    await db.update(shopProducts).set({ archivedAt: NOW }).where(eq(shopProducts.id, archived.id));

    state.cookie = admin.id;
    const page = elements(await AdminShopProductPage({ params: withId(product.id), searchParams: none }));
    expect(page.some((element) => element.type === ProductPicturesCard && element.props.mayManage === true)).toBe(true);
    expect(page.some((element) => element.type === ProductForm)).toBe(true);
    expect(page.some((element) => element.type === ProductRemoveCard)).toBe(true);
    expect(elements(await AdminShopNewProductPage({ params: params(), searchParams: none })).some((element) => element.type === ProductForm && element.props.product === null)).toBe(true);
    expect(elements(await AdminShopPage({ params: params(), searchParams: none })).some((element) => element.type === ProductList && element.props.mayManage === true)).toBe(true);
    expect(elements(await AdminShopSettingsPage({ params: params(), searchParams: none })).some((element) => element.type === ShopSettingsCard && element.props.mayManage === true)).toBe(true);
    // A malformed id, an unknown one and an archived product are the same 404.
    expect(await statusOf(AdminShopProductPage({ params: withId("not-an-id"), searchParams: none }))).toBe(404);
    expect(await statusOf(AdminShopProductPage({ params: withId("11111111-2222-3333-4444-555555555555"), searchParams: none }))).toBe(404);
    expect(await statusOf(AdminShopProductPage({ params: withId(archived.id), searchParams: none }))).toBe(404);

    // The Organizer reads: the pictures without a button, the facts, no form, and no «Adaugă un produs».
    state.cookie = organizer.id;
    const reading = elements(await AdminShopProductPage({ params: withId(product.id), searchParams: none }));
    expect(reading.some((element) => element.type === ProductPicturesCard && element.props.mayManage === false)).toBe(true);
    expect(reading.some((element) => element.type === ProductForm)).toBe(false);
    // The facts without a box: the page's own read-only block, a component the tree holds by name.
    expect(reading.some((element) => (element.type as { name?: string }).name === "ReadOnlyProduct")).toBe(true);
    expect(await statusOf(AdminShopNewProductPage({ params: params(), searchParams: none }))).toBe(404);
    expect(elements(await AdminShopSettingsPage({ params: params(), searchParams: none })).some((element) => element.type === ShopSettingsCard && element.props.mayManage === false)).toBe(true);

    // A volunteer: 404 at the gate; with «Gestionează magazinul», the forms.
    state.cookie = volunteer.id;
    expect(await statusOf(ShopSectionLayout({ children: null }))).toBe(404);
    expect(await statusOf(AdminShopProductPage({ params: withId(product.id), searchParams: none }))).toBe(404);
    await setStaffPermission(db, admin, { targetId: volunteer.id, permission: "shop.manage", on: true, now: NOW });
    expect(await statusOf(ShopSectionLayout({ children: null }))).toBeNull();
    expect(elements(await AdminShopProductPage({ params: withId(product.id), searchParams: none })).some((element) => element.type === ProductForm)).toBe(true);
    expect(elements(await AdminShopNewProductPage({ params: params(), searchParams: none })).some((element) => element.type === ProductForm)).toBe(true);

    // And the service behind every form asserts the same; a member has no staff session at all at the gate.
    state.cookie = member.id;
    await expect(ShopSectionLayout({ children: null })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(saveProduct(db, { actor: member, productId: product.id, expectedVersion: 1, fields: SHIRT, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveProduct(db, { actor: organizer, productId: product.id, expectedVersion: 1, fields: SHIRT, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
