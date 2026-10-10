import { and, desc, eq, gte, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { type ShopOrder, type ShopOrderStatus, shopOrders, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canManageShop, canOpenMembersZone, type StaffActor } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { nextOrderStatus, ORDER_REPEAT_WINDOW_MS, type OrderActor, type OrderVerb, stockAfterOrder } from "./domain";
import { orderFieldsSchema, orderForMemberFieldsSchema } from "./fields";
import { readShopSettings } from "./settings";

/**
 * The members' shop's orders (§683). A member orders from the members' zone, behind their own
 * account (§524, §662 — never a participant account, AGENTS.md §10.3); an Administrator marks the
 * order paid, handed over, or cancels it — and, since §NNN, places an order in a member's name
 * («Adaugă o comandă pentru un membru»: the sheet the club collected outside the site, typed in).
 * Payment is outside the site: nothing here takes, stores or sends a card number or a sum to anyone.
 *
 * **Never oversold.** A variant with a stock is locked (`SELECT … FOR UPDATE`) in the order's own
 * transaction, its count checked and lowered there, and the order written in the same commit: two
 * members ordering the last one at once queue on the row, and the second reads what the first left
 * (`tests/concurrency/shop-stock.test.ts`). The check constraint refuses a negative stock whatever
 * the code does. A cancellation gives back exactly what the order took (`stock_taken`), under the
 * same lock. Every writer locks product, then variant, then order (`moveOrder`). The same order
 * pressed twice within `ORDER_REPEAT_WINDOW_MS` is answered with the first, read under the variant's
 * lock, so a double tap takes, audits and sends once. **One sequence of locks, in `insertOrder`**:
 * the member's «Comandă» and the club's «Adaugă o comandă pentru un membru» are two doors into it,
 * never a second copy of it.
 *
 * Every write asserts its role here (BR-REQ-060-01) and leaves an audit row with the order's id and
 * its move — never the note, a title, a name or an address. The emails are queued in the same
 * transaction (BR-REQ-080-02).
 */

type Account = Pick<StaffUser, "id" | "role" | "displayName" | "email">;
type Actor = Pick<StaffUser, "id"> & StaffActor;

/** The idempotency key of one message about one order: once per order and per fact. */
export function shopOrderEmailKey(orderId: string, what: "placed" | "paid" | "club"): string {
  return `shop-order:${orderId}:${what}`;
}

function parseOrThrow<Out>(schema: z.ZodType<Out>, value: unknown): Out {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

/**
 * One order's facts, whichever door it came through: the member it is for (the name and the language
 * copied onto the row, the address the confirmation goes to), what is ordered, who is placing it and
 * what to send. `onlyVisible` is the member's door — the zone offers visible products alone; the club
 * types its sheet against any product not archived (§NNN).
 */
type OrderCore = {
  member: Pick<StaffUser, "id" | "displayName" | "email">;
  locale: "ro" | "en";
  productId: string;
  variantId: string;
  quantity: number;
  note: string | null;
  onlyVisible: boolean;
  placedBy: OrderActor;
  /** The account acting — the member's own, or the colleague's; audited, and named on the emails it queues. */
  actor: Actor;
  emailMember: boolean;
  emailClub: boolean;
  /** The club's tick «Marchează direct ca plătită», for its audit row alone: the move itself is the caller's, after the insert. */
  paidAtOnce: boolean;
  now: Date;
};

/**
 * The one sequence every order goes through (§683, §NNN): the product share-locked, the variant
 * locked, the repeat answered, the stock taken, the row written with its copies, the audit row, the
 * emails as flags. Returns the order and whether it was placed now or found as a repeat — a repeat
 * is already placed, paid or not, and the caller leaves it as it is.
 */
async function insertOrder<T extends Record<string, unknown>>(tx: Transaction<T>, core: OrderCore): Promise<{ order: ShopOrder; repeat: boolean }> {
  const { now } = core;
  // The product first, share-locked — the order every writer takes, product then variant: a delete
  // (which locks the product to count its orders) waits for this order or this order waits for the
  // delete and then finds no product, never a deadlock and never an order on a product just deleted.
  // Orders share the lock with each other; the variant's own lock is what queues them.
  const productWhere: SQL[] = [eq(shopProducts.id, core.productId), isNull(shopProducts.archivedAt)];
  if (core.onlyVisible) productWhere.push(eq(shopProducts.visible, true));
  const [product] = await tx
    .select()
    .from(shopProducts)
    .where(and(...productWhere))
    .for("share");
  if (!product) throw new DomainError("NOT_FOUND", "no such product in the shop");
  // Then the variant, locked: the stock is read and lowered under this lock alone.
  const [variant] = await tx
    .select()
    .from(shopProductVariants)
    .where(and(eq(shopProductVariants.id, core.variantId), eq(shopProductVariants.productId, core.productId)))
    .for("update");
  if (!variant) throw new DomainError("NOT_FOUND", "no such product in the shop");

  // The same press twice — a double tap, a form sent again — is one order. Read under the variant's
  // lock, so a repeat racing the first waits for it and then sees it (each statement reads what was
  // committed before it, READ COMMITTED): the order already placed is the answer, and nothing is
  // taken, audited or sent again. The club's press for a member counts the same way (§NNN).
  const [repeat] = await tx
    .select()
    .from(shopOrders)
    .where(
      and(
        eq(shopOrders.memberStaffUserId, core.member.id),
        eq(shopOrders.variantId, variant.id),
        eq(shopOrders.quantity, core.quantity),
        sql`${shopOrders.note} IS NOT DISTINCT FROM ${core.note}`,
        ne(shopOrders.status, "CANCELLED"),
        gte(shopOrders.createdAt, new Date(now.getTime() - ORDER_REPEAT_WINDOW_MS)),
      ),
    )
    .orderBy(desc(shopOrders.createdAt))
    .limit(1);
  if (repeat) return { order: repeat, repeat: true };

  const left = stockAfterOrder(variant.stock, core.quantity);
  if (left === "insufficient") throw new DomainError("CONFLICT", "fewer left than ordered");
  if (left !== null) {
    await tx.update(shopProductVariants).set({ stock: left, updatedAt: now }).where(eq(shopProductVariants.id, variant.id));
  }

  const [order] = await tx
    .insert(shopOrders)
    .values({
      memberStaffUserId: core.member.id,
      memberName: core.member.displayName,
      locale: core.locale,
      productId: product.id,
      variantId: variant.id,
      productTitleRo: product.titleRo,
      productTitleEn: product.titleEn,
      variantLabel: variant.label,
      quantity: core.quantity,
      unitPriceBani: product.priceBani,
      // The currency travels with the price, read under the same locks (§686): a product priced in
      // euro today and in lei tomorrow leaves this order in euro.
      currency: product.currency,
      stockTaken: left !== null,
      note: core.note,
      placedBy: core.placedBy,
      placedByStaffUserId: core.placedBy === "CLUB" ? core.actor.id : null,
      status: "PLACED",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (core.placedBy === "CLUB") {
    await recordAuditEvent(tx, {
      actorStaffUserId: core.actor.id,
      action: "shop.order.placed_by_club",
      entityType: "shop_order",
      entityId: order.id,
      metadata: {
        orderId: order.id,
        memberStaffUserId: core.member.id,
        productId: product.id,
        variantId: variant.id,
        quantity: order.quantity,
        paidAtOnce: core.paidAtOnce,
        emailed: core.emailMember,
      },
      now,
    });
  } else {
    await recordAuditEvent(tx, {
      actorStaffUserId: core.actor.id,
      action: "shop.order.placed",
      entityType: "shop_order",
      entityId: order.id,
      metadata: { productId: product.id, quantity: order.quantity, stockTaken: order.stockTaken, note: order.note !== null },
      now,
    });
  }
  if (core.emailMember) {
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "SHOP_ORDER_PLACED",
      locale: core.locale,
      recipientEmail: core.member.email,
      payload: { orderId: order.id },
      idempotencyKey: shopOrderEmailKey(order.id, "placed"),
      ...(core.placedBy === "CLUB" ? { requestedByStaffUserId: core.actor.id } : {}),
      now,
    });
  }
  // The club's notice, when the club named a mailbox; the list says the same either way.
  if (core.emailClub) {
    const settings = await readShopSettings(tx);
    if (settings.ordersTo) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "SHOP_ORDER_CLUB_NOTICE",
        locale: "ro",
        recipientEmail: settings.ordersTo,
        payload: { orderId: order.id },
        idempotencyKey: shopOrderEmailKey(order.id, "club"),
        now,
      });
    }
  }
  return { order, repeat: false };
}

