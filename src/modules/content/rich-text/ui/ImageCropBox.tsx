"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import CropIcon from "@mui/icons-material/Crop";
import { useRef, useState } from "react";
import {
  CROP_PRESETS,
  type CropPreset,
  drawLocked,
  focalPoint,
  frameCrop,
  MIN_FRACTION,
  presetCrop,
  presetOf,
  PRESET_RATIOS,
  resizeLocked,
  type Intrinsic,
} from "../domain/picture-frame";
import { WHOLE_IMAGE, meaningfulCrop, type ImageCrop, type ImageFocus } from "../domain/schema";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { CARD_FRAME_SX, cardFrameGeometry, cropImageSx } from "./image-layout";

const ResetGlyph = ACTION_ICONS.reset;

/**
 * The crop box (§241): a rectangle over an untouched photograph, stored as four fractions for CSS
 * (`image-layout.ts`). Written rather than installed: crop libraries are canvases and export
 * pipelines (`AGENTS.md` §1.5).
 *
 * Drag outside the rectangle to draw, inside to move; a drag under `MIN_FRACTION` is a missed
 * click. Arrows move it and `Shift`+arrows resize it, described in words (`AGENTS.md` §18).
 * Shape presets hold their ratio while drawing (§454). On a `card` picture the box also shows the
 * listing's 16∶9 frame and offers «Centrul pe card», the focal point.
 */

/** One arrow press, as a fraction of the picture. */
const STEP = 0.02;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Four decimals, as the schema keeps. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const rounded = (crop: ImageCrop): ImageCrop => ({
  x: round(crop.x),
  y: round(crop.y),
  w: round(crop.w),
  h: round(crop.h),
});
const pct = (value: number) => String(Math.round(value * 100));

type Drag =
  | { mode: "draw"; fromX: number; fromY: number }
  | { mode: "move"; fromX: number; fromY: number; start: ImageCrop }
  | { mode: "focus" };

type Target = "crop" | "focus";

export type ImageCropLabels = {
  /** Also the rectangle's accessible name. */
  title: string;
  help: string;
  reset: string;
  /** Placeholders `{w}`, `{h}`, `{x}`, `{y}`, substituted here. */
  position: string;
  presets: string;
  preset: Record<CropPreset, string>;
  target: string;
  targetCrop: string;
  targetFocus: string;
  focusHelp: string;
  focusReset: string;
  focusPosition: string;
  cardPreview: string;
};

