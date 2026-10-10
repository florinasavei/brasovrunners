import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { describesMembersShop, MEMBERS_SHOP_MERGE_FIELD, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import {
  baniAsTyped,
  clubVerbsFor,
  formatLei,
  nextOrderStatus,
  orderTotalBani,
  parseLeiToBani,
  parseVariantLines,
  stockAfterOrder,
  stockToSave,
  variantLinesAsTyped,
} from "@/modules/content/shop/domain";
import { membersShopMergeValues } from "@/modules/content/shop/notice-words";
import { readShopOutcome } from "@/modules/content/shop/zone-outcome";
import { shopOrderLine, shopOrderLines } from "@/modules/notifications/shop-order-words";

/**
 * §NNN — the members' shop, pure: the price in words, an order's total, the stock rule, which status
 * may follow which and for whom, the variants box, the privacy notice's marker that gates the shop
 * (BR-REQ-060-01: the member's verbs and the club's are different sets), and the email's lines.
 */
describe("§NNN the price in lei", () => {
  it("is kept in bani and read as people write it", () => {
    expect(parseLeiToBani("45")).toBe(4500);
    expect(parseLeiToBani("45,5")).toBe(4550);
    expect(parseLeiToBani("45.50")).toBe(4550);
    expect(parseLeiToBani(" 45 lei ")).toBe(4500);
    expect(parseLeiToBani("0")).toBe(0);
    for (const bad of ["", "-5", "45,505", "abc", "1e3", "45,", "9999999"]) expect(parseLeiToBani(bad), bad).toBeNull();
  });

  it("is shown «45 lei», with bani only when there are some", () => {
    expect(formatLei(4500, "ro")).toBe("45 lei");
    expect(formatLei(4550, "ro")).toBe("45,50 lei");
    expect(formatLei(4505, "en")).toBe("45.05 lei");
    expect(baniAsTyped(4500)).toBe("45");
    expect(baniAsTyped(4550)).toBe("45,50");
    expect(orderTotalBani({ unitPriceBani: 4550, quantity: 3 })).toBe(13650);
  });
});

describe("§NNN the stock", () => {
  it("is taken whole or not at all, and an unlimited variant takes nothing", () => {
    expect(stockAfterOrder(null, 5)).toBeNull();
    expect(stockAfterOrder(3, 3)).toBe(0);
    expect(stockAfterOrder(2, 3)).toBe("insufficient");
    expect(stockAfterOrder(0, 1)).toBe("insufficient");
  });

  it("a save that did not touch a number keeps the stock as it stands now — an order placed meanwhile is not undone", () => {
    // Loaded 10, an order took 2 (now 8), the Administrator left 10 in the box: 8 stays.
    expect(stockToSave(10, 10, 8)).toBe(8);
    // Typed 20: the typed number.
    expect(stockToSave(20, 10, 8)).toBe(20);
    // A new variant: the typed number.
    expect(stockToSave(5, undefined, null)).toBe(5);
    expect(stockToSave(null, 4, 2)).toBeNull();
  });
});

describe("§NNN an order's status", () => {
  it("is paid and handed over by the club only, handed over only once paid", () => {
    expect(nextOrderStatus("PLACED", "pay", "CLUB")).toBe("PAID");
    expect(nextOrderStatus("PLACED", "pay", "MEMBER")).toBeNull();
    expect(nextOrderStatus("PAID", "handOver", "CLUB")).toBe("HANDED_OVER");
    expect(nextOrderStatus("PLACED", "handOver", "CLUB")).toBeNull();
    expect(nextOrderStatus("PAID", "handOver", "MEMBER")).toBeNull();
  });

  it("is cancelled by the member while only placed, by the club until the hand-over, and never after", () => {
    expect(nextOrderStatus("PLACED", "cancel", "MEMBER")).toBe("CANCELLED");
    expect(nextOrderStatus("PAID", "cancel", "MEMBER")).toBeNull();
    expect(nextOrderStatus("PAID", "cancel", "CLUB")).toBe("CANCELLED");
    expect(nextOrderStatus("HANDED_OVER", "cancel", "CLUB")).toBeNull();
    expect(nextOrderStatus("CANCELLED", "cancel", "CLUB")).toBeNull();
    expect(nextOrderStatus("CANCELLED", "pay", "CLUB")).toBeNull();
  });

  it("offers the club only the verbs that may follow", () => {
    expect(clubVerbsFor("PLACED")).toEqual(["pay", "cancel"]);
    expect(clubVerbsFor("PAID")).toEqual(["handOver", "cancel"]);
    expect(clubVerbsFor("HANDED_OVER")).toEqual([]);
    expect(clubVerbsFor("CANCELLED")).toEqual([]);
  });
});

describe("§NNN the variants box", () => {
  it("reads one variant per line with an optional stock, and the «Stoc» box when empty", () => {
    expect(parseVariantLines("S\nM: 10\n\nXL: 0", "")).toEqual({
      ok: true,
      variants: [
        { label: "S", stock: null },
        { label: "M", stock: 10 },
        { label: "XL", stock: 0 },
      ],
    });
    expect(parseVariantLines("", "7")).toEqual({ ok: true, variants: [{ label: null, stock: 7 }] });
    expect(parseVariantLines("  ", "")).toEqual({ ok: true, variants: [{ label: null, stock: null }] });
  });

  it("refuses a duplicate label, a bad stock, a long label and too many lines", () => {
    expect(parseVariantLines("M\nm", "")).toEqual({ ok: false, error: "duplicate" });
    expect(parseVariantLines("M: -1", "")).toEqual({ ok: false, error: "stock" });
    expect(parseVariantLines("M: 1: 2", "")).toEqual({ ok: false, error: "format" });
    expect(parseVariantLines("x".repeat(21), "")).toEqual({ ok: false, error: "label" });
    expect(parseVariantLines(Array.from({ length: 21 }, (_, i) => `V${i}`).join("\n"), "")).toEqual({ ok: false, error: "tooMany" });
    expect(parseVariantLines("", "abc")).toEqual({ ok: false, error: "stock" });
  });

  it("writes the variants back as the box shows them", () => {
    expect(variantLinesAsTyped([{ label: null, stock: 4 }])).toEqual({ lines: "", singleStock: "4" });
    expect(variantLinesAsTyped([{ label: "M", stock: 10 }, { label: "L", stock: null }])).toEqual({ lines: "M: 10\nL", singleStock: "" });
  });
});

describe("§NNN the privacy notice's marker gates the shop", () => {
  it("is named in section 5 of both templates, and read by the gate", () => {
    expect(MEMBERS_SHOP_MERGE_FIELD).toBe("membersShop");
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesMembersShop(body)).toBe(true);
      const section = body.sections.find((candidate) => candidate.paragraphs.some((paragraph) => paragraph.includes("{{membersShop}}")));
      expect(section?.heading?.startsWith("5.")).toBe(true);
      const paragraph = section!.paragraphs.find((candidate) => candidate.includes("{{membersShop}}"))!;
      // What, why (6(1)(b)), that payment is outside the site, how long.
      expect(paragraph).toContain("6(1)(b)");
      expect(paragraph).toMatch(/card/);
    }
    expect(describesMembersShop({ sections: [{ heading: "5.", paragraphs: ["Nimic despre magazin."] }] })).toBe(false);
    expect(describesMembersShop("not a body")).toBe(false);
  });

  it("is filled with the zone section's own name, quoted, in each language", () => {
    expect(membersShopMergeValues("ro")).toEqual({ membersShop: `„${ro.Members.shop.title}”` });
    expect(membersShopMergeValues("en")).toEqual({ membersShop: `“${en.Members.shop.title}”` });
    expect(mergeText("Magazinul ({{membersShop}})", membersShopMergeValues("ro"))).toBe("Magazinul („Magazinul clubului”)");
  });

  it("the legal editor's legend names the marker in both languages", () => {
    expect(ro.Admin.legal.tokens.membersShop).toContain("Magazinul clubului");
    expect(en.Admin.legal.tokens.membersShop).toContain("The club's shop");
  });
});

