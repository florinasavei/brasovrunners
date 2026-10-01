"use client";

import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Typography from "@mui/material/Typography";
import { useId } from "react";

/**
 * The large preview of a description picture (§NNN), loaded only once a reader taps one
 * (`PictureLightbox`). It carries no words of its own: they come translated from the trigger,
 * which is the one file that reads the catalogue (§353).
 *
 * A full-screen MUI dialog over a dark layer: `aria-modal`, the focus held inside and given back on
 * close, the page behind it not scrolling, and Escape closing it are the dialog's own. A tap
 * anywhere on the layer — the picture included — closes it as well, and so does the ✕ with its
 * word (§498), 44 pixels high (BR-REQ-041-01 criterion 6). The picture is contained in what is
 * left of the screen; the browser's own pinch-zoom is the only magnifier.
 */
export default function PictureLightboxDialog({
  open,
  onClose,
  src,
  srcSet,
  alt,
  caption,
  closeLabel,
  title,
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  srcSet?: string;
  alt: string;
  caption: string;
  closeLabel: string;
  title: string;
}) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      aria-labelledby={titleId}
      slotProps={{ paper: { sx: { bgcolor: "rgba(0, 0, 0, 0.92)", color: "common.white", backgroundImage: "none" } } }}
    >
      <Box id={titleId} component="h2" sx={VISUALLY_HIDDEN}>
        {title}
      </Box>
      <Box
        onClick={onClose}
        data-testid="picture-preview"
        // Three rows — the ✕, the picture, the caption — and the middle one takes what is left, which
        // is a definite height the picture can be contained in.
        sx={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", height: "100%", cursor: "zoom-out" }}
      >
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1 }}>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            startIcon={<CloseIcon />}
            variant="contained"
            color="inherit"
            sx={{ minHeight: 44, minWidth: 44, color: "grey.900", bgcolor: "common.white" }}
          >
            {closeLabel}
          </Button>
        </Box>
        <Box sx={{ minHeight: 0, px: 1 }}>
          <Box
            component="img"
            src={src}
            srcSet={srcSet}
            sizes={srcSet ? "100vw" : undefined}
            alt={alt}
            sx={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
          />
        </Box>
        {caption !== "" && (
          <Typography variant="body2" sx={{ textAlign: "center", px: 2, py: 1.5, color: "grey.300" }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}

const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
