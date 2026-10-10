"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cancelOwnOrder, placeOrder } from "@/modules/content/shop/orders";
import { SHOP_OUTCOMES, type ShopOutcome } from "@/modules/content/shop/zone-outcome";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The members' zone's two verbs (§NNN): «Comandă» and a member's own «Anulează comanda». The door is
 * the account (§524, `getCurrentAccount`) — the club's member accounts, never a participant account
 * (AGENTS.md §10.3) — and the service asserts `canOpenMembersZone` again, the shop's notice gate for
 * an order, and that a cancelled order is the member's own (BR-REQ-060-01). Each answer is a redirect
 * back to the zone with one language-neutral code in the address (`?shop=`), which the page turns into
 * a sentence; nothing typed travels in the URL.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function back(locale: Locale, outcome: ShopOutcome, anchor: string): never {
  redirect(`${getPathname({ locale, href: { pathname: "/members-area", query: { shop: outcome } } })}#${anchor}`);
}

function outcomeOf(error: unknown): ShopOutcome {
  if (!isDomainError(error)) throw error;
  return (SHOP_OUTCOMES as readonly string[]).includes(error.code) ? (error.code as ShopOutcome) : "FORBIDDEN";
}

/** Signed out — the session ended while the page was open: the sign-in, in the members' words, lands back here. */
async function accountOrSignIn(locale: Locale) {
  const account = await getCurrentAccount();
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  return account;
}

export async function placeShopOrderAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const account = await accountOrSignIn(locale);
  const db = getDb();
  const now = new Date();
  let outcome: ShopOutcome;
  try {
    await placeOrder(db, {
      account,
      locale,
      noticeDescribes: await noticeDescribesMembersShop(db, now),
      fields: {
        productId: text(form, "productId"),
        variantId: text(form, "variantId"),
        quantity: text(form, "quantity"),
        note: text(form, "note"),
      },
      now,
    });
    outcome = "placed";
  } catch (error) {
    outcome = outcomeOf(error);
  }
  back(locale, outcome, outcome === "placed" ? "members-orders" : "members-shop");
}

export async function cancelShopOrderAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const account = await accountOrSignIn(locale);
  let outcome: ShopOutcome;
  try {
    await cancelOwnOrder(getDb(), { account, orderId: text(form, "orderId") });
    outcome = "cancelled";
  } catch (error) {
    outcome = outcomeOf(error);
  }
  back(locale, outcome, "members-orders");
}
