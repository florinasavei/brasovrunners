import type { getTranslations } from "next-intl/server";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { photoFieldLabels } from "@/modules/content/team/ui/photo-field-labels";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * The words «Echipa»'s picture field needs when it takes a product's picture (§683, §541, §697):
 * the house's one set (`photoFieldLabels`) with the shop's own legend, help and crop captions. One
 * place for the product page's add form and each picture's replace form.
 */
export function shopPhotoLabels(
  t: Words,
  rich: ReturnType<typeof richTextEditorLabels>,
  legend: string,
  /** The size guide's own captions: it is kept with the product's save and starts whole, which the strip's help does not say. */
  override: { help: string; cropHelp: string } | null = null,
): TeamPhotoLabels {
  return photoFieldLabels(t, rich, {
    legend,
    help: override?.help ?? t("members.shop.photoHelp"),
    cropTitle: t("members.shop.photoCrop"),
    cropHelp: override?.cropHelp ?? t("members.shop.photoCropHelp"),
  });
}
