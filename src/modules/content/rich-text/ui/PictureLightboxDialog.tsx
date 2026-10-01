"use client";

import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Typography from "@mui/material/Typography";
import { type PointerEvent, useEffect, useId, useRef, useState } from "react";
import {
  IDENTITY,
  isDoubleTap,
  isTap,
  pan,
  pinch,
  type Point,
  type Size,
  TAP_MS,
  toggleZoom,
  type Touch,
  wheelZoom,
  type Zoom,
  zoomTransform,
} from "./picture-zoom";

/**
 * The large preview of a description picture (§601), loaded only once a reader taps one
 * (`PictureLightbox`). It carries no words of its own: they come translated from the trigger,
 * which is the one file that reads the catalogue (§353).
 *
 * A full-screen MUI dialog over a dark layer: `aria-modal`, the focus held inside and given back on
 * close, the page behind it not scrolling, and Escape closing it are the dialog's own. A tap
 * anywhere on the layer — the picture included — closes it as well, and so does the ✕ with its
 * word (§498), 44 pixels high (BR-REQ-041-01 criterion 6). The picture is contained in what is
 * left of the screen, and the layer has its own pinch-zoom (`picture-zoom.ts`): two fingers zoom
 * 1–4× and pan, one finger pans a zoomed picture, a double tap toggles 2×, a trackpad's pinch zooms
 * around the cursor. Only a tap closes — a pinch's or a pan's end never does — and the zoom is gone
 * with the layer when the dialog closes.
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
      <ZoomLayer onClose={onClose} src={src} srcSet={srcSet} alt={alt} caption={caption} closeLabel={closeLabel} />
    </Dialog>
  );
}

/** The pointers as the gesture last changed shape: the zoom and the points it is measured against. */
type Gesture = { zoom: Zoom; from: Point[]; down: Touch | null; moved: boolean };

/**
 * The layer inside the dialog. MUI unmounts it once the dialog has closed, so its zoom starts at 1×
 * every time the preview opens.
 */
function ZoomLayer({
  onClose,
  src,
  srcSet,
  alt,
  caption,
  closeLabel,
}: {
  onClose: () => void;
  src: string;
  srcSet?: string;
  alt: string;
  caption: string;
  closeLabel: string;
}) {
  const [zoom, setZoomState] = useState<Zoom>(IDENTITY);
  const current = useRef<Zoom>(IDENTITY);
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<Touch | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setZoom = (next: Zoom) => {
    current.current = next;
    setZoomState(next);
  };
  const size = (): Size => ({ width: frame.current?.clientWidth ?? 0, height: frame.current?.clientHeight ?? 0 });
  const local = (clientX: number, clientY: number): Point => {
    const box = frame.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  };
  /** Measure the gesture again from where the pointers are now, so a finger lifted mid-pinch pans on. */
  const restart = (down: Touch | null, moved: boolean) => {
    gesture.current = { zoom: current.current, from: [...pointers.current.values()], down, moved };
  };

  useEffect(() => {
    const element = layer.current;
    const timer = closeTimer;
    if (!element) return undefined;
    // A trackpad's pinch is a wheel with ctrlKey; React's wheel listener is passive and could not
    // stop the browser zooming the whole page instead.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !frame.current) return;
      event.preventDefault();
      const box = frame.current.getBoundingClientRect();
      const at = { x: event.clientX - box.left, y: event.clientY - box.top };
      const next = wheelZoom(current.current, event.deltaY, at, { width: frame.current.clientWidth, height: frame.current.clientHeight });
      current.current = next;
      setZoomState(next);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A new finger cancels a tap's pending close: a pinch or a pan begun within 300 ms of it keeps the preview.
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) restart({ ...point, time: event.timeStamp }, false);
    else restart(null, true); // a second finger: a pinch, never a tap
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    const now = [...pointers.current.values()];
    if (now.length >= 2 && start.from.length >= 2) {
      setZoom(pinch(start.zoom, [start.from[0], start.from[1]], [now[0], now[1]], size()));
    } else if (now.length === 1 && start.from.length === 1 && start.zoom.scale > 1) {
      setZoom(pan(start.zoom, start.from[0], now[0], size()));
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(event.pointerId)) return;
    const start = gesture.current;
    const up: Touch = { ...local(event.clientX, event.clientY), time: event.timeStamp };
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      restart(null, true);
      return;
    }
    gesture.current = null;
    // Only a tap closes: one pointer, the scale unchanged, within 300 ms and 10 px (`isTap`).
    if (cancelled || !start?.down || start.moved || start.zoom.scale !== current.current.scale || !isTap(start.down, up)) {
      return;
    }
    if (lastTap.current && isDoubleTap(lastTap.current, up)) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      lastTap.current = null;
      setZoom(toggleZoom(current.current, up, size()));
      return;
    }
    // A single tap closes once it is clear that no second tap follows.
    lastTap.current = up;
    closeTimer.current = setTimeout(onClose, TAP_MS);
  };

  const zoomed = zoom.scale > 1;
  return (
    <Box
      ref={layer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerEnd(event, false)}
      onPointerCancel={(event) => onPointerEnd(event, true)}
      data-testid="picture-preview"
      // Three rows — the ✕, the picture, the caption — and the middle one takes what is left, which
      // is a definite height the picture can be contained in.
      sx={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", height: "100%", touchAction: "none", cursor: zoomed ? "grab" : "zoom-out" }}
    >
      <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1 }}>
        <Button
          // The ✕ is no part of the layer's gestures: it closes on its own click.
          onPointerDown={(event) => event.stopPropagation()}
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
      <Box ref={frame} sx={{ minHeight: 0, overflow: "hidden" }}>
        <Box
          data-testid="picture-preview-zoom"
          // Every finger goes to the layer (the dialog is modal, the page does not scroll behind it),
          // and the zoom is one CSS transform: no re-layout.
          style={{
            touchAction: "none",
            transformOrigin: "0 0",
            transform: zoomTransform(zoom),
            willChange: zoomed ? "transform" : undefined,
          }}
          sx={{ height: "100%", px: 1 }}
        >
          <Box
            component="img"
            src={src}
            srcSet={srcSet}
            sizes={srcSet ? "100vw" : undefined}
            alt={alt}
            draggable={false}
            sx={{ display: "block", width: "100%", height: "100%", objectFit: "contain", userSelect: "none" }}
          />
        </Box>
      </Box>
      {caption !== "" && (
        <Typography variant="body2" sx={{ textAlign: "center", px: 2, py: 1.5, color: "grey.300" }}>
          {caption}
        </Typography>
      )}
    </Box>
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
