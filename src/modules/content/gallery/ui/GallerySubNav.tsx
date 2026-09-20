import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";

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
 * which it is, so it says so. No icons — an icon element passed from a Server Component to a
 * client one is the defect `shared/ui/action-icons.ts` documents, and a two-word label needs
 * no glyph.
 */
export default async function GallerySubNav({ active }: { active: "albums" | "pictures" }) {
  const t = await getTranslations("Admin");

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
      <ButtonLink
        href="/admin/gallery"
        variant={active === "albums" ? "contained" : "outlined"}
        size="small"
        sx={{ minHeight: 44 }}
      >
        {t("gallery.tabAlbums")}
      </ButtonLink>
      <ButtonLink
        href="/admin/gallery/pictures"
        variant={active === "pictures" ? "contained" : "outlined"}
        size="small"
        sx={{ minHeight: 44 }}
      >
        {t("gallery.tabPictures")}
      </ButtonLink>
    </Stack>
  );
}
