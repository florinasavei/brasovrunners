import type { getTranslations } from "next-intl/server";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { photoFieldLabels } from "@/modules/content/team/ui/photo-field-labels";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * The words «Echipa»'s picture field needs when it takes an event's cover (the facelift's phase 2,
 * §709; the field as the shop reused it, §705): the house's one set (`photoFieldLabels`) with the
 * cover's own legend, help and crop captions.
 */
export function coverPhotoLabels(t: Words, rich: ReturnType<typeof richTextEditorLabels>): TeamPhotoLabels {
  return photoFieldLabels(t, rich, {
    legend: t("editor.cover.legend"),
    help: t("editor.cover.help"),
    cropTitle: t("editor.cover.cropTitle"),
    cropHelp: t("editor.cover.cropHelp"),
  });
}