describe("§NNN the zone's outcome and the email's lines", () => {
  it("reads only a code of the closed set from the address", () => {
    expect(readShopOutcome("placed")).toBe("placed");
    expect(readShopOutcome(["CONFLICT", "x"])).toBe("CONFLICT");
    expect(readShopOutcome("<script>")).toBeNull();
    expect(readShopOutcome(undefined)).toBeNull();
  });

  const order = {
    number: 12,
    titleRo: "Tricou club",
    titleEn: "Club t-shirt",
    variant: "M",
    quantity: 2,
    unitPriceBani: 4500,
    note: "Pentru sâmbătă",
    paymentRo: "IBAN RO00 TEST 0000 — sau numerar",
    paymentEn: "IBAN RO00 TEST 0000 — or cash",
    memberName: "Ana Exemplu",
  };

  it("says the order on one line and the payment words after the club's text, each half in its language", () => {
    expect(shopOrderLine("ro", order)).toBe("Comanda nr. 12: Tricou club — M × 2 — 90 lei");
    expect(shopOrderLine("en", order)).toBe("Order no. 12: Club t-shirt — M × 2 — 90 lei");
    expect(shopOrderLines("ro", order, { payment: true })).toEqual(["Cum se plătește: IBAN RO00 TEST 0000 — sau numerar", "Nota comenzii: „Pentru sâmbătă”"]);
    expect(shopOrderLines("en", { ...order, paymentEn: null }, { payment: true })[0]).toBe("The club will tell you how to pay.");
    expect(shopOrderLines("en", { ...order, note: null }, { payment: false })).toEqual([]);
  });
});
