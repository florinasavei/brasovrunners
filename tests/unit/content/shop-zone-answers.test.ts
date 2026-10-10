import { describe, expect, it } from "vitest";
import { ordersFilterParams } from "@/modules/content/shop/repository";
import { readShopOutcome, readShopOutcomeAtOrders } from "@/modules/content/shop/zone-outcome";

// BR-REQ-060-01 — the members' shop: what a verb on the orders list carries back, and where the
// members' zone draws an answer (§NNN).
describe("the orders list keeps its filter across a verb", () => {
  const product = "0b6c1e9e-2f7a-4c1d-9a51-3e2f4d5c6b7a";

  it("keeps a status from the closed set and a product id that is a UUID", () => {
    const kept = ordersFilterParams({ orderStatus: "PAID", orderProduct: product.toUpperCase() });
    expect(kept.get("orderStatus")).toBe("PAID");
    expect(kept.get("orderProduct")).toBe(product);
  });

  it("drops a status outside the set and a product that is not a UUID", () => {
    const kept = ordersFilterParams({ orderStatus: "SHIPPED", orderProduct: "'; drop table shop_orders" });
    expect(kept.toString()).toBe("");
  });

  it("keeps the one valid half of a mixed filter", () => {
    expect(ordersFilterParams({ orderStatus: "nope", orderProduct: product }).toString()).toBe(`orderProduct=${product}`);
    expect(ordersFilterParams({ orderStatus: "PLACED", orderProduct: "" }).toString()).toBe("orderStatus=PLACED");
  });
});

describe("the members' zone draws a shop answer where the redirect lands", () => {
  it("reads the outcome strictly", () => {
    expect(readShopOutcome("CONFLICT")).toBe("CONFLICT");
    expect(readShopOutcome("anything")).toBeNull();
  });

  it("puts a cancel's answer in «Comenzile mele» only when the address says so", () => {
    expect(readShopOutcomeAtOrders("orders")).toBe(true);
    expect(readShopOutcomeAtOrders(["orders", "shop"])).toBe(true);
    expect(readShopOutcomeAtOrders("shop")).toBe(false);
    expect(readShopOutcomeAtOrders(undefined)).toBe(false);
  });
});
