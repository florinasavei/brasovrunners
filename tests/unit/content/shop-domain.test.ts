import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { describesMembersShop, MEMBERS_SHOP_MERGE_FIELD, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import {
  clubVerbsFor,
  currencyWordOf,
  formatPrice,
  minorAsTyped,
  nextOrderStatus,
  orderTotalBani,
  parsePriceToMinor,
  parseSizeChart,
  parseVariantLines,
  PRICE_BANI_MAX,
  readSizeChart,
  sizeChartRows,
  sizesAsForm,
  STANDARD_SIZES,
  stockAfterOrder,
  stockToSave,
  variantLinesAsTyped,
  variantsFromSizes,
  variantsInShopOrder,
  formatMeasure,
  measureAsTyped,
} from "@/modules/content/shop/domain";
import { orderForMemberFieldsSchema, productFieldsSchema } from "@/modules/content/shop/fields";
import { membersShopMergeValues } from "@/modules/content/shop/notice-words";
import { readShopOutcome } from "@/modules/content/shop/zone-outcome";
import { shopOrderLine, shopOrderLines } from "@/modules/notifications/shop-order-words";

/**
 * §683 — the members' shop, pure: the price in words, an order's total, the stock rule, which status
 * may follow which and for whom, the variants box, the privacy notice's marker that gates the shop
 * (BR-REQ-060-01: the member's verbs and the club's are different sets), and the email's lines.
 */
describe("§683, §686 the price, in lei or in euro", () => {
  it("is kept in the minor unit and read as people write it, a trailing currency word dropped", () => {
    expect(parsePriceToMinor("45")).toBe(4500);
    expect(parsePriceToMinor("45,5")).toBe(4550);
    expect(parsePriceToMinor("45.50")).toBe(4550);
    expect(parsePriceToMinor(" 45 lei ")).toBe(4500);
    expect(parsePriceToMinor("30,25")).toBe(3025);
    expect(parsePriceToMinor("30.25 €")).toBe(3025);
    expect(parsePriceToMinor("30€")).toBe(3000);
    expect(parsePriceToMinor("30 eur")).toBe(3000);
    expect(parsePriceToMinor("30 EURO")).toBe(3000);
    // A leading euro sign, with or without a space (§686).
    expect(parsePriceToMinor("€30")).toBe(3000);
    expect(parsePriceToMinor("€ 30,25")).toBe(3025);
    expect(parsePriceToMinor("0")).toBe(0);
    expect(parsePriceToMinor("100000")).toBe(PRICE_BANI_MAX);
    // The box never says the currency: a word that is not one is refused, not read as lei.
    for (const bad of ["", "-5", "30,255", "abc", "1e3", "45,", "9999999", "100000,01", "30 usd"]) expect(parsePriceToMinor(bad), bad).toBeNull();
  });

  it("is shown in its own currency — the minor part only when there is one, grouped the locale's way, never converted", () => {
    expect(formatPrice(4500, "RON", "ro")).toBe("45 lei");
    expect(formatPrice(4550, "RON", "ro")).toBe("45,50 lei");
    expect(formatPrice(4505, "RON", "en")).toBe("45.05 lei");
    expect(formatPrice(123400, "RON", "ro")).toBe("1.234 lei");
    // Euro: the sign after a no-break space in Romanian, before the amount in English.
    expect(formatPrice(3025, "EUR", "ro")).toBe("30,25\u00A0€");
    expect(formatPrice(3000, "EUR", "ro")).toBe("30\u00A0€");
    expect(formatPrice(3025, "EUR", "en")).toBe("€30.25");
    expect(formatPrice(3000, "EUR", "en")).toBe("€30");
    expect(formatPrice(123456, "EUR", "ro")).toBe("1.234,56\u00A0€");
    expect(formatPrice(123456, "EUR", "en")).toBe("€1,234.56");
    expect(minorAsTyped(4500)).toBe("45");
    expect(minorAsTyped(4550)).toBe("45,50");
    expect(orderTotalBani({ unitPriceBani: 4550, quantity: 3 })).toBe(13650);
  });

  it("reads the box's currency word for one purpose: refusing a price that contradicts «Moneda» (§686)", () => {
    expect(currencyWordOf("45")).toBeNull();
    expect(currencyWordOf("45 lei")).toBe("RON");
    expect(currencyWordOf("30 €")).toBe("EUR");
    expect(currencyWordOf("€30")).toBe("EUR");
    expect(currencyWordOf("30 eur")).toBe("EUR");
    expect(currencyWordOf("30 Euro")).toBe("EUR");
    const product = { titleRo: "Tricou", titleEn: "T-shirt", variants: "", stock: "" };
    const refused = (price: string, currency: string) => {
      const parsed = productFieldsSchema.safeParse({ ...product, price, currency });
      return parsed.success ? null : parsed.error.issues.map((issue) => issue.path.join("."));
    };
    // The word agrees, or there is none: fine. It contradicts the select: refused on the price box.
    expect(refused("45 lei", "RON")).toBeNull();
    expect(refused("€30", "EUR")).toBeNull();
    expect(refused("45", "EUR")).toBeNull();
    expect(refused("45 lei", "EUR")).toEqual(["price"]);
    expect(refused("30 €", "RON")).toEqual(["price"]);
    expect(refused("30 eur", "RON")).toEqual(["price"]);
    expect(refused("30 euro", "RON")).toEqual(["price"]);
    expect(refused("€30", "RON")).toEqual(["price"]);
    // Lei is what an absent select means: «30 €» with no select is a contradiction too.
    expect(refused("30 €", "")).toEqual(["price"]);
  });
});

describe("§690 the club's order for a member, as the fold posts it", () => {
  const product = "0f3a9f1e-6d1c-4e39-9d0b-7a8f2c4b5d61";
  const variant = "9b2d4c6e-8f1a-4b3c-a5d7-e9f0a1b2c3d4";
  const member = "6c1e2a3b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";

  it("splits the item into its product and variant, reads the ticks as a form posts them, and refuses a name or a half", () => {
    const parsed = orderForMemberFieldsSchema.parse({ memberStaffUserId: member.toUpperCase(), item: `${product}:${variant}`, quantity: "2", note: " Din tabel ", emailMember: "on" });
    expect(parsed).toEqual({ memberStaffUserId: member, productId: product, variantId: variant, quantity: 2, note: "Din tabel", emailMember: true, markPaid: false });
    const paths = (value: unknown) => {
      const result = orderForMemberFieldsSchema.safeParse(value);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(paths({ memberStaffUserId: "Membru A", item: `${product}:${variant}`, quantity: "1" })).toEqual(["memberStaffUserId"]);
    expect(paths({ memberStaffUserId: member, item: product, quantity: "1" })).toEqual(["item"]);
    expect(paths({ memberStaffUserId: member, item: `${product}:${variant}:x`, quantity: "1" })).toEqual(["item"]);
    expect(paths({ memberStaffUserId: member, item: `${product}:${variant}`, quantity: "0" })).toEqual(["quantity"]);
    expect(paths({ memberStaffUserId: member, item: `${product}:${variant}`, quantity: "6" })).toEqual(["quantity"]);
    expect(paths({ memberStaffUserId: member, item: `${product}:${variant}`, quantity: "1", note: "x".repeat(301) })).toEqual(["note"]);
  });
});

describe("§683 the stock", () => {
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

describe("§683 an order's status", () => {
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

describe("§683 the variants box", () => {
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

describe("§683 the privacy notice's marker gates the shop", () => {
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

describe("§683 the zone's outcome and the email's lines", () => {
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
    currency: "RON" as const,
    note: "Pentru sâmbătă",
    paymentRo: "IBAN RO00 TEST 0000 — sau numerar",
    paymentEn: "IBAN RO00 TEST 0000 — or cash",
    memberName: "Ana Exemplu",
  };

  it("says the order on one line and the payment words after the club's text, each half in its language", () => {
    expect(shopOrderLine("ro", order)).toBe("Comanda nr. 12: Tricou club — M × 2 — 90 lei");
    expect(shopOrderLine("en", order)).toBe("Order no. 12: Club t-shirt — M × 2 — 90 lei");
    // An order placed in euro reads in euro, whatever the product says now (§686).
    expect(shopOrderLine("ro", { ...order, unitPriceBani: 3025, currency: "EUR" })).toBe("Comanda nr. 12: Tricou club — M × 2 — 60,50\u00A0€");
    expect(shopOrderLine("en", { ...order, unitPriceBani: 3025, currency: "EUR" })).toBe("Order no. 12: Club t-shirt — M × 2 — €60.50");
    expect(shopOrderLines("ro", order, { payment: true })).toEqual(["Cum se plătește: IBAN RO00 TEST 0000 — sau numerar", "Nota comenzii: „Pentru sâmbătă”"]);
    expect(shopOrderLines("en", { ...order, paymentEn: null }, { payment: true })[0]).toBe("The club will tell you how to pay.");
    expect(shopOrderLines("en", { ...order, note: null }, { payment: false })).toEqual([]);
  });
});

describe("§NNN «Mărimile»: ticks in a fixed order, a stock each, the free labels after", () => {
  const form = { sizes: [] as string[], sizeStock: {} as Record<string, string>, oneSize: false, stock: "", extraVariants: "" };

  it("orders the ticked sizes XXS–4XL whatever order they were posted in, then «Mărime unică», then the free labels", () => {
    expect(STANDARD_SIZES).toEqual(["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"]);
    expect(variantsFromSizes({ ...form, sizes: ["4XL", "s", "M"], sizeStock: { S: "5", M: "", "4XL": "0" }, oneSize: true, stock: "2", extraVariants: "Copii: 3\nAlbastru" })).toEqual({
      ok: true,
      variants: [
        { label: "S", stock: 5 },
        { label: "M", stock: null },
        { label: "4XL", stock: 0 },
        { label: null, stock: 2 },
        { label: "Copii", stock: 3 },
        { label: "Albastru", stock: null },
      ],
    });
    // Nothing ticked and nothing typed is §683's one-variant product with the «Stoc» box.
    expect(variantsFromSizes({ ...form, stock: "7" })).toEqual({ ok: true, variants: [{ label: null, stock: 7 }] });
  });

  it("refuses an unknown tick, a bad stock, a free label that spells a size, and too many in all — naming the box", () => {
    expect(variantsFromSizes({ ...form, sizes: ["XXXL"] })).toEqual({ ok: false, path: "sizes", error: "unknownSize" });
    expect(variantsFromSizes({ ...form, sizes: ["M"], sizeStock: { M: "zece" } })).toEqual({ ok: false, path: "sizes", error: "stock" });
    expect(variantsFromSizes({ ...form, oneSize: true, stock: "-1" })).toEqual({ ok: false, path: "stock", error: "stock" });
    expect(variantsFromSizes({ ...form, extraVariants: "xl: 2" })).toEqual({ ok: false, path: "extraVariants", error: "standardAsExtra" });
    expect(variantsFromSizes({ ...form, sizes: [...STANDARD_SIZES], extraVariants: Array.from({ length: 12 }, (_, i) => `V${i}`).join("\n") })).toEqual({ ok: false, path: "extraVariants", error: "tooMany" });
  });

  it("opens the stored variants back as ticks, boxes and lines, and sorts any list into the shop's order", () => {
    const stored = [
      { label: "Copii", stock: 3 },
      { label: "M", stock: null },
      { label: null, stock: 2 },
      { label: "s", stock: 5 },
    ];
    expect(sizesAsForm(stored)).toEqual({ sizes: ["M", "S"], sizeStock: { M: "", S: "5" }, oneSize: true, stock: "2", extraVariants: "Copii: 3" });
    expect(variantsInShopOrder(stored).map((variant) => variant.label)).toEqual(["s", "M", null, "Copii"]);
  });
});

describe("§NNN «Tabelul de mărimi»: up to four named columns and a number per size", () => {
  const labels = ["S", "M", null, "Copii"];

  it("keeps a column named in both languages and a row for a variant's label with a number in it; drops the rest", () => {
    expect(
      parseSizeChart(
        { columns: [{ ro: " Lățime  piept (cm)", en: "Chest width (cm)" }, { ro: "", en: "" }, { ro: "Lungime (cm)", en: "Length (cm)" }], cells: { S: ["48", "", "66,5"], m: ["50", "", ""], XL: ["99", "", "99"], Copii: ["", "", ""] } },
        labels,
      ),
    ).toEqual({
      ok: true,
      chart: { columns: [{ ro: "Lățime piept (cm)", en: "Chest width (cm)" }, { ro: "Lungime (cm)", en: "Length (cm)" }], rows: { S: [48, 66.5], M: [50, null] } },
    });
    expect(parseSizeChart({ columns: [{ ro: "", en: "" }], cells: { S: ["48"] } }, labels)).toEqual({ ok: true, chart: null });
  });

  it("refuses a column in one language, a fifth column, a long name and a cell that is not a number", () => {
    expect(parseSizeChart({ columns: [{ ro: "Piept", en: "" }], cells: {} }, labels)).toEqual({ ok: false, error: "oneLanguage" });
    expect(parseSizeChart({ columns: Array.from({ length: 5 }, (_, i) => ({ ro: `C${i}`, en: `C${i}` })), cells: {} }, labels)).toEqual({ ok: false, error: "tooMany" });
    expect(parseSizeChart({ columns: [{ ro: "x".repeat(41), en: "Chest" }], cells: {} }, labels)).toEqual({ ok: false, error: "column" });
    expect(parseSizeChart({ columns: [{ ro: "Piept", en: "Chest" }], cells: { S: ["mult"] } }, labels)).toEqual({ ok: false, error: "cell" });
  });

  it("reads a stored chart leniently, lists its rows in the variants' order, and shows a measure the reader's way", () => {
    const chart = readSizeChart({ columns: [{ ro: "Piept", en: "Chest" }], rows: { M: [50.5], S: [48, 1], Copii: ["x"] } });
    expect(chart).toEqual({ columns: [{ ro: "Piept", en: "Chest" }], rows: { M: [50.5], S: [48], Copii: [null] } });
    expect(sizeChartRows(chart!, [{ label: "S" }, { label: "M" }, { label: null }, { label: "XL" }])).toEqual([
      { label: "S", cells: [48] },
      { label: "M", cells: [50.5] },
    ]);
    expect(readSizeChart({ columns: [], rows: {} })).toBeNull();
    expect(readSizeChart("nu")).toBeNull();
    expect(formatMeasure(50.5, "ro")).toBe("50,5");
    expect(formatMeasure(50.5, "en")).toBe("50.5");
    expect(measureAsTyped(66.5)).toBe("66,5");
    expect(measureAsTyped(null)).toBe("");
  });
});
