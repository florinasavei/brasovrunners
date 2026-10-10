"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { type OrderVerb, STANDARD_SIZES } from "@/modules/content/shop/domain";
import { moveOrderByClub, placeOrderForMember } from "@/modules/content/shop/orders";
import { ordersFilterParams } from "@/modules/content/shop/repository";
import {
  addProductPicture,
  createProduct,
  deleteProduct,
  moveProduct,
  moveProductPicture,
  removeProductPicture,
  replaceProductPicture,
  saveProduct,
} from "@/modules/content/shop/service";
import { saveShopSettings } from "@/modules/content/shop/settings";
import { canManageShop } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * «Magazin»'s writes (§683, §687, §690, §697), the codes' shape (§552): a refused product, picture or
 * settings save returns, so every box comes back as typed (§315); every other outcome is a redirect
 * to the screen it belongs to — the product's own page, the list, the orders or the settings tab —
 * with a language-neutral code and a toast (§384). The door asks `canManageShop` of the actor — a
 * colleague holding «Gestionează magazinul» included (§687) — and the service asserts it again
 * (BR-REQ-060-01), so an Organizer who reads the section is refused every verb on the server.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

type Screen = "/admin/shop" | "/admin/shop/orders" | "/admin/shop/settings" | { pathname: "/admin/shop/products/[id]"; params: { id: string } };

async function backTo(form: FormData, screen: Screen, outcome: { error?: string; saved?: string }, anchor: string, keep?: URLSearchParams): Promise<never> {
  await flashOutcome(outcome);
  const query = new URLSearchParams(outcome.error ? { error: outcome.error } : { saved: outcome.saved ?? "1" });
  for (const [name, value] of keep ?? []) query.set(name, value);
  const path = getPathname({ locale: toLocale(form.get("uiLocale")), href: screen });
  redirect(`${path}?${query.toString()}#${outcome.error ? "admin-alert" : anchor}`);
}

/** The product's own page, or the list for an id that is not one (a hand-made post). */
function productScreen(productId: string): Screen {
  return isUuid(productId) ? { pathname: "/admin/shop/products/[id]", params: { id: productId.toLowerCase() } } : "/admin/shop";
}

function outcomeOf(error: unknown): { error: string } {
  if (!isDomainError(error)) throw error;
  return { error: error.code };
}

/**
 * The orders list's filter, posted back by a verb (§683) and read through the address's own parser —
 * a status from the closed set, a product id that is a UUID, anything else dropped — so the answer
 * lands on the list the Administrator was reading, filtered.
 */
function ordersFilterOf(form: FormData): URLSearchParams {
  return ordersFilterParams({ orderStatus: text(form, "orderStatus"), orderProduct: text(form, "orderProduct") });
}

/**
 * «Tabelul de mărimi» as the form posts it (§697): `chartColumns[<i>][ro|en]` for the column names
 * and `chartCells[<label>][<i>]` for the cells — read by shape, never by a name taken from the POST
 * beyond the size label, which the service matches against the product's own variants.
 */
function chartOf(form: FormData): { chartColumns: { ro: string; en: string }[]; chartCells: Record<string, string[]> } {
  const chartColumns: { ro: string; en: string }[] = [];
  const chartCells: Record<string, string[]> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string") continue;
    const column = /^chartColumns\[(\d)\]\[(ro|en)\]$/.exec(name);
    if (column) {
      const index = Number(column[1]);
      chartColumns[index] ??= { ro: "", en: "" };
      chartColumns[index][column[2] as "ro" | "en"] = value;
      continue;
    }
    const cell = /^chartCells\[([^\]]{1,20})\]\[(\d)\]$/.exec(name);
    if (cell) {
      const row = (chartCells[cell[1]] ??= []);
      row[Number(cell[2])] = value;
    }
  }
  return {
    chartColumns: chartColumns.map((column) => column ?? { ro: "", en: "" }),
    chartCells: Object.fromEntries(Object.entries(chartCells).map(([label, cells]) => [label, Array.from(cells, (cell) => cell ?? "")])),
  };
}

/** The product's boxes as the five cards post them (§697); «Mărimile» by the standard sizes' own names. */
function productFieldsOf(form: FormData) {
  const sizeStock: Record<string, string> = {};
  for (const size of STANDARD_SIZES) sizeStock[size] = text(form, `sizeStock[${size}]`);
  return {
    titleRo: text(form, "titleRo"),
    titleEn: text(form, "titleEn"),
    descriptionRo: text(form, "descriptionRo"),
    descriptionEn: text(form, "descriptionEn"),
    descriptionRoBody: form.has("descriptionRoBody") ? text(form, "descriptionRoBody") : undefined,
    descriptionEnBody: form.has("descriptionEnBody") ? text(form, "descriptionEnBody") : undefined,
    price: text(form, "price"),
    currency: text(form, "currency"),
    // One tick per standard size (`sizes[M]`), read by the sizes' own names — never a label from the POST.
    sizes: STANDARD_SIZES.filter((size) => form.get(`sizes[${size}]`) === "on"),
    sizeStock,
    oneSize: form.get("oneSize") === "on",
    stock: text(form, "stock"),
    extraVariants: text(form, "extraVariants"),
    ...chartOf(form),
    variantsLoaded: text(form, "variantsLoaded"),
    visible: form.get("visible") === "on",
  };
}

