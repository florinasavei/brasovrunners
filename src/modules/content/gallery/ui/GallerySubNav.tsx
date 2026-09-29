import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/**
 * The Galerie tab's two halves: the albums and every stored picture. The shared `SubNav` (§360);
 * hrefs resolved on the server because `SubNav` takes strings.
 */
export default async function GallerySubNav({ locale, active }: { locale: Locale; active: "albums" | "pictures" }) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("gallery.title")}
      items={[
        { href: getPathname({ locale, href: "/admin/gallery" }), label: t("gallery.tabAlbums"), active: active === "albums" },
        { href: getPathname({ locale, href: "/admin/gallery/pictures" }), label: t("gallery.tabPictures"), active: active === "pictures" },
      ]}
    />
  );
}
