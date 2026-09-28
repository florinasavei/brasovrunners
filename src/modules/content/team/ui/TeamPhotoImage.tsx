import Box from "@mui/material/Box";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { teamPhotoFrame } from "./team-photo-frame";

/**
 * A card's photo, drawn by `teamPhotoFrame` (§541). No hook or state, so the public page, the
 * backoffice list and the upload preview share it. `width`: `"100%"` on the page, pixels for a thumbnail.
 */
export default function TeamPhotoImage({
  src,
  srcSet,
  sizes,
  photo,
  width = "100%",
  radius = 0,
  loading,
  testId,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
  photo: { width: number; height: number; crop: ImageCrop | null };
  width?: number | string;
  radius?: number;
  loading?: "eager" | "lazy";
  testId?: string;
}) {
  const frame = teamPhotoFrame(photo);
  // The name is beside it everywhere, so the image is decorative.
  const image = { src, srcSet, sizes, alt: "", width: photo.width, height: photo.height, loading, draggable: false };
  if (frame.kind === "cover") {
    return (
      <Box
        component="img"
        {...image}
        data-testid={testId}
        data-crop="none"
        sx={{ ...frame.image, width, borderRadius: `${radius}px`, flexShrink: 0 }}
      />
    );
  }
  return (
    <Box
      data-testid={testId}
      data-crop="set"
      sx={{ position: "relative", overflow: "hidden", width, aspectRatio: frame.window.aspectRatio, borderRadius: `${radius}px`, flexShrink: 0 }}
    >
      <Box component="img" {...image} sx={frame.image} />
    </Box>
  );
}
