import Box from "@mui/material/Box";
import type { ShopPhoto } from "@/modules/content/shop/repository";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";

/**
 * A product's pictures in the members' zone (§NNN): the cover large, in its crop, and under it the
 * rest as a strip of thumbnails, each a plain link to the picture's own file — no script, no
 * lightbox, 44-pixel targets (BR-REQ-041-01 criterion 6). A product with one picture draws the
 * cover alone. The pictures are decorative beside the name: `alt` stays empty, the link's name says
 * which picture it is.
 */
export default function ProductPictureStrip({ pictures, openLabel }: { pictures: readonly ShopPhoto[]; /** «Fotografia {number}», the link's name; `{number}` filled here. */ openLabel: string }) {
  const [cover, ...rest] = pictures;
  if (!cover) return null;
  return (
    <Box sx={{ mb: 1.5 }} data-testid="product-picture-strip">
      <Box sx={{ maxWidth: 360 }}>
        <TeamPhotoImage src={cover.webUrl} photo={{ width: cover.width, height: cover.height, crop: cover.crop }} radius={8} loading="lazy" testId="product-cover" />
      </Box>
      {rest.length > 0 && (
        <Box component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0, display: "flex", flexWrap: "wrap", gap: 1 }}>
          {rest.map((picture, index) => (
            <Box component="li" key={`${picture.webUrl}-${index}`} sx={{ m: 0 }}>
              <Box
                component="a"
                href={picture.webUrl}
                target="_blank"
                rel="noopener"
                aria-label={openLabel.replace("{number}", String(index + 2))}
                sx={{ display: "block", width: 64, minHeight: 44, borderRadius: 1.5, overflow: "hidden", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
                data-testid="product-picture-thumb"
              >
                <TeamPhotoImage src={picture.thumbUrl} photo={{ width: picture.width, height: picture.height, crop: picture.crop }} width={64} radius={6} loading="lazy" />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
