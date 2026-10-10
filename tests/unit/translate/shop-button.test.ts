import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §697 — «Copiază și tradu tot: RO → EN» on the shop's forms (the product's, new and edit, and
 * «Setări»'s «Cum se plătește»), the way «Echipa» has it (§464, §482): drawn where the layout offers
 * translation, absent where it does not, in both languages. Since the editor's rebuild (§697) the
 * product's button sits at the top of «Denumirea și prețul», the first card of the product's form.
 */
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

const { default: ProductForm } = await import("@/modules/content/shop/ui/ProductForm");
const { default: ShopSettingsCard } = await import("@/modules/content/shop/ui/ShopSettingsCard");

const action: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });

const PRODUCT: AdminShopProduct = {
  id: "11111111-2222-3333-4444-555555555555",
  titleRo: "Tricou",
  titleEn: "T-shirt",
  descriptionRo: "Bumbac",
  descriptionEn: null,
  descriptionRoJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bumbac" }] }] },
  descriptionEnJson: null,
  priceBani: 5000,
  currency: "RON",
  photo: null,
  pictures: [],
  sizeChart: null,
  visible: true,
  position: 0,
  version: 1,
  variants: [],
  orders: 0,
};

function render(locale: "ro" | "en", offer: ComponentProps<typeof TranslateProvider>["offer"]) {
  const messages = locale === "en" ? en : ro;
  const words = createTranslator({ locale, messages: messages.Admin as unknown as Record<string, string>, namespace: undefined });
  const rich = richTextEditorLabels(createTranslator({ locale, messages: messages.Admin.richText as unknown as Record<string, string>, namespace: undefined }) as never);
  const common = { locale, words: words as never, cancel: "Cancel", messages: { fieldError: "", summary: "", fields: {} } as never };
  // «Cum se plătește», «Adaugă un produs» and the one product's edit form — the three forms the shop has.
  const forms: ReactNode[] = [
    ShopSettingsCard({ ...common, settings: { paymentRo: "Transfer", paymentEn: null, ordersTo: null }, mayManage: true }),
    ProductForm({ ...common, product: null, rich, noticeDescribes: true }),
    ProductForm({ ...common, product: PRODUCT, rich, noticeDescribes: true }),
  ];
  const intl = { locale, messages: { Translate: messages.Translate } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, ...forms)));
}

describe("§697 the shop's forms carry «Copiază și tradu tot»", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`draws one button in each of the three forms, in ${locale}`, () => {
      const html = render(locale, { action, setupHref: null });
      expect((html.match(/data-testid="translate-all"/g) ?? []).length).toBe(3);
      expect(html).toContain((locale === "en" ? en : ro).Translate.all);
      // The boxes the press fills: the title, the rich description's English document, the payment words.
      for (const name of ["titleEn", "descriptionEnBody", "paymentEn"]) expect(html).toContain(`name="${name}"`);
    });
  }

  it("draws it greyed, with its reason, on a deployment without the key, and nothing for a role that may not", () => {
    expect(render("ro", { action: null, setupHref: null })).toContain('data-translate-state="off"');
    expect(render("ro", null)).not.toContain('data-testid="translate-all"');
  });
});
