import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §692 — «Copiază și tradu tot: RO → EN» on the shop's two forms (the product's, new and edit, and
 * «Cum se plătește»), the way «Echipa» has it (§464, §482): drawn where the layout offers
 * translation, absent where it does not, in both languages.
 */
vi.mock("@/app/[locale]/admin/pages/members/actions", () => ({
  createShopProductAction: async () => {},
  deleteShopProductAction: async () => {},
  moveShopOrderAction: async () => {},
  moveShopProductAction: async () => {},
  placeOrderForMemberAction: async () => {},
  saveShopProductAction: async () => {},
  saveShopSettingsAction: async () => {},
}));

const { default: ShopCard } = await import("@/app/[locale]/admin/pages/members/ShopCard");

const action: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });

const PRODUCT: AdminShopProduct = {
  id: "11111111-2222-3333-4444-555555555555",
  titleRo: "Tricou",
  titleEn: "T-shirt",
  descriptionRo: "Bumbac",
  descriptionEn: null,
  priceBani: 5000,
  currency: "RON",
  photoAssetId: null,
  photo: null,
  visible: true,
  position: 0,
  version: 1,
  variants: [],
  orders: 0,
};

function render(locale: "ro" | "en", offer: ComponentProps<typeof TranslateProvider>["offer"]) {
  const messages = locale === "en" ? en : ro;
  const words = createTranslator({ locale, messages: messages.Admin as unknown as Record<string, string>, namespace: undefined });
  const card = ShopCard({
    products: [PRODUCT],
    settings: { paymentRo: "Transfer", paymentEn: null, ordersTo: null },
    orders: [],
    ordersTotal: 0,
    ordersQuery: { status: null, productId: null },
    productNames: [],
    accounts: [],
    items: [],
    noticeDescribes: true,
    storage: false,
    path: "/ro/admin/shop",
    locale,
    words: words as never,
    cancel: "Cancel",
    messages: { fieldError: "", summary: "", fields: {} } as never,
    photoLabels: {} as unknown as TeamPhotoLabels,
    mayManage: true,
    showEmail: false,
  });
  const intl = { locale, messages: { Translate: messages.Translate } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, card)));
}

describe("§692 the shop's forms carry «Copiază și tradu tot»", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`draws one button in each of the three forms, in ${locale}`, () => {
      const html = render(locale, { action, setupHref: null });
      // «Cum se plătește», «Adaugă un produs» and the one product's edit form.
      expect((html.match(/data-testid="translate-all"/g) ?? []).length).toBe(3);
      expect(html).toContain((locale === "en" ? en : ro).Translate.all);
      for (const name of ["titleEn", "descriptionEn", "paymentEn"]) expect(html).toContain(`name="${name}"`);
    });
  }

  it("draws it greyed, with its reason, on a deployment without the key, and nothing for a role that may not", () => {
    expect(render("ro", { action: null, setupHref: null })).toContain('data-translate-state="off"');
    expect(render("ro", null)).not.toContain('data-testid="translate-all"');
  });
});