/** «Adaugă produsul»: a new product lands on its own page, where its pictures are added. */
export async function createShopProductAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaffCapability(canManageShop);
    id = (await createProduct(getDb(), { actor, fields: productFieldsOf(form) })).id;
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, productScreen(id), { saved: "shopProductCreated" }, "product-pictures");
}

export async function saveShopProductAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const productId = text(form, "productId");
  try {
    const actor = await requireStaffCapability(canManageShop);
    await saveProduct(getDb(), { actor, productId, expectedVersion: Number(text(form, "expectedVersion")), fields: productFieldsOf(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, productScreen(productId), { saved: "shopProductSaved" }, "product-form");
}

/** One place up or down; lands on the product it moved. A plain form: moving asks nothing first. */
export async function moveShopProductAction(form: FormData): Promise<void> {
  const productId = text(form, "productId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageShop);
    await moveProduct(getDb(), { actor, productId, direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "shopProductMoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(form, "/admin/shop", outcome, `product-${productId}`);
}

/** Deletes a product, or archives it when an order names it — the toast says which; lands on the list. */
export async function deleteShopProductAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageShop);
    const done = await deleteProduct(getDb(), { actor, productId: text(form, "productId") });
    outcome = done === "archived" ? { saved: "shopProductArchived" } : { saved: "shopProductDeleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(form, "/admin/shop", outcome, "shop-products");
}

// --- The pictures (§697) --------------------------------------------------------------------------

/** «Adaugă fotografia»: the picture `TeamPhotoField` posted, with its crop, at the end of the strip. */
export async function addShopPictureAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const productId = text(form, "productId");
  try {
    const actor = await requireStaffCapability(canManageShop);
    await addProductPicture(getDb(), { actor, productId, fields: { photoAssetId: text(form, "photoAssetId"), photoCrop: text(form, "photoCrop") } });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, productScreen(productId), { saved: "shopPictureAdded" }, "product-pictures");
}

/** One place left or right in the strip; a plain form, asks nothing first. */
export async function moveShopPictureAction(form: FormData): Promise<void> {
  const productId = text(form, "productId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageShop);
    await moveProductPicture(getDb(), { actor, productId, pictureId: text(form, "pictureId"), direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "shopPictureMoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(form, productScreen(productId), outcome, "product-pictures");
}

/** «Scoate fotografia»: off the strip, asked first; the file stays in the gallery. */
export async function removeShopPictureAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const productId = text(form, "productId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageShop);
    await removeProductPicture(getDb(), { actor, productId, pictureId: text(form, "pictureId") });
    outcome = { saved: "shopPictureRemoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(form, productScreen(productId), outcome, "product-pictures");
}

/** «Salvează fotografia»: a new crop for one picture of the strip, or another picture in its place. */
export async function replaceShopPictureAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const productId = text(form, "productId");
  try {
    const actor = await requireStaffCapability(canManageShop);
    await replaceProductPicture(getDb(), {
      actor,
      productId,
      pictureId: text(form, "pictureId"),
      fields: { photoAssetId: text(form, "photoAssetId"), photoCrop: text(form, "photoCrop") },
    });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, productScreen(productId), { saved: "shopPictureReplaced" }, "product-pictures");
}

// --- «Setări» and «Comenzi» -----------------------------------------------------------------------

/** «Cum se plătește» and «Cine primește comenzile»: both languages or neither, one address or none. */
export async function saveShopSettingsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaffCapability(canManageShop);
    await saveShopSettings(getDb(), {
      actor,
      fields: { paymentRo: text(form, "paymentRo"), paymentEn: text(form, "paymentEn"), ordersTo: text(form, "ordersTo") },
    });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, "/admin/shop/settings", { saved: "shopSettingsSaved" }, "shop-settings");
}

/** «Marchează plătită», «Marchează predată», «Anulează» on an order — the verb a closed set, never a name from the POST. */
export async function moveShopOrderAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const posted = text(form, "verb");
  const verb: OrderVerb = posted === "pay" ? "pay" : posted === "handOver" ? "handOver" : "cancel";
  const orderId = text(form, "orderId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canManageShop);
    await moveOrderByClub(getDb(), { actor, orderId, verb });
    outcome = verb === "pay" ? { saved: "shopOrderPaid" } : verb === "handOver" ? { saved: "shopOrderHandedOver" } : { saved: "shopOrderCancelled" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(form, "/admin/shop/orders", outcome, `order-${orderId}`, ordersFilterOf(form));
}

/**
 * «Adaugă o comandă pentru un membru» (§690): the club places an order in a member's name. The door
 * asks `canManageShop` of the actor, like every shop verb — a holder of «Gestionează magazinul»
 * included (§687); the service asserts it and the member account again. A refusal returns, naming
 * its box (§315); a placed order lands on «Comenzi», on its row in the list, the filter kept, with a
 * toast.
 */
export async function placeOrderForMemberAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaffCapability(canManageShop);
    id = (
      await placeOrderForMember(getDb(), {
        actor,
        fields: {
          memberStaffUserId: text(form, "memberStaffUserId"),
          item: text(form, "item"),
          quantity: text(form, "quantity"),
          note: text(form, "note"),
          emailMember: text(form, "emailMember"),
          markPaid: text(form, "markPaid"),
        },
      })
    ).id;
  } catch (error) {
    return refused(error, form);
  }
  return backTo(form, "/admin/shop/orders", { saved: "shopOrderPlacedForMember" }, `order-${id}`, ordersFilterOf(form));
}
