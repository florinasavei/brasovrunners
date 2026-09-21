"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { WHOLE_IMAGE, meaningfulCrop, type ImageCrop } from "../domain/schema";

/**
 * The crop box: drag a rectangle over the photograph and that is what the site shows
 * (`DECISIONS.md` §241).
 *
 * ## Why this is written rather than installed
 *
 * Every cropping library on npm is a canvas, a zoom gesture, a rotation and an export pipeline,
 * and it is larger than this editor. What the club needs is one rectangle over a picture whose
 * pixels are never touched — the stored file stays exactly as it was uploaded, and the four
 * fractions are handed to CSS (`image-layout.ts`). That is a pointer listener and a box, and
 * the standing instruction is to prefer nothing over a dependency (`AGENTS.md` §1.5).
 *
 * ## Two gestures, and a third for a keyboard
 *
 * Dragging **outside** the current rectangle draws a new one; dragging **inside** it moves the
 * one that is there, which is the gesture people expect from a photo application and the one
 * that makes small corrections possible at all. A drag smaller than a twentieth of the picture
 * is a click that missed, and changes nothing.
 *
 * The rectangle is also focusable: arrows move it, `Shift` with them resizes it, and the line
 * underneath says in words where it is and how big — because a control that only answers a
 * pointer is a control a keyboard cannot use (`AGENTS.md` §18).
 */

/** Never smaller than a twentieth of the picture, in either direction. */
const MIN = 0.05;
/** What one arrow press moves or resizes: fine enough to aim, coarse enough to get there. */
const STEP = 0.02;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Four decimals, the same precision the schema and the geometry keep. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const rounded = (crop: ImageCrop): ImageCrop => ({
  x: round(crop.x),
  y: round(crop.y),
  w: round(crop.w),
  h: round(crop.h),
});

type Drag =
  | { mode: "draw"; fromX: number; fromY: number }
  | { mode: "move"; fromX: number; fromY: number; start: ImageCrop };

export default function ImageCropBox({
  src,
  crop,
  onChange,
  labels,
}: {
  src: string;
  /** What is stored: `null` is the whole photograph. */
  crop: ImageCrop | null;
  onChange: (crop: ImageCrop | null) => void;
  labels: {
    /** The section's own name, and the rectangle's accessible name. */
    title: string;
    help: string;
    reset: string;
    /** "{w}% × {h}%, from the left {x}%, from the top {y}%" — substituted here. */
    position: string;
  };
}) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The rectangle being dragged, before it is worth storing; `null` between gestures. */
  const [draft, setDraft] = useState<ImageCrop | null>(null);
  const shown = draft ?? crop ?? WHOLE_IMAGE;

  /** Where the pointer is, as a fraction of the picture. */
  const pointAt = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  };

  const commit = (next: ImageCrop | null) => {
    setDraft(null);
    onChange(next && meaningfulCrop(rounded(next)));
  };

  /** Arrows move the rectangle; `Shift` with them resizes it. Nothing leaves the picture. */
  const nudge = (dx: number, dy: number, resize: boolean) => {
    const from = crop ?? WHOLE_IMAGE;
    const next = resize
      ? {
          ...from,
          w: Math.min(1 - from.x, Math.max(MIN, from.w + dx)),
          h: Math.min(1 - from.y, Math.max(MIN, from.h + dy)),
        }
      : {
          ...from,
          x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
          y: Math.min(1 - from.h, Math.max(0, from.y + dy)),
        };
    commit(next);
  };

  const position = labels.position
    .replace("{w}", String(Math.round(shown.w * 100)))
    .replace("{h}", String(Math.round(shown.h * 100)))
    .replace("{x}", String(Math.round(shown.x * 100)))
    .replace("{y}", String(Math.round(shown.y * 100)));

  return (
    <Box>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {labels.title}
      </Typography>
      <Box
        ref={surface}
        data-testid="rich-text-crop"
        sx={{ position: "relative", width: "100%", touchAction: "none", userSelect: "none", cursor: "crosshair", overflow: "hidden", borderRadius: 1 }}
        onPointerDown={(event) => {
          const point = pointAt(event);
          if (!point) return;
          const inside =
            crop !== null && point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h;
          drag.current = inside && crop ? { mode: "move", fromX: point.x, fromY: point.y, start: crop } : { mode: "draw", fromX: point.x, fromY: point.y };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          const point = pointAt(event);
          if (!gesture || !point) return;
          if (gesture.mode === "move") {
            const { start } = gesture;
            setDraft({
              ...start,
              x: Math.min(1 - start.w, Math.max(0, start.x + point.x - gesture.fromX)),
              y: Math.min(1 - start.h, Math.max(0, start.y + point.y - gesture.fromY)),
            });
            return;
          }
          setDraft({
            x: Math.min(gesture.fromX, point.x),
            y: Math.min(gesture.fromY, point.y),
            w: Math.abs(point.x - gesture.fromX),
            h: Math.abs(point.y - gesture.fromY),
          });
        }}
        onPointerUp={(event) => {
          const gesture = drag.current;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          // A drag that drew nothing is a click that missed: leave what was there.
          if (!draft || (gesture?.mode === "draw" && (draft.w < MIN || draft.h < MIN))) {
            setDraft(null);
            return;
          }
          commit(draft);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
      >
        {/* The whole photograph, always: the crop is what is *shown* of it, and the organizer
            has to see what they are leaving out. `draggable` off, or the browser's own image
            drag starts instead of the gesture. */}
        <Box component="img" src={src} alt="" draggable={false} sx={{ display: "block", width: "100%", height: "auto" }} />
        {/* The rectangle. The shadow with no blur and a very large spread is what dims
            everything outside it — one element rather than four, and it cannot fall out of
            step with the box it surrounds. */}
        <Box
          tabIndex={0}
          role="group"
          aria-label={labels.title}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-STEP, 0],
              ArrowRight: [STEP, 0],
              ArrowUp: [0, -STEP],
              ArrowDown: [0, STEP],
            };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            nudge(move[0], move[1], event.shiftKey);
          }}
          sx={{
            position: "absolute",
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.w * 100}%`,
            height: `${shown.h * 100}%`,
            border: 2,
            borderColor: "primary.main",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
            cursor: "move",
            "&:focus-visible": { outline: 2, outlineColor: "secondary.main", outlineOffset: 2 },
          }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }} data-testid="rich-text-crop-position">
        {position}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        {labels.help}
      </Typography>
      <Button size="small" onClick={() => commit(null)} disabled={crop === null}>
        {labels.reset}
      </Button>
    </Box>
  );
}
