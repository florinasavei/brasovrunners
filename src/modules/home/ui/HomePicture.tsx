import Box from "@mui/material/Box";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { cropGeometry, cropImageSx } from "@/modules/content/rich-text/ui/image-layout";
import MountainMark from "@/shared/ui/MountainMark";

/**
 * What an `<img>` needs to draw a picture of the home page (§714): the master, the ladder's `srcset`
 * and `sizes` (§414, §601), the picture's own size and the crop the club drew — built on the server
 * from an event's `cover` (`events/cover.ts#coverSources`) or the hero's setting. Strings and
 * numbers only, so a fixture on the design page draws the same component.
 */
export type HomePictureSources = {
  src: string;
  srcSet?: string;
  sizes: string;
  width: number;
  height: number;
  crop: ImageCrop | null;
};

/** The frame every home-page picture sits in without a crop: the card's and the hero's 16∶9. */
export const HOME_PICTURE_RATIO = "16 / 9";

type Props = {
  picture: HomePictureSources | null;
  /** The hero's picture, the page's largest element: fetched first and at once (LCP), never lazily. */
  eager?: boolean;
  testId?: string;
};

/**
 * A picture of the home page, or its **empty slot** (the owner, 2026-10-11: «start the homepage now,
 * with empty photo slots»): until the club chooses a photograph, the frame keeps its 16∶9 and shows
 * the mountain mark, faint — never a stock or generated picture (decision 6). A plain `img`, not
 * `next/image` (the plan's visual system), with the crop drawn as the team's photographs draw theirs
 * (§541: the window in the crop's own shape, the picture magnified behind it). Decorative: the card's
 * title or the hero's heading says what it shows, so `alt` is empty.
 *
 * A Server Component with no state.
 */
export default function HomePicture({ picture, eager = false, testId }: Props) {
  if (!picture) {
    return (
      <Box
        aria-hidden="true"
        data-testid={testId ? `${testId}-empty` : "home-picture-empty"}
        sx={{ aspectRatio: HOME_PICTURE_RATIO, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", color: "text.disabled" }}
      >
        <MountainMark width={96} />
      </Box>
    );
  }
  const image = {
    src: picture.src,
    srcSet: picture.srcSet,
    sizes: picture.sizes,
    alt: "",
    width: picture.width,
    height: picture.height,
    loading: eager ? ("eager" as const) : ("lazy" as const),
    // The eager hero image is decoded with the page, never deferred: `decoding` is set on the lazy ones only.
    ...(eager ? { fetchPriority: "high" as const } : { decoding: "async" as const }),
    draggable: false,
  };
  const geometry = cropGeometry(picture.crop, picture);
  if (!geometry) {
    return (
      <Box
        component="img"
        {...image}
        data-testid={testId}
        sx={{ display: "block", width: "100%", height: "auto", aspectRatio: HOME_PICTURE_RATIO, objectFit: "cover" }}
      />
    );
  }
  return (
    <Box data-testid={testId} data-crop="set" sx={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio: geometry.aspectRatio }}>
      <Box component="img" {...image} sx={cropImageSx(geometry)} />
    </Box>
  );
}