/**
 * A member's order. `noticeDescribes` is the gate the zone reads (§683, the §562 pattern): until the
 * privacy notice in force names `{{membersShop}}` in every language, the action refuses the order as
 * the zone shows no shop — the caller reads it (`noticeDescribesMembersShop`) and passes it in.
 */
export async function placeOrder<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { account: Account; fields: unknown; locale: "ro" | "en"; noticeDescribes: boolean; now?: Date },
): Promise<ShopOrder> {
  if (!canOpenMembersZone(input.account.role)) throw new DomainError("FORBIDDEN", `role ${input.account.role} may not order from the members' shop`);
  if (!input.noticeDescribes) throw new DomainError("NOT_FOUND", "the shop is closed until the privacy notice in force describes it");
  const fields = parseOrThrow(orderFieldsSchema, input.fields);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { order } = await insertOrder(tx, {
      member: input.account,
      locale: input.locale,
      productId: fields.productId,
      variantId: fields.variantId,
      quantity: fields.quantity,
      note: fields.note,
      onlyVisible: true,
      placedBy: "MEMBER",
      actor: input.account,
      emailMember: true,
      emailClub: true,
      paidAtOnce: false,
      now,
    });
    return order;
  });
}

/**
 * «Adaugă o comandă pentru un membru» (§NNN): the club places an order in a member's name — the
 * sheet it collected outside the site, typed in by a colleague who checks each row. The same
 * `insertOrder` as the member's own «Comandă»: the same locks, the same stock rule, the same repeat
 * window; marked `placed_by = CLUB` with the colleague's account, audited as
 * `shop.order.placed_by_club`. The member is told («Comanda ta a fost primită») only when the
 * colleague ticks it; the club's own notice is never sent for its own press. Ticked «Marchează
 * direct ca plătită», the order moves to PAID through the one transition (`nextOrderStatus`, by
 * `moveOrder`) in the same transaction, audited `shop.order.paid`, and «Comanda ta e plătită» is
 * queued only with the first tick.
 *
 * The order is a member account's record (§683): an id that names no account, or an account whose
 * role may not open the members' zone, is refused — never a free-text name.
 */
