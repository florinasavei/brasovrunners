import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";

/**
 * The two halves of the Galerie tab, side by side at the top of both: the albums that go on
 * the site, and every picture the bucket holds.
 *
 * It exists because the pictures list was already built and the owner never found it
 * (2026-09-20: "I should be able to see and manage the pictures stored in Cloudflare as
 * well"). It *was* reachable — one grey line of text under the albums' intro paragraph, which
 * is where a link goes to be missed. Two entries at the top of both pages, the current one
 * marked, is navigation.
 *
 * It is the shared `SubNav` since §NNN, the one look every backoffice sub-navigation wears: it
 * was two buttons, the current one filled, each with a glyph (§318) — a different drawing of the
 * same idea from the configuration screens', and the only row whose current entry did not say
 * `aria-current`. No glyphs any more, because a sub-tab row has none (`SubNav`); the album glyph
 * left the icon registry with them. The hrefs are resolved here, on the server, because `SubNav`
 * takes strings and `getPathname` is a server function.
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