export default function ImageCropBox({
  src,
  intrinsic,
  crop,
  onChange,
  focus = null,
  onFocusChange,
  card = false,
  presets = CROP_PRESETS,
  resting,
  labels,
  testId = "rich-text-crop",
}: {
  src: string;
  /** Converts a shape's pixel ratio into fractions. */
  intrinsic: Intrinsic;
  /** What is stored: `null` is the whole photograph. */
  crop: ImageCrop | null;
  onChange: (crop: ImageCrop | null) => void;
  /** §454. */
  focus?: ImageFocus | null;
  onFocusChange?: (focus: ImageFocus | null) => void;
  /** A short-description picture, drawn in the listing card's 16∶9 frame. */
  card?: boolean;
  presets?: readonly CropPreset[];
  /** The shape held with no crop stored (§485): «Liber» by default, 16∶9 for a film's poster. */
  resting?: CropPreset;
  labels: ImageCropLabels;
  /** Two boxes can share a screen (a picture's, a poster's). */
  testId?: string;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<ImageCrop | null>(null);
  const [draftFocus, setDraftFocus] = useState<ImageFocus | null>(null);
  const restingPreset: CropPreset = resting && presets.includes(resting) ? resting : presets.includes("free") ? "free" : presets[0];
  const [preset, setPreset] = useState<CropPreset>(() => {
    const stored = presetOf(crop, intrinsic);
    return presets.includes(stored) ? stored : restingPreset;
  });
  const [target, setTarget] = useState<Target>("crop");
  const ratio = preset === "free" ? null : PRESET_RATIOS[preset];
  const focusing = card && target === "focus";
  const shown = draft ?? crop ?? WHOLE_IMAGE;
  const shownFocus = draftFocus ?? focus;

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  };

  const commit = (next: ImageCrop | null) => {
    setDraft(null);
    onChange(next && meaningfulCrop(rounded(next)));
  };

  const commitFocus = (next: ImageFocus | null) => {
    setDraftFocus(null);
    onFocusChange?.(next && { x: round(clamp01(next.x)), y: round(clamp01(next.y)) });
  };

  const nudge = (dx: number, dy: number, resize: boolean) => {
    const from = crop ?? WHOLE_IMAGE;
    if (resize && ratio !== null) {
      commit(resizeLocked(from, dx !== 0 ? dx : dy, ratio, intrinsic));
      return;
    }
    const next = resize
      ? {
          ...from,
          w: Math.min(1 - from.x, Math.max(MIN_FRACTION, from.w + dx)),
          h: Math.min(1 - from.y, Math.max(MIN_FRACTION, from.h + dy)),
        }
      : {
          ...from,
          x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
          y: Math.min(1 - from.h, Math.max(0, from.y + dy)),
        };
    commit(next);
  };

  const choosePreset = (next: CropPreset) => {
    setPreset(next);
    if (next !== "free") commit(presetCrop(next, intrinsic, crop));
  };

  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-STEP, 0],
    ArrowRight: [STEP, 0],
    ArrowUp: [0, -STEP],
    ArrowDown: [0, STEP],
  };

  const position = labels.position
    .replace("{w}", pct(shown.w))
    .replace("{h}", pct(shown.h))
    .replace("{x}", pct(shown.x))
    .replace("{y}", pct(shown.y));
  const centre = focalPoint(crop, shownFocus);
  const focusPosition = labels.focusPosition.replace("{x}", pct(centre.x)).replace("{y}", pct(centre.y));
  // The card's own functions, so the preview cannot drift from the listing.
  const frame = card ? frameCrop(draft ?? crop, shownFocus, intrinsic) : null;
  const preview = card ? cardFrameGeometry({ crop: draft ?? crop, focus: shownFocus, ...intrinsic }) : null;

  return (
    <Box>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {labels.title}
      </Typography>
      {/* 44 px tall for a thumb (BR-REQ-041-01 criterion 6). */}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={preset}
        onChange={(_event, next: CropPreset | null) => {
          if (next !== null) choosePreset(next);
        }}
        aria-label={labels.presets}
        data-testid="rich-text-crop-presets"
        sx={{ flexWrap: "wrap", mb: 1 }}
      >
        {presets.map((value) => (
          <ToggleButton key={value} value={value} sx={{ minWidth: 44, minHeight: 44, px: 1 }}>
            {labels.preset[value]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {card && (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={target}
          onChange={(_event, next: Target | null) => {
            if (next !== null) setTarget(next);
          }}
          aria-label={labels.target}
          data-testid="rich-text-crop-target"
          sx={{ mb: 1 }}
        >
          <ToggleButton value="crop" sx={{ minHeight: 44, gap: 0.5 }}>
            <CropIcon aria-hidden fontSize="small" />
            {labels.targetCrop}
          </ToggleButton>
          <ToggleButton value="focus" sx={{ minHeight: 44, gap: 0.5 }}>
            <CenterFocusStrongIcon aria-hidden fontSize="small" />
            {labels.targetFocus}
          </ToggleButton>
        </ToggleButtonGroup>
      )}
      <Box
        ref={surface}
        data-testid={testId}
        sx={{
          position: "relative",
          width: "100%",
          touchAction: "none",
          userSelect: "none",
          cursor: focusing ? "pointer" : "crosshair",
          overflow: "hidden",
          borderRadius: 1,
        }}
        onPointerDown={(event) => {
          const point = pointAt(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          if (focusing) {
            drag.current = { mode: "focus" };
            setDraftFocus(point);
            return;
          }
          const inside =
            crop !== null && point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h;
          drag.current = inside && crop ? { mode: "move", fromX: point.x, fromY: point.y, start: crop } : { mode: "draw", fromX: point.x, fromY: point.y };
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          const point = pointAt(event);
          if (!gesture || !point) return;
          if (gesture.mode === "focus") {
            setDraftFocus(point);
            return;
          }
          if (gesture.mode === "move") {
            const { start } = gesture;
            setDraft({
              ...start,
              x: Math.min(1 - start.w, Math.max(0, start.x + point.x - gesture.fromX)),
              y: Math.min(1 - start.h, Math.max(0, start.y + point.y - gesture.fromY)),
            });
            return;
          }
          const from = { x: gesture.fromX, y: gesture.fromY };
          setDraft(
            ratio !== null
              ? drawLocked(from, point, ratio, intrinsic)
              : {
                  x: Math.min(from.x, point.x),
                  y: Math.min(from.y, point.y),
                  w: Math.abs(point.x - from.x),
                  h: Math.abs(point.y - from.y),
                },
          );
        }}
        onPointerUp={(event) => {
          const gesture = drag.current;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (gesture?.mode === "focus") {
            commitFocus(draftFocus);
            return;
          }
          if (!draft || (gesture?.mode === "draw" && (draft.w < MIN_FRACTION || draft.h < MIN_FRACTION))) {
            setDraft(null);
            return;
          }
          commit(draft);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
          setDraftFocus(null);
        }}
      >
        {/* `draggable` off, or the browser's image drag replaces the gesture. */}
        <Box component="img" src={src} alt="" draggable={false} sx={{ display: "block", width: "100%", height: "auto" }} />
        {/* A huge unblurred shadow dims everything outside the rectangle, in one element. */}
        <Box
          tabIndex={focusing ? -1 : 0}
          role="group"
          aria-label={labels.title}
          onKeyDown={(event) => {
            const move = arrows[event.key];
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
            cursor: focusing ? "pointer" : "move",
            "&:focus-visible": { outline: 2, outlineColor: "secondary.main", outlineOffset: 2 },
          }}
        />
        {frame && (
          <Box
            aria-hidden
            data-testid="rich-text-card-frame"
            sx={{
              position: "absolute",
              left: `${frame.x * 100}%`,
              top: `${frame.y * 100}%`,
              width: `${frame.w * 100}%`,
              height: `${frame.h * 100}%`,
              border: "2px dashed",
              borderColor: "secondary.main",
              pointerEvents: "none",
            }}
          />
        )}
        {card && (
          <Box
            tabIndex={focusing ? 0 : -1}
            role="group"
            aria-label={labels.targetFocus}
            data-testid="rich-text-card-focus"
            onKeyDown={(event) => {
              const move = arrows[event.key];
              if (!move) return;
              event.preventDefault();
              commitFocus({ x: centre.x + move[0], y: centre.y + move[1] });
            }}
            sx={{
              position: "absolute",
              left: `${centre.x * 100}%`,
              top: `${centre.y * 100}%`,
              width: 20,
              height: 20,
              ml: "-10px",
              mt: "-10px",
              borderRadius: "50%",
              border: 3,
              borderColor: "secondary.main",
              bgcolor: "rgba(255,255,255,0.35)",
              pointerEvents: "none",
              opacity: focusing || shownFocus ? 1 : 0.6,
              "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
            }}
          />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }} data-testid="rich-text-crop-position">
        {position}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        {labels.help}
      </Typography>
      <Button size="small" onClick={() => { setPreset(restingPreset); commit(null); }} disabled={crop === null} startIcon={<ResetGlyph fontSize="small" />} sx={{ minHeight: 44 }}>
        {labels.reset}
      </Button>
      {card && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" component="p" data-testid="rich-text-card-focus-position">
            {focusPosition}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            {labels.focusHelp}
          </Typography>
          <Button size="small" onClick={() => commitFocus(null)} disabled={!focus} startIcon={<ResetGlyph fontSize="small" />} sx={{ minHeight: 44 }}>
            {labels.focusReset}
          </Button>
          {preview && (
            <Box sx={{ mt: 0.5 }}>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {labels.cardPreview}
              </Typography>
              <Box sx={{ ...CARD_FRAME_SX, maxWidth: 240 }} data-testid="rich-text-card-preview">
                <Box component="img" src={src} alt="" draggable={false} sx={cropImageSx(preview.geometry)} />
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
