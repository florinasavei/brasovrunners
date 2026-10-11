"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import type { ReactNode } from "react";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { cropGeometry, cropImageSx, cropWindowSx } from "@/modules/content/rich-text/ui/image-layout";

/** The preview's width: a card's worth, never wider than the viewport leaves room for. */
const PREVIEW_WIDTH = 320;

/**
 * The hover preview of «Ghid de mărimi» (amends §700): the owner asked for «un tooltip cu o poză»,
 * and on a laptop the picture appears small over the button on hover or keyboard focus, the way the
 * calendar's tooltip does (§261). A client island only because MUI's `Tooltip` holds a ref to its
 * child; the button inside (the lightbox's own trigger, which the page renders on the server) arrives
 * as `children`, and the picture's address, size and crop go in as plain values (§318), so no element
 * crosses the boundary as a prop (§370). Touch never opens it (`disableTouchListener`): a phone
 * has the press, which opens the picture large, and a tooltip there would sit over the select.
 * The picture is fetched only on hover, from the ladder rung that fits the crop; the thumbnail is the fallback when there is no ladder, so a page of products pays nothing until a pointer rests on one.
 */
export default function SizeGuideHover({
  thumbUrl,
  srcSet,
  width,
  height,
  crop,
  children,
}: {
  thumbUrl: string;
  /** The master's ladder (`pictureSrcSet`), so a tight crop is drawn from a rung wide enough for it; absent, the thumbnail alone. */
  srcSet?: string;
  width: number;
  height: number;
  crop: ImageCrop | null;
  children: ReactNode;
}) {
  const geometry = cropGeometry(crop, { width, height });
  // The whole picture is drawn 1/crop.w times the window's width, so the browser picks the rung for that, not for the window.
  const sizes = `${Math.ceil(PREVIEW_WIDTH / (crop?.w || 1))}px`;
  const picture = geometry ? (
    <Box data-testid="size-guide-hover-picture" sx={{ ...cropWindowSx(geometry), width: PREVIEW_WIDTH, maxWidth: "100%", borderRadius: 0.5 }}>
      <Box component="img" src={thumbUrl} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt="" draggable={false} sx={cropImageSx(geometry)} />
    </Box>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- the club's own stored thumbnail; a tooltip's picture
    <img data-testid="size-guide-hover-picture" src={thumbUrl} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt="" width={PREVIEW_WIDTH} style={{ display: "block", width: PREVIEW_WIDTH, maxWidth: "100%", height: "auto" }} />
  );
  return (
    <Tooltip
      title={picture}
      placement="top"
      arrow
      disableTouchListener
      slotProps={{ tooltip: { sx: { p: 0.5, bgcolor: "background.paper", boxShadow: 3, maxWidth: "calc(100vw - 16px)" } }, arrow: { sx: { color: "background.paper" } } }}
    >
      <Box component="span" sx={{ display: "block" }}>
        {children}
      </Box>
    </Tooltip>
  );
}
