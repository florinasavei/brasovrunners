import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";

/**
 * The two halves of the Galerie tab, side by side at the top of both: the albums that go on
 * the site, and every picture the bucket holds.
 *
 * It exists because the pictures list was already built and the owner never found it
 * (2026-09-20: "I should be able to see and manage the pictures stored in Cloudflare as
 * well"). It *was* reachable — one grey line of text under the albums' intro paragraph, which
 * is where a link goes to be missed. Two buttons, the current one filled, is navigation.
 *
 * A Server Component with no pathname lookup: `AdminTabs` is a client island because a layout
 * cannot know which page it wraps, but there are exactly two pages here and each one knows
 * which it is, so it says so. Each wears its glyph by name (§318, amending §183's "no icons",
 * which was written when the only way to give one was the element-valued prop
 * `shared/ui/action-icons.ts` forbids): the albums the Galerie tab's own picture, the bucket's
 * pictures a single image.
 */
export default async function GallerySubNav({ active }: { active: "albums" | "pictures" }) {
  const t = await getTranslations("Admin");

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
      <GlyphButtonLink
        href="/admin/gallery"
        icon="album"
        variant={active === "albums" ? "contained" : "outlined"}
        size="small"
        sx={{ minHeight: 44 }}
      >
        {t("gallery.tabAlbums")}
      </GlyphButtonLink>
      <GlyphButtonLink
        href="/admin/gallery/pictures"
        icon="picture"
        variant={active === "pictures" ? "contained" : "outlined"}
        size="small"
        sx={{ minHeight: 44 }}
      >
        {t("gallery.tabPictures")}
      </GlyphButtonLink>
    </Stack>
  );
}
