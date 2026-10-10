import type { getTranslations } from "next-intl/server";
import type { RefusalMessages } from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * The product page's boxes by the names its forms post (§697), for the refusal summary (§315): the
 * four cards' boxes, «Mărimile» as one box (the card), the chart as one, and the picture forms' box.
 * One place for the new product's page and an existing product's.
 */
export function productRefusalMessages(t: Words): Promise<RefusalMessages> {
  return refusalMessages({
    titleRo: t("members.shop.titleRo"),
    titleEn: t("members.shop.titleEn"),
    descriptionRo: t("members.shop.descriptionRo"),
    descriptionEn: t("members.shop.descriptionEn"),
    descriptionRoBody: t("members.shop.descriptionRo"),
    descriptionEnBody: t("members.shop.descriptionEn"),
    price: t("members.shop.price"),
    variants: t("members.shop.extraVariants"),
    sizes: t("members.shop.sizesLegend"),
    stock: t("members.shop.oneSize"),
    extraVariants: t("members.shop.extraVariants"),
    chartColumns: t("members.shop.chart.title"),
    photoAssetId: t("members.shop.photo"),
  });
}