export async function placeOrderForMember<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<ShopOrder> {
  if (!canManageShop(input.actor)) throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not place an order for a member`);
  const fields = parseOrThrow(orderForMemberFieldsSchema, input.fields);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: staffUsers.id, role: staffUsers.role, displayName: staffUsers.displayName, email: staffUsers.email, preferredLocale: staffUsers.preferredLocale })
      .from(staffUsers)
      .where(eq(staffUsers.id, fields.memberStaffUserId))
      .limit(1);
    if (!member || !canOpenMembersZone(member.role)) throw new DomainError("FORBIDDEN", "an order is placed for a member account only", ["memberStaffUserId"]);
    const placed = await insertOrder(tx, {
      member,
      locale: member.preferredLocale,
      productId: fields.productId,
      variantId: fields.variantId,
      quantity: fields.quantity,
      note: fields.note,
      onlyVisible: false,
      placedBy: "CLUB",
      actor: input.actor,
      emailMember: fields.emailMember,
      emailClub: false,
      paidAtOnce: fields.markPaid,
      now,
    });
    // A repeat is the order already placed — and already paid, if it was: the tick does not move it again.
    if (placed.repeat || !fields.markPaid) return placed.order;
    // Paid at once, in the same transaction: `moveOrder` takes product, variant and order in the
    // writers' order — all three already held by this transaction, which inserted the order row
    // above (re-locking a row one's own transaction holds queues on nothing) — and moves it through
    // `nextOrderStatus(PLACED, "pay", "CLUB")`, never by writing PAID by hand.
    const { order } = await moveOrder(tx, { actorId: input.actor.id, orderId: placed.order.id, verb: "pay", by: "CLUB", now });
    if (fields.emailMember) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "SHOP_ORDER_PAID",
        locale: order.locale,
        recipientEmail: member.email,
        payload: { orderId: order.id },
        idempotencyKey: shopOrderEmailKey(order.id, "paid"),
        requestedByStaffUserId: input.actor.id,
        now,
      });
    }
    return order;
  });
}

const VERB_AUDIT = { pay: "shop.order.paid", handOver: "shop.order.handed_over", cancel: "shop.order.cancelled" } as const;

/**
 * One move of one order, locked, with the stock given back on a cancellation that took some.
 *
 * **The lock order is every shop writer's: product, then variant, then order.** An order placed locks
 * the product (shared) and the variant; a product saved updates the product, locks its variants and
 * deletes a variant no longer listed — whose `ON DELETE SET NULL` then writes the orders that name it;
 * a product deleted locks the product and cascades the same way. Locking the order first and the
 * variant after, as a cancellation that gives stock back would, closes a cycle with that save
 * (a 40P01, answered as a 500). So the order's product and variant are read unlocked, those two
 * are locked in the common order, and only then the order — re-read under its lock, its status and
 * its two ids checked again: a variant deleted in between leaves the order without one, and nothing
 * to give back to.
 */
async function moveOrder<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: { actorId: string; orderId: string; verb: OrderVerb; by: OrderActor; ownerId?: string; now: Date },
): Promise<{ order: ShopOrder; from: ShopOrderStatus }> {
  // A member's own door names only their own orders: anybody else's is "no such order", never "not yours".
  const owned = (row: Pick<ShopOrder, "memberStaffUserId"> | undefined) =>
    row !== undefined && (input.ownerId === undefined || row.memberStaffUserId === input.ownerId);
  const [seen] = await tx
    .select({ productId: shopOrders.productId, variantId: shopOrders.variantId, memberStaffUserId: shopOrders.memberStaffUserId })
    .from(shopOrders)
    .where(eq(shopOrders.id, input.orderId))
    .limit(1);
  if (!seen || !owned(seen)) throw new DomainError("NOT_FOUND", "no such order");
  if (seen.productId) await tx.select({ id: shopProducts.id }).from(shopProducts).where(eq(shopProducts.id, seen.productId)).for("share");
  if (seen.variantId) await tx.select({ id: shopProductVariants.id }).from(shopProductVariants).where(eq(shopProductVariants.id, seen.variantId)).for("update");
  const [current] = await tx.select().from(shopOrders).where(eq(shopOrders.id, input.orderId)).for("update");
  if (!current || !owned(current)) throw new DomainError("NOT_FOUND", "no such order");
  // The ids only ever go to null (a delete's SET NULL), never to another row; anything else is a move to try again.
  if ((current.productId !== null && current.productId !== seen.productId) || (current.variantId !== null && current.variantId !== seen.variantId)) {
    throw new DomainError("CONFLICT", "the order changed while it was read");
  }
  const next = nextOrderStatus(current.status, input.verb, input.by);
  if (next === null) throw new DomainError("CONFLICT", `an order ${current.status} cannot ${input.verb}`);

  if (next === "CANCELLED" && current.stockTaken && current.variantId) {
    // Given back under the variant's lock; a variant made unlimited since keeps no count to return to.
    await tx
      .update(shopProductVariants)
      .set({ stock: sql`${shopProductVariants.stock} + ${current.quantity}`, updatedAt: input.now })
      .where(and(eq(shopProductVariants.id, current.variantId), sql`${shopProductVariants.stock} IS NOT NULL`));
  }
  const [order] = await tx
    .update(shopOrders)
    .set({
      status: next,
      ...(next === "PAID" ? { paidAt: input.now } : {}),
      ...(next === "HANDED_OVER" ? { handedOverAt: input.now } : {}),
      ...(next === "CANCELLED"
        ? { cancelledAt: input.now, cancelledBy: input.by, cancelledByStaffUserId: input.actorId, stockTaken: false }
        : {}),
      updatedAt: input.now,
    })
    .where(eq(shopOrders.id, current.id))
    .returning();
  await recordAuditEvent(tx, {
    actorStaffUserId: input.actorId,
    action: VERB_AUDIT[input.verb],
    entityType: "shop_order",
    entityId: order.id,
    metadata: { from: current.status, to: next, by: input.by, stockReturned: next === "CANCELLED" && current.stockTaken },
    now: input.now,
  });
  return { order, from: current.status };
}

/**
 * «Marchează plătită», «Marchează predată», «Anulează» — the club's verbs, the Administrator's
 * (`canManageShop`). Marked paid, the member is told («Comanda ta e plătită»), in the language they
 * ordered in, at their account's address — none when the account is gone.
 */
export async function moveOrderByClub<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; orderId: string; verb: OrderVerb; now?: Date },
): Promise<ShopOrder> {
  if (!canManageShop(input.actor)) throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change an order`);
  if (!isUuid(input.orderId)) throw new DomainError("NOT_FOUND", "no such order");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { order } = await moveOrder(tx, { actorId: input.actor.id, orderId: input.orderId, verb: input.verb, by: "CLUB", now });
    if (order.status === "PAID" && order.memberStaffUserId) {
      const [member] = await tx.select({ email: staffUsers.email }).from(staffUsers).where(eq(staffUsers.id, order.memberStaffUserId)).limit(1);
      if (member) {
        await enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "SHOP_ORDER_PAID",
          locale: order.locale,
          recipientEmail: member.email,
          payload: { orderId: order.id },
          idempotencyKey: shopOrderEmailKey(order.id, "paid"),
          requestedByStaffUserId: input.actor.id,
          now,
        });
      }
    }
    return order;
  });
}

/** A member cancels their own order, while it is only placed; the stock it took goes back. */
export async function cancelOwnOrder<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { account: Pick<StaffUser, "id" | "role">; orderId: string; now?: Date },
): Promise<ShopOrder> {
  if (!canOpenMembersZone(input.account.role)) throw new DomainError("FORBIDDEN", `role ${input.account.role} has no orders`);
  if (!isUuid(input.orderId)) throw new DomainError("NOT_FOUND", "no such order");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { order } = await moveOrder(tx, { actorId: input.account.id, orderId: input.orderId, verb: "cancel", by: "MEMBER", ownerId: input.account.id, now });
    return order;
  });
}
